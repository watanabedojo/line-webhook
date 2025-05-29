const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

app.use(bodyParser.json());

// チャネルアクセストークン（固定で貼り付け済）
const LINE_CHANNEL_ACCESS_TOKEN = 'VQiW6DqQ4+jM/qrPQrMNJw5q12FfewjL2gf6ybdHpAcVLhcOUsbny6ihd13/DbLazlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rxUvXkrrC+SAY+SQWpN89+s321O9CKh4YTlRFt/H58C8gdB04t89/1O/w1cDnyilFU=';

// テスト送信用ユーザーID
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

    res.status(200).send('テストメッセージを送信しました。');
  } catch (error) {
    console.error('送信エラー:', error.response?.data || error.message);
    res.status(500).send('送信失敗');
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running...');
});
