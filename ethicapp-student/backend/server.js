import 'dotenv/config';
import app from './app.js';

const port = process.env.ETHICAPP_STUDENT_NODE_PORT || 8503;

app.listen(port, () => {
  console.log(`Ethicapp Student backend listening on port ${port}`);
});
