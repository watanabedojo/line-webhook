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
const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbz915raOlkxis1vx_7vvJjVdA5KzNquZUAt1QckbJVCCcxM6MEj4RhCX-4WDyT6ZImP/exec';

const firestore = new Firestore();
const usersCollection = firestore.collection('users');
const tokensCollection = firestore.collection('eventTokens');

const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);
const calendar = google.calendar({ version: 'v3', auth: jwtClient });

function getJSTRange(dayOffset = 0) {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jstNow.getFullYear(), m = jstNow.getMonth(), d = jstNow.getDate();
  const start = new Date(Date.UTC(y, m, d + dayOffset, -9, 0, 0));
  const end = new Date(Date.UTC(y, m, d + dayOffset + 1, -9, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatDateTime(datetimeStr) {
  const utc = new Date(datetimeStr);
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getFullYear()}年${jst.getMonth() + 1}月${jst.getDate()}日 ${String(jst.getHours()).padStart(2, '0')}:${String(jst.getMinutes()).padStart(2, '0')}`;
}

function getField(text, label) {
  const regex = new RegExp(`${label}[\s\n]*([^\n]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

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

async function getScheduledEvents(dayOffset = 0) {
  await jwtClient.authorize();
  const { start, end } = getJSTRange(dayOffset);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const allEvents = res.data.items || [];
  const events = allEvents.filter(e => e.description?.includes('稽古連絡'));

  if (events.length === 0) {
    return [`📢 ${dayOffset === 1 ? '明日' : '今日'}の「稽古連絡」対象の予定はありません。`];
  }

  let message = `【${dayOffset === 1 ? '明日の' : '本日の'}稽古予定】\n`;
  for (const event of events) {
    const start = new Date(event.start.dateTime || event.start.date);
    const end = new Date(event.end.dateTime || event.end.date);
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][start.getDay()];
    const startStr = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日（${weekday}） ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

    message += `\n📢 ${event.summary}`;
    message += `\n📅日時：${startStr}～${endStr}`;
    if (event.location) message += `\n📍場所：${event.location}`;
    message += `\n📝内容：${event.description}\n`;
  }
  return [message.trim()];
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
  const events = allEvents.filter(e => e.description?.includes('ビジター'));

  if (events.length === 0) return '該当する予定が見つかりませんでした。';

  return events;
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

app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (!event) return res.sendStatus(200);

  const userId = event.source?.userId;
  const replyToken = event.replyToken;

  const exists = await tokensCollection.doc(replyToken).get();
  if (exists.exists) return res.sendStatus(200);
  await tokensCollection.doc(replyToken).set({ handled: true });

  if (event.type === 'follow') {
    await usersCollection.doc(userId).set({}, { merge: true });
    await sendLineMessage('友だち追加ありがとうございます！今後、空手道場の予定を自動でお知らせします📢', userId);
  } else if (event.type === 'message') {
    const text = event.message.text;

    if (text === 'ビジター申込') {
      const events = await getVisitorEventsOneMonth();
      if (typeof events === 'string') return await sendLineMessage(events, userId);

      const eventsText = events.map(e => `・${formatDateTime(e.start.dateTime || e.start.date)} ${e.summary}`).join('\n');
      const message = `お問い合わせありがとうございます。以下よりご希望日時をお選びください。\n\n【希望日時】\n${eventsText}\n\nご回答は以下のテンプレートに沿ってご返信ください。\n\n【お名前】\n【学年 or ご年齢】\n【所属道場】\n【参加にあたって所属道場長の許可】得ている・確認中\n【希望日時】\n【ご連絡事項（あれば）】`;
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

      const response = `${parsed.name}さん\nご回答ありがとうございます。\n${parsed.date}\n場所：渡邊道場\n参加費：3,000円　家族割あり2名以上で1名につき1,000円割引\n前日に再度ご連絡いたします、何かご不明点があれば公式LINEのお問い合わせからどうぞ。`;
      await sendLineMessage(response, userId);
    }
  }

  res.sendStatus(200);
});

app.get('/calendar/broadcast', async (req, res) => {
  try {
    const isTomorrow = req.query.target === 'tomorrow';
    const messages = await getScheduledEvents(isTomorrow ? 1 : 0);
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

app.get('/remind/:userId', async (req, res) => {
  const userId = req.params.userId;
  const snapshot = await firestore.collection('responses').where('userId', '==', userId).get();
  if (snapshot.empty) return res.status(404).send('データが見つかりません');

  const entry = snapshot.docs[0].data();
  const message = `【明日の稽古参加予定】\n${entry.name}さん、明日の参加をお待ちしています🥋\n集合時間や持ち物など、不明点があればお気軽にご連絡ください。`;
  await sendLineMessage(message, userId);
  res.send('✅ リマインド送信完了');
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
