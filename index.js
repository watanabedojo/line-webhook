const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = '+UE3+1Bgqkp8WQoxrH7pdvyhr3QIT6bY8tWs5lFIFDeJFBMNvMCTZgUFrW/qaihdzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rz2y7UG4nD4Ict0w2q+UJpuVXsZo/hP5bmhToKpvgtowwdB04t89/1O/w1cDnyilFU=';
const USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

const auth = new google.auth.GoogleAuth({
  keyFile: '/secrets/calendar-key',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
});

const calendar = google.calendar({ version: 'v3', auth });

async function getTodaysEvents() {
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
