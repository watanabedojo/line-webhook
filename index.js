const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

app.use(bodyParser.json());

// ✅ チャネルアクセストークン（再発行済のものを貼り付けてください）
const LINE_CHANNEL_ACCESS_TOKEN = '+UE3+1Bgqkp8WQoxrH7pdvyhr3QIT6bY8tWs5lFIFDeJFBMNvMCTZgUFrW/qaihdzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rz2y7UG4nD4Ict0w2q+UJpuVXsZo/hP5bmhToKpvgtowwdB04t89/1O/w1cDnyilFU=';

// ✅ テスト送信対象（後ほどWebhookログで置き換え）
const TEST_USER_ID = 'U5cb571e2ad5cfbcfdda8f21e5ded2f0a';

app.get('/test', async (req, res) => {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: TEST_USER_ID,
      messages: [
        {
          type: 'text',
          text: '📢 テストメッセージ送信成功！'
        }
      ]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).send('✅ テストメッセージを送信しました。');
  } catch (error) {
    console.error('送信エラー詳細:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    res.status(500).send('❌ テストメッセージ送信失敗');
  }
});

// ✅ Webhookエンドポイント（ユーザーIDをログ出力）
app.post('/webhook', (req, res) => {
  try {
    const events = req.body.events;
    if (events && events.length > 0) {
      const userId = events[0].source?.userId;
      const type = events[0].type;
      const message = events[0].message?.text;

      console.log('✅ Webhookイベント受信:', {
        type,
        userId,
        message
      });
    }
  } catch (err) {
    console.error('Webhook処理エラー:', err.message);
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running...');
});
