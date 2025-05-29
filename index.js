const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const auth = new google.auth.GoogleAuth({
  keyFile: './service-account.json',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});
const calendar = google.calendar({ version: 'v3', auth });
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

const LINE_CHANNEL_ACCESS_TOKEN = '+UE3+1Bgqkp8WQoxrH7pdvyhr3QIT6bY8tWs5lFIFDeJFBMNvMCTZgUFrW/qaihdzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rz2y7UG4nD4Ict0w2q+UJpuVXsZo/hP5bmhToKpvgtowwdB04t89/1O/w1cDnyilFU=';
const USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a';

function getTodayTimeRange() {
  const now = new Date();
  const timezoneOffset = 9 * 60 * 60000;
  const start = new Date(now.setHours(0, 0, 0, 0) - now.getTimezoneOffset() * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function sendLineMessage(message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: USER_ID,
      messages: [{ type: 'text', text: message }],
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      }
    });
    console.log('✅ LINE通知送信成功');
  } catch (err) {
    console.error('❌ LINE送信エラー:', err.response?.data || err.message);
  }
}

app.get('/calendar/test', async (req, res) => {
  const { start, end } = getTodayTimeRange();
  try {
    const result = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = result.data.items;
    if (events.length === 0) {
      await sendLineMessage('📢 本日のお知らせ：\n今日の予定はありません。');
    } else {
      let message = '📢 今日の予定をお知らせします';
      for (const event of events) {
        const title = event.summary || '(タイトルなし)';
        const startTime = event.start.dateTime?.split('T')[1]?.substring(0, 5) || '未定';
        const endTime = event.end.dateTime?.split('T')[1]?.substring(0, 5) || '';
        const location = event.location || '場所の指定なし';
        const description = event.description || '説明なし';
        message += `
・${title}
　${startTime}〜${endTime}
　${location}
　${description}`;
      }
      await sendLineMessage(message);
    }

    res.status(200).send('✅ カレンダー通知送信完了');
  } catch (err) {
    console.error('❌ Googleカレンダー取得エラー:', err.message);
    res.status(500).send('❌ 通知処理失敗');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
