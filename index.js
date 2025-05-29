const express = require('express');
const { google } = require('googleapis');
const app = express();

const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const TEST_USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a';

app.get('/calendar/test', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: '/secrets/calendar-key',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59);

    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: todayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsRes.data.items || [];
    const messageText =
      events.length > 0
        ? '📅 今日の予定:\n' +
          events.map(e => `・${e.summary} (${e.start.dateTime || e.start.date})`).join('\n')
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
