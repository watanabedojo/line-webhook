// 📦 必要なモジュール読み込み
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

// ✅ LINE設定
const LINE_CHANNEL_ACCESS_TOKEN = '+UE3+1Bgqkp8WQoxrH7pdvyhr3QIT6bY8tWs5lFIFDeJFBMNvMCTZgUFrW/qaihdzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rz2y7UG4nD4Ict0w2q+UJpuVXsZo/hP5bmhToKpvgtowwdB04t89/1O/w1cDnyilFU=';
const TEST_USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a';

// ✅ Googleカレンダー設定
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

// 🔐 認証クライアント作成
// サービスアカウントキー
const auth = new google.auth.GoogleAuth({
  keyFile: '/secrets/calendar-key'',
  scopes: SCOPES
});

const calendar = google.calendar({ version: 'v3', auth });

// ✅ /calendar/test エンドポイント
app.get('/calendar/test', async (req, res) => {
  try {
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59);

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items;

    let messageText = '📆 今日の予定はありません';
    if (events.length > 0) {
      messageText = '📆 今日の予定：\n';
      events.forEach(event => {
        const start = event.start.dateTime || event.start.date;
        const end = event.end?.dateTime || '';
        const summary = event.summary || '無題';
        messageText += `・${start} ${summary}\n`;
      });
    }

    // LINEへ送信
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: TEST_USER_ID,
      messages: [{ type: 'text', text: messageText }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).send('✅ カレンダー通知送信完了');
  } catch (error) {
    console.error('❌ カレンダー通知エラー:', error.message);
    res.status(500).send('❌ カレンダー通知送信失敗');
  }
});

// ✅ テスト送信
app.get('/test', async (req, res) => {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: TEST_USER_ID,
      messages: [
        { type: 'text', text: '📢 テストメッセージ送信成功！' }
      ]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).send('✅ テストメッセージを送信しました。');
  } catch (error) {
    console.error('送信エラー詳細:', error.message);
    res.status(500).send('❌ テストメッセージ送信失敗');
  }
});

// ✅ WebhookでuserId確認
app.post('/webhook', (req, res) => {
  try {
    const events = req.body.events;
    if (events && events.length > 0) {
      const userId = events[0].source?.userId;
      const type = events[0].type;
      const message = events[0].message?.text;

      console.log('✅ Webhookイベント受信:', { type, userId, message });
    }
  } catch (err) {
    console.error('Webhook処理エラー:', err.message);
  }
  res.sendStatus(200);
});

// ✅ サーバー起動
app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running...');
});
