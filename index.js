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