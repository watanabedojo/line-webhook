const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = '（あなたのキー）';
const USER_ID = '（あなたのLINE ID）';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

// 📌 JWT を使って認証する
const key = require('/secrets/line-bot-key.json');
const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);

const calendar = google.calendar({ version: 'v3', auth: jwtClient });

async function getTodaysEvents() {
  await jwtClient.authorize(); // ← 明示的に認証
  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(now.setHours(23, 59, 59, 999)).toISOString();

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startOfDay,
    timeMax: endOfDay,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return res.data.items || [];
}

async function sendLineMessage(text) {
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: USER_ID,
    messages: [{ type: 'text', text }]
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });
}

app.get('/calendar/test', async (req, res) => {
  try {
    const events = await getTodaysEvents();
    if (events.length === 0) {
      await sendLineMessage('📢 今日の予定はありません。');
    } else {
      let message = '📢 今日の予定をお知らせします\n';
      for (const event of events) {
        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;
        message += `\n・${event.summary}\n  ${start} ～ ${end}`;
        if (event.location) message += `\n  場所: ${event.location}`;
        if (event.description) message += `\n  内容: ${event.description}`;
        message += '\n';
      }
      await sendLineMessage(message.trim());
    }
    res.status(200).send('✅ 通知完了');
  } catch (error) {
    console.error('❌ Googleカレンダー取得エラー:', error.message);
    res.status(500).send('❌ 通信処理失敗');
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log('Server running on port 8080');
});
