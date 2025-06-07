const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';
const GAS_WEBHOOK_URL = 'YOUR_GAS_WEBHOOK_URL';

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

// 明日の予約者にだけ送信
app.get('/broadcast/visitors', async (req, res) => {
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
    const time = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][start.getDay()];
    return `日時：${start.getMonth() + 1}月${start.getDate()}日（${weekday}） ${time}\n\n場所：${e.location || '未定'}\n\n内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  const matchDate = `${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`;
  const visitorSnapshot = await usersCollection.get();

  let sentCount = 0;
  for (const doc of visitorSnapshot.docs) {
    const data = doc.data();
    if (!data.date) continue;
    const normalized = toHalfWidth(data.date);
    if (normalized.includes(matchDate)) {
      await sendLineMessage(`【明日の稽古予定】\n\n${messages}`, doc.id);
      sentCount++;
    }
  }

  res.send(`予約者${sentCount}名に送信しました`);
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
