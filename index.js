const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

// LINE設定
const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';

// Firestore 初期化
let firestore, usersCollection;
try {
  firestore = new Firestore();
  usersCollection = firestore.collection('users');
  console.log('✅ Firestore 初期化成功');
} catch (e) {
  console.error('❌ Firestore 初期化エラー:', e.message);
  process.exit(1);
}

// JWT認証（Googleカレンダー）
const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);
const calendar = google.calendar({ version: 'v3', auth: jwtClient });

// JSTの1日分の範囲
function getJSTRange() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jstNow.getFullYear(), m = jstNow.getMonth(), d = jstNow.getDate();
  const start = new Date(Date.UTC(y, m, d, -9, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, -9, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

// 日付整形
function formatDateTime(datetimeStr) {
  const dt = new Date(datetimeStr);
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

// 予定取得（説明に「全体通知」を含む）
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

  const allEvents = res.data.items || [];

  const events = allEvents.filter(event =>
    event.description && event.description.includes('全体通知')
  );

  if (events.length === 0) {
    return ['📢 今日の「全体通知」対象の予定はありません。'];
  }

  let message = `おはようございます。\n本日の予定をお知らせします。\n`;

  for (const event of events) {
    const startTime = formatDateTime(event.start.dateTime || event.start.date);
    const endTime = formatDateTime(event.end.dateTime || event.end.date);
    message += `\n📢 ${event.summary}\n日時：${startTime}〜${endTime}`;
    if (event.location) message += `\n場所：${event.location}`;
    message += `\n内容：${event.description}`;
    message += `\n\nご不明な点はご連絡ください。\nご確認お願いいたします。\n`;
  }

  return [message.trim()];
}

// LINE通知送信
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

// Webhook：友だち追加時にFirestore保存
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (event?.type === 'follow') {
    const userId = event.source.userId;
    console.log('🆕 新しい友だち追加:', userId);

    const docRef = usersCollection.doc(userId);
    try {
      const doc = await docRef.get();
      if (!doc.exists) {
        await docRef.set({});
        console.log('✅ Firestoreに保存:', userId);
      }
      await sendLineMessage(
        '友だち追加ありがとうございます！今後、空手道場の予定を自動でお知らせします📢',
        userId
      );
    } catch (err) {
      console.error('❌ Firestore保存エラー:', err.message);
    }
  }
  res.sendStatus(200);
});

// 全ユーザーにカレンダー通知（Firestore NOT_FOUND対策付き）
app.get('/calendar/broadcast', async (req, res) => {
  try {
    const messages = await getTodaysEvents();
    const snapshot = await usersCollection.get();

    if (snapshot.empty) {
      console.log('⚠️ Firestoreにユーザーが登録されていません');
      return res.status(404).send('ユーザーがいません');
    }

    for (const doc of snapshot.docs) {
      const userId = doc.id;

      if (!userId) {
        console.warn('⚠️ 無効なuserIdをスキップ');
        continue;
      }

      for (const message of messages) {
        try {
          console.log(`📤 通知送信対象: ${userId}`);
          await sendLineMessage(message, userId);
        } catch (err) {
          console.error(`❌ ${userId}への送信失敗:`, err.message);
        }
      }
    }

    res.send('✅ 全ユーザーに送信完了');
  } catch (error) {
    console.error('❌ broadcast全体の通知処理に失敗:', error.message);
    res.status(500).send('サーバーエラー');
  }
});

// サーバー起動
app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
