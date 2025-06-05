// 必要なモジュール読み込み
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

// 環境設定
const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU='; // 必ず本番用に差し替えてください
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbz915raOlkxis1vx_7vvJjVdA5KzNquZUAt1QckbJVCCcxM6MEj4RhCX-4WDyT6ZImP/exec';

// Firestore 初期化
const firestore = new Firestore();
const usersCollection = firestore.collection('users');

// JWT認証（Googleカレンダー）
const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);
const calendar = google.calendar({ version: 'v3', auth: jwtClient });

// JSTの1日分の範囲
function getJSTRange() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jstNow.getFullYear(), m = jstNow.getMonth(), d = jstNow.getDate();
  const start = new Date(Date.UTC(y, m, d, -9, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, -9, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

// 日付整形
function formatDateTime(datetimeStr) {
  const utc = new Date(datetimeStr);
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getFullYear()}年${jst.getMonth() + 1}月${jst.getDate()}日 ${String(jst.getHours()).padStart(2, '0')}:${String(jst.getMinutes()).padStart(2, '0')}`;
}

// スプレッドシートに送信
async function postToSheet(data) {
  try {
    await axios.post(GAS_WEBHOOK_URL, data, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('📝 スプレッドシート送信成功');
  } catch (err) {
    console.error('❌ スプレッドシート送信失敗:', err.message);
  }
}

// テキストから特定フィールド抽出
function getField(text, label) {
  const regex = new RegExp(`${label}[\\s\\n]*([^\\n]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

// 今日の「全体通知」イベントを取得
async function getTodaysEvents() {
  await jwtClient.authorize();
  const { start, end } = getJSTRange();
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const allEvents = res.data.items || [];
  const events = allEvents.filter(e => e.description?.includes('全体通知'));

  if (events.length === 0) {
    return ['📢 今日の「全体通知」対象の予定はありません。'];
  }

  let message = `おはようございます。\n本日の予定をお知らせします。\n`;
  for (const event of events) {
    const startTime = formatDateTime(event.start.dateTime || event.start.date);
    const endTime = formatDateTime(event.end.dateTime || event.end.date);
    message += `\n📢 ${event.summary}\n日時：${startTime}〜${endTime}`;
    if (event.location) message += `\n場所：${event.location}`;
    message += `\n内容：${event.description}\n`;
  }
  return [message.trim()];
}

// 今後1ヶ月のビジターイベントを取得
async function getVisitorEventsOneMonth() {
  await jwtClient.authorize();

  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  jstNow.setHours(0, 0, 0, 0);
  const endJST = new Date(jstNow);
  endJST.setMonth(endJST.getMonth() + 1);
  endJST.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: jstNow.toISOString(),
    timeMax: endJST.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const allEvents = res.data.items || [];
  const events = allEvents.filter(e => e.description?.includes('ビジター'));

  if (events.length === 0) {
    return '該当する予定が見つかりませんでした。';
  }

  const eventsText = events.map(event => {
    const dateStr = formatDateTime(event.start.dateTime || event.start.date);
    return `・${dateStr} ${event.summary}`;
  }).join('\n');

  return `お問い合わせいただきありがとうございます。
渡邊道場からの自動返信となります。

出稽古・練習会参加にあたって、下記のテンプレートに沿ってご返信ください。

ご返信確認後、当日の注意事項などを改めてご連絡させていただきます。

--------------------

【お名前】

【学年 or ご年齢】

【所属道場】

【参加にあたって所属道場長の許可】
得ている・確認中

【希望日時】
${eventsText}

【ご連絡事項（あれば）】

【料金】
参加費：3,000円
家族割：2名以上で1名につき1,000円割引
※動画撮影可

--------------------`;
}

// LINEメッセージ送信
async function sendLineMessage(text, to) {
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to,
    messages: [{ type: 'text', text }]
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });
}

// Webhook処理
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (!event) return res.sendStatus(200);

  const userId = event.source?.userId;

  if (event.type === 'follow') {
    await usersCollection.doc(userId).set({}, { merge: true });
    await sendLineMessage(
      '友だち追加ありがとうございます！今後、空手道場の予定を自動でお知らせします📢',
      userId
    );
  } else if (event.type === 'message') {
    const text = event.message.text;

    if (text === 'ビジター申込') {
      const message = await getVisitorEventsOneMonth();
      await sendLineMessage(message, userId);
    } else if (text.includes('お名前') && text.includes('所属道場')) {
      const parsed = {
        userId,
        name: getField(text, '【お名前】'),
        grade: getField(text, '【学年 or ご年齢】'),
        dojo: getField(text, '【所属道場】'),
        permission: getField(text, '【参加にあたって所属道場長の許可】'),
        date: getField(text, '【希望日時】'),
        note: getField(text, '【ご連絡事項（あれば）】'),
        source: 'LINE'
      };
      await postToSheet(parsed);
      await sendLineMessage('✅ ご回答ありがとうございます！内容を確認しました。', userId);
    }
  }

  res.sendStatus(200);
});

// カレンダー全体通知送信
app.get('/calendar/broadcast', async (req, res) => {
  try {
    const messages = await getTodaysEvents();
    const snapshot = await usersCollection.get();
    if (snapshot.empty) return res.status(404).send('ユーザーがいません');

    for (const doc of snapshot.docs) {
      const userId = doc.id;
      for (const message of messages) {
        await sendLineMessage(message, userId);
      }
    }

    res.send('✅ 全ユーザーに送信完了');
  } catch (err) {
    console.error('❌ 通知失敗:', err.message);
    res.status(500).send('サーバーエラー');
  }
});

// サーバー起動
app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
