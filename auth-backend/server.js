import 'dotenv/config';

import app from './app.js';

const port = process.env.PORT || 3000;

app.listen(port, function onListen() {
  console.log(`Auth backend listening on port ${port}`);
});
