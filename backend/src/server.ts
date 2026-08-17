import { createApp } from "./app.js";
import 'dotenv/config';

const port = process.env.PORT;
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening on port ${port}...`);
});