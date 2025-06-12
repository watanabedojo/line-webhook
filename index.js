// 🔁 JST対応済 + 日本語曜日対応 LINE Bot 完全コード（登録機能 + Gmail通知）
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');
const key = require('/secrets/line-bot-key.json');
const nodemailer = require('nodemailer');

const dayjs = require('dayjs');
require('dayjs/locale/ja');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ja');

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://watanabedojo.jp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://watanabedojo.jp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

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

function sendEmailNotification(subject, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'jks.watanabe.dojo@gmail.com',
      pass: 'uuzo gxgz kqwx kera'
    }
  });
  const mailOptions = {
    from: 'jks.watanabe.dojo@gmail.com',
    to: '通知先メール@example.com',
    subject,
    text: body
  };
  return transporter.sendMail(mailOptions);
}
// 🔧 通知用にメッセージを送ったらGmailでも送信（例：sendLineMessageの後など）
// await sendEmailNotification('LINEで新規メッセージ受信', `ユーザーID: ${userId}\nメッセージ内容: ${text}`);

function getField(text, label) {
  const regex = new RegExp(`${label}[\s\n]*([^\n]+)`);
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function toHalfWidth(str) {
  return str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
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
  const now = dayjs().tz('Asia/Tokyo').startOf('day');
  const end = now.add(1, 'month').endOf('day');

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).filter(e => e.description?.includes('ビジター'));
}

async function sendLineMessage(text, to) {
  try {
    console.log('📤 Sending message to:', to);
    console.log('📄 Message content:', text);

    const res = await axios.post('https://api.line.me/v2/bot/message/push', {
      to,
      messages: [{ type: 'text', text }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    console.log('✅ LINE message sent successfully:', res.data);
  } catch (err) {
    console.error('❌ LINE message send failed:', err.response?.data || err.message);
  }
}


app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0];
  if (!event) return res.sendStatus(200);
  const userId = event.source?.userId;
  const replyToken = event.replyToken;

  const exists = await tokensCollection.doc(replyToken).get();
  if (exists.exists) return res.sendStatus(200);
  await tokensCollection.doc(replyToken).set({ handled: true });

  if (event.type === 'follow') {
    await usersCollection.doc(userId).set({ joinedAt: new Date(), source: 'follow' }, { merge: true });
    await sendLineMessage('ご登録ありがとうございます！次回から稽古予定日の前日に稽古案内が届きますので、通知は「オン」のままご利用ください。', userId);
  }

  if (event.type === 'message') {
    const text = event.message.text;

    if (text === '登録') {
      const already = await usersCollection.doc(userId).get();
      if (already.exists) {
        await sendLineMessage('すでに登録されています。ありがとうございます！', userId);
        return;
      }
      await usersCollection.doc(userId).set({ userId, registeredAt: dayjs().tz('Asia/Tokyo').format(), source: 'manual' });
      await sendLineMessage(`ご登録ありがとうございます！

このLINEは他の方には見えません。
ご自身だけにメッセージが届く形式になっておりますのでご安心ください。

今後、大会情報や稽古予定などをLINEでお知らせします。
引き続きよろしくお願いいたします。`, userId);
    }

    if (text === 'ビジター申込') {
      const events = await getVisitorEventsOneMonth();
      if (events.length === 0) return await sendLineMessage('該当する予定が見つかりませんでした。', userId);

      const eventsText = events.map(e => {
        const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
        return `・${jst.format('M月D日（dd） HH:mm')}`;
      }).join('\n\n');

      const message1 = `お問い合わせありがとうございます。
現在予定している稽古日時を現在から1ヶ月分お知らせします。

【日時一覧】
${eventsText}

このあと続けて返信用テンプレートを送信します。
文面を長押しして「コピー」→メッセージ入力画面を長押しして「ペースト」してください。
ご不明点は「お問い合わせ」からどうぞ。`;

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

      const dateText = toHalfWidth(parsed.date);
      const matches = [...dateText.matchAll(/(\d{1,2})月(\d{1,2})日/g)];
      const dateKeyList = matches.map(m => `${parseInt(m[1])}月${parseInt(m[2])}日`);
      parsed.dateKeyList = dateKeyList;

      await postToSheet(parsed);
      await usersCollection.doc(userId).set(parsed, { merge: true });

      const events = await getVisitorEventsOneMonth();
      let place = '場所未定';
      if (matches[0]) {
        const month = parseInt(matches[0][1]);
        const day = parseInt(matches[0][2]);
        const matched = events.find(e => {
          const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
          return jst.month() + 1 === month && jst.date() === day;
        });
        if (matched) place = matched.location || place;
      }

      const response = `${parsed.name}さん

ご回答ありがとうございます。

${parsed.date}
場所：${place}

参加費：3,000円　家族割あり（2名以上で1名につき1,000円割引）

前日に再度ご連絡いたします。
ご不明点は公式LINEの「お問い合わせ」からどうぞ。`;

      await sendLineMessage(response, userId);
    }
  }

  res.sendStatus(200);
});

