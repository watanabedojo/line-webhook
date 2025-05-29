const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const key = require('/secrets/line-bot-key.json'); // マウント済みキーファイル

const app = express();
app.use(bodyParser.json());

// 固定情報（LINE・カレンダー）
const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

// JWTでGoogle API認証
const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);

const calendar = google.calendar({ version: 'v3', auth: jwtClient });

function getJSTRange() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = new Date(jst); start.setHours(0, 0, 0, 0);
  const end = new Date(jst); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatDateTime(datetimeStr) {
  const dt = new Date(datetimeStr);
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

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

  const events = res.data.items || [];
  return events.map(event => {
    const startTime = formatDateTime(event.start.dateTime || event.start.date);
    const endTime = formatDateTime(event.end.dateTime || event.end.date);
    return `📢 ${event.summary}\n日時：${startTime}〜${endTime}` +
      (event.location ? `\n場所：${event.location}` : '') +
      (event.description ? `\n内容：${event.description}` : '') +
      `\n\nご不明な点はご連絡ください。\nご確認お願いいたします。`;
  });
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
      for (const message of events) {
        await sendLineMessage(message);
      }
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
