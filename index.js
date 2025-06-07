// 必要なモジュール読み込み
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = 'あなたのLINEアクセストークン';
const CALENDAR_ID = 'あなたのカレンダーID';
const GAS_WEBHOOK_URL = 'あなたのGAS Webhook URL';

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

function formatDateTime(datetimeStr) {
  const utc = new Date(datetimeStr);
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: `${jst.getMonth() + 1}月${jst.getDate()}日`,
    time: `${String(jst.getHours()).padStart(2, '0')}:${String(jst.getMinutes()).padStart(2, '0')}`
  };
}

function getField(text, label) {
  const regex = new RegExp(`${label}\\s*([^
]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
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

async function handleVisitorReply(parsed) {
  const events = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });

  const match = events.data.items.find(e =>
    parsed.date.includes(formatDateTime(e.start.dateTime || e.start.date).date)
  );

  const { date, time } = formatDateTime(match.start.dateTime || match.start.date);
  const location = match.location || '（場所未定）';

  const message = `${parsed.name}さん\nご回答ありがとうございます。\n${date} ${time}～\n場所：${location}\n参加費：3,000円　家族割あり2名以上で1名につき1,000円割引\n前日に再度ご連絡いたします、何かご不明点があれば公式LINEのお問い合わせからどうぞ。`;

  await sendLineMessage(message, parsed.userId);
}

// 前日18時に送るメッセージ生成（例: Cloud Schedulerで呼び出し）
app.get('/visitor/reminder', async (req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = `${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`;

  const snapshot = await firestore.collection('visitorResponses').get();
  const docs = snapshot.docs.filter(doc => doc.data().date.includes(targetDate));

  for (const doc of docs) {
    const name = doc.data().name || 'ご参加者';
    const message = `【明日の稽古参加予定】\n\n${name}さん、明日の参加をお待ちしています🥋\n集合時間や持ち物など、不明点があればお気軽にご連絡ください。`;
    await sendLineMessage(message, doc.data().userId);
  }

  res.send('✅ 前日リマインド送信完了');
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
