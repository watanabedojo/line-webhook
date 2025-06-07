
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = 'Ex3aNn9jbX8JY3KAL85d8jLM0we0vqQXsLrtXaWh06pWxwWzsR7UGXD9QRd2QAUbzlO6LkGIMb6wJYBGFyflXZoy3IC8mtZ1mOSO7GMo/rzcYXvhEx4ZmjBIH8ZqHCNbQSzXSkMwOTNovmCfGfI1BAdB04t89/1O/w1cDnyilFU=';
const CALENDAR_ID = 'jks.watanabe.dojo@gmail.com';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbz915raOlkxis1vx_7vvJjVdA5KzNquZUAt1QckbJVCCcxM6MEj4RhCX-4WDyT6ZImP/exec';

const firestore = new Firestore();
const usersCollection = firestore.collection('users');
const tokensCollection = firestore.collection('eventTokens');

const jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar.readonly']
);
const calendar = google.calendar({ version: 'v3', auth: jwtClient });

function getField(text, label) {
  const regex = new RegExp(`${label}[\s\n]*([^\n]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

async function postToSheet(data) {
  try {
    await axios.post(GAS_WEBHOOK_URL, data, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('📝 スプレッドシート送信成功');
  } catch (err) {
    console.error('❌ スプレッドシート送信失敗:', err.message);
  }
}

async function getVisitorEventsOneMonth() {
  await jwtClient.authorize();
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  jstNow.setHours(0, 0, 0, 0);
  const endJST = new Date(jstNow);
  endJST.setMonth(endJST.getMonth() + 1);
  endJST.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: jstNow.toISOString(),
    timeMax: endJST.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const allEvents = res.data.items || [];
  return allEvents.filter(e => e.description?.includes('ビジター'));
}

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

app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (!event) return res.sendStatus(200);
  const userId = event.source?.userId;
  const replyToken = event.replyToken;

  const exists = await tokensCollection.doc(replyToken).get();
  if (exists.exists) return res.sendStatus(200);
  await tokensCollection.doc(replyToken).set({ handled: true });

  if (event.type === 'message') {
    const text = event.message.text;

    if (text === 'ビジター申込') {
      const events = await getVisitorEventsOneMonth();
      if (events.length === 0) return await sendLineMessage('該当する予定が見つかりませんでした。', userId);

      const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const eventsText = events.map(e => {
        const start = new Date(e.start.dateTime || e.start.date);
        const weekday = weekdayNames[start.getDay()];
        const time = `${start.getMonth() + 1}月${start.getDate()}日（${weekday}）${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        return time;
      }).join('\n\n');

      const message1 = `お問い合わせありがとうございます。
現在予定している稽古日時を現在から1ヶ月分お知らせします。

【日時一覧】
${eventsText}

このあと続けて返信用テンプレートを送信します。
文面を長押しして「コピー」→メッセージ入力画面を長押しして「ペースト」をしていただくと入力がスムーズです。
ご不明点は「お問い合わせ」からいつでもお気軽にどうぞ。`;

      const message2 = `【希望日時】
〇月〇日
【お名前】
〇〇 〇〇
【学年or年齢】
○○
【所属道場】
○○
【参加の許可を所属道場長の許可】
得ている・確認中
【ご連絡事項（あれば）】`;

      await sendLineMessage(message1, userId);
      await sendLineMessage(message2, userId);
    }

    if (text.includes('お名前') && text.includes('所属道場')) {
      const parsed = {
        userId,
        name: getField(text, '【お名前】'),
        grade: getField(text, '【学年or年齢】'),
        dojo: getField(text, '【所属道場】'),
        permission: getField(text, '【参加の許可を所属道場長の許可】'),
        date: getField(text, '【希望日時】'),
        note: getField(text, '【ご連絡事項（あれば）】'),
        source: 'LINE'
      };

      await postToSheet(parsed);

      const response = `${parsed.name}さん
ご回答ありがとうございます。
${parsed.date}
場所：渡邊道場
参加費：3,000円　家族割あり2名以上で1名につき1,000円割引
前日に再度ご連絡いたします、何かご不明点があれば公式LINEのお問い合わせからどうぞ。`;
      await sendLineMessage(response, userId);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
