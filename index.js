const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('✅ サーバー起動成功');
});

app.listen(process.env.PORT || 8080, () => {
  console.log('🚀 Server is running on port', process.env.PORT || 8080);
});
