const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbz915raOlkxis1vx_7vvJjVdA5KzNquZUAt1QckbJVCCcxM6MEj4RhCX-4WDyT6ZImP/exec';

const firestore = new Firestore();
const usersCollection = firestore.collection('users');
const tokensCollection = firestore.collection('eventTokens');

const jwtClient = new google.auth.JWT(
  key.client_email, null, key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);
const calendar = google.calendar({ version: 'v3', auth: jwtClient });

function getField(text, label) {
  const regex = new RegExp(`${label}[\\s\\n]*([^\\n]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function toHalfWidth(str) {
  return str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

async function postToSheet(data) {
  try {
    await axios.post(GAS_WEBHOOK_URL, data, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('❌ スプレッドシート送信失敗:', err.message);
  }
}

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
  return allEvents.filter(e => e.description?.includes('ビジター'));
}

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

// Webhook受信処理
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (!event) return res.sendStatus(200);

  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  const exists = await tokensCollection.doc(replyToken).get();
  if (exists.exists) return res.sendStatus(200);
  await tokensCollection.doc(replyToken).set({ handled: true });

  if (event.type === 'message') {
    const text = event.message.text;

    // ビジター申込処理
    if (text === 'ビジター申込') {
      const events = await getVisitorEventsOneMonth();
      if (events.length === 0) return await sendLineMessage('該当する予定が見つかりませんでした。', userId);

      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const eventsText = events.map(e => {
        const start = new Date(e.start.dateTime || e.start.date);
        const day = `${start.getMonth() + 1}月${start.getDate()}日（${weekdays[start.getDay()]}) ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        return `・${day}`;
      }).join('\n\n');

      const message1 = `お問い合わせありがとうございます。
現在予定している稽古日時を現在から1ヶ月分お知らせします。

【日時一覧】
${eventsText}

このあと続けて返信用テンプレートを送信します。
文面を長押しして「コピー」→メッセージ入力画面を長押しして「ペースト」してください。
ご不明点は「お問い合わせ」からどうぞ。`;

      const message2 = `【希望日時】
〇月〇日

【お名前】
〇〇 〇〇

【学年or年齢】
○○

【所属道場】
○○

【参加の許可を所属道場長の許可】
得ている・確認中

【ご連絡事項（あれば）】`;

      await sendLineMessage(message1, userId);
      await sendLineMessage(message2, userId);
    }

    // 回答テンプレート受信
    if (text.includes('お名前') && text.includes('所属道場')) {
      const parsed = {
        userId,
        name: getField(text, '【お名前】'),
        grade: getField(text, '【学年or年齢】'),
        dojo: getField(text, '【所属道場】'),
        permission: getField(text, '【参加の許可を所属道場長の許可】'),
        date: getField(text, '【希望日時】'),
        note: getField(text, '【ご連絡事項（あれば）】'),
        source: 'LINE'
      };

      // dateKeyを保存（全角→半角処理付き）
      const normalized = toHalfWidth(parsed.date);
      const match = normalized.match(/(\d{1,2})月(\d{1,2})日/);
      if (match) {
        parsed.dateKey = `${parseInt(match[1])}月${parseInt(match[2])}日`;
      }

      await postToSheet(parsed);
      await usersCollection.doc(parsed.userId).set(parsed, { merge: true });

      // カレンダーから場所取得
      const events = await getVisitorEventsOneMonth();
      let place = '場所未定';
      if (match) {
        const month = parseInt(match[1]);
        const day = parseInt(match[2]);
        const matched = events.find(e => {
          const start = new Date(e.start.dateTime || e.start.date);
          return start.getMonth() + 1 === month && start.getDate() === day;
        });
        if (matched) place = matched.location || place;
      }

      const response = `${parsed.name}さん

ご回答ありがとうございます。

${parsed.date}
場所：${place}

参加費：3,000円　家族割あり（2名以上で1名につき1,000円割引）

前日に再度ご連絡いたします。
ご不明点は公式LINEの「お問い合わせ」からどうぞ。`;

      await sendLineMessage(response, userId);
    }
  }

  res.sendStatus(200);
});

// 全体送信（明日分）
app.get('/broadcast/all', async (req, res) => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const events = await getVisitorEventsOneMonth();
  const tomorrowEvents = events.filter(e => {
    const start = new Date(e.start.dateTime || e.start.date);
    return start.getDate() === tomorrow.getDate() &&
           start.getMonth() === tomorrow.getMonth();
  });

  if (tomorrowEvents.length === 0) return res.send('明日の予定はありません。');

  const messages = tomorrowEvents.map(e => {
    const start = new Date(e.start.dateTime || e.start.date);
    const weekday = ['日','月','火','水','木','金','土'][start.getDay()];
    return `日時：${start.getMonth() + 1}月${start.getDate()}日（${weekday}） ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}

場所：${e.location || '未定'}

内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  const snapshot = await usersCollection.get();
  for (const doc of snapshot.docs) {
    await sendLineMessage(`【明日の稽古予定】\n\n${messages}`, doc.id);
  }

  res.send('✅ 全体送信完了');
});

// 予約者限定送信（明日分）
app.get('/broadcast/visitors', async (req, res) => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const dateKey = `${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`;

  const events = await getVisitorEventsOneMonth();
  const tomorrowEvents = events.filter(e => {
    const start = new Date(e.start.dateTime || e.start.date);
    return start.getDate() === tomorrow.getDate() &&
           start.getMonth() === tomorrow.getMonth();
  });

  if (tomorrowEvents.length === 0) return res.send('明日の予定はありません。');

  const messages = tomorrowEvents.map(e => {
    const start = new Date(e.start.dateTime || e.start.date);
    const weekday = ['日','月','火','水','木','金','土'][start.getDay()];
    return `日時：${start.getMonth() + 1}月${start.getDate()}日（${weekday}） ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}

場所：${e.location || '未定'}

内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  const snapshot = await usersCollection.where('dateKey', '==', dateKey).get();
  if (snapshot.empty) return res.send('予約者が見つかりません');

  for (const doc of snapshot.docs) {
    await sendLineMessage(`【明日の稽古予定】\n\n${messages}`, doc.id);
  }

  res.send(`✅ 予約者（${snapshot.size}名）に送信完了`);
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
