import dotenv from 'dotenv';
import app from './app.js';

dotenv.config();

const port = Number(process.env.MNG_PORT || 8504);

app.listen(port, () => {
  console.log(`Management console backend listening on port ${port}`);
});
