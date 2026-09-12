import { createApp } from "./app.js";
import 'dotenv/config';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening on port ${port}...`);
});