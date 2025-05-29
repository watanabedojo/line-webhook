const express = require('express');
const { google } = require('googleapis');
const app = express();

const LINE_CHANNEL_ACCESS_TOKEN = 'YOUR_LINE_ACCESS_TOKEN';
const TEST_USER_ID = 'YOUR_USER_ID';

app.get('/calendar/test', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: '/secrets/calendar-key',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59);

    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: todayStart.toISOString(),
      timeMax: todayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsRes.data.items || [];
    const messageText =
      events.length > 0
        ? '📅 今日の予定:\n' +
          events
            .map(e => {
              const start = e.start.dateTime || e.start.date;
              return `・${e.summary || '（予定名なし）'}（${start}）`;
            })
            .join('\n')
        : '📭 今日の予定はありません。';

    await require('axios').post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: TEST_USER_ID,
        messages: [{ type: 'text', text: messageText }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );

    res.status(200).send('✅ カレンダー通知を送信しました');
  } catch (err) {
    console.error('送信エラー:', err);
    res.status(500).send('❌ 通知失敗');
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log('Server started');
});
