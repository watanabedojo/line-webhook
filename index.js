const express = require('express');
const app = express();
app.use(express.json());

app.post('/', (req, res) => {
  const events = req.body.events;
  if (events && events.length > 0) {
    const userId = events[0].source.userId;
    console.log("ユーザーID:", userId);
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get('/test', async (req, res) => {
  const message = "📢 これはテスト送信です！Cloud Runは動作しています。";
  try {
    const response = await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: {
        "Authorization": "Bearer あなたのLINE Notifyトークン",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `message=${encodeURIComponent(message)}`
    });
    console.log(await response.text());
    res.send("LINEへ送信完了！");
  } catch (err) {
    console.error("送信エラー", err);
    res.status(500).send("送信失敗");
  }
});