// 🔐 SNS等のクローラーによる意図しない実行を防止
app.post('/broadcast/visitors', async (req, res) => {
  const ua = req.headers['user-agent'] || '';
  const forbiddenAgents = ['facebookexternalhit', 'Line', 'bot', 'Slackbot'];
  if (forbiddenAgents.some(agent => ua.includes(agent))) {
    return res.status(403).send('Forbidden: suspected crawler access');
  }

  const now = dayjs().tz('Asia/Tokyo');
  const tomorrow = now.add(1, 'day');
  const dateKey = `${tomorrow.month() + 1}月${tomorrow.date()}日`;

  const events = await getVisitorEventsOneMonth();
  const tomorrowEvents = events.filter(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return jst.date() === tomorrow.date() && jst.month() === tomorrow.month();
  });

  if (tomorrowEvents.length === 0) return res.send('明日の予定はありません。');

  const messages = tomorrowEvents.map(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return `日時：${jst.format('M月D日（dd） HH:mm')}

場所：${e.location || '未定'}

内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  const snapshot = await usersCollection.get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (Array.isArray(data.dateKeyList) && data.dateKeyList.includes(dateKey)) {
      await sendLineMessage(`【明日の稽古予定】\n\n${messages}`, doc.id);
      count++;
    }
  }

  res.send(`✅ 予約者（${count}名）に送信完了`);
});

app.post('/broadcast/all', async (req, res) => {
  const now = dayjs().tz('Asia/Tokyo');
  const tomorrow = now.add(1, 'day');

  const events = await getVisitorEventsOneMonth();
  const tomorrowEvents = events.filter(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return jst.date() === tomorrow.date() && jst.month() === tomorrow.month();
  });

  if (tomorrowEvents.length === 0) return res.send('明日の予定はありません。');

  const messages = tomorrowEvents.map(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return `日時：${jst.format('M月D日（dd） HH:mm')}

場所：${e.location || '未定'}

内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  const snapshot = await usersCollection.get();
  for (const doc of snapshot.docs) {
    await sendLineMessage(`【明日の稽古予定】\n\n${messages}`, doc.id);
  }

  res.send('✅ 全体送信完了');
});

app.get('/message/weekly', async (req, res) => {
  try {
    await jwtClient.authorize();
    const now = dayjs().tz('Asia/Tokyo').startOf('day');
    const endOfMonth = now.endOf('month');

    const resCal = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: endOfMonth.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (resCal.data.items || []).filter(e => e.description?.includes('ビジター'));

    if (events.length === 0) {
      return res.send('現在、今月末までに予定されているビジター稽古はありません。');
    }

    const scheduleText = events.map(e => {
      const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
      const place = e.location || '場所未定';
      return `・${jst.format('M月D日（dd） HH:mm')}（${place}）`;
    }).join('\n');

    const message = `🥋【今月の稽古予定】

こんにちは、渡邊道場です！  
以下の日程で稽古を予定しています👇

${scheduleText}

✨最近の声をご紹介✨  
「対人練習が本格的で刺激になる」  
「先生のアドバイスが的確でありがたい」  
── そんなご感想をいただいています。

出稽古・ビジターの皆さまも大歓迎です。  
気になる日があれば、お気軽にLINEでご相談ください！`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(message);
  } catch (error) {
    console.error('❌ /message/weekly エラー:', error);
    res.status(500).send('予定の取得中にエラーが発生しました。');
  }
});

// 🔧 テストモード：特定ユーザーへのみ送信（開発者用）
app.post('/broadcast/test', async (req, res) => {
  const ua = req.headers['user-agent'] || '';
  const forbiddenAgents = ['facebookexternalhit', 'Line', 'bot', 'Slackbot'];
  if (forbiddenAgents.some(agent => ua.includes(agent))) {
    return res.status(403).send('Forbidden: suspected crawler access');
  }

  const TEST_USER_ID = 'U5cb571e2ad5fcbcdfda8f2105edd2f0a'; // ←あなたのID

  const now = dayjs().tz('Asia/Tokyo');
  const tomorrow = now.add(1, 'day');

  const events = await getVisitorEventsOneMonth();
  const tomorrowEvents = events.filter(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return jst.date() === tomorrow.date() && jst.month() === tomorrow.month();
  });

  if (tomorrowEvents.length === 0) return res.send('明日の予定はありません。');

  const messages = tomorrowEvents.map(e => {
    const jst = dayjs(e.start.dateTime || e.start.date).tz('Asia/Tokyo');
    return `日時：${jst.format('M月D日（dd） HH:mm')}

場所：${e.location || '未定'}

内容：${e.description || ''}`;
  }).join('\n\n---\n\n');

  await sendLineMessage(`【明日の稽古予定（テスト送信）】\n\n${messages}`, TEST_USER_ID);

  return res.send('✅ テストユーザーに送信完了');
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server running on port 8080');
});
