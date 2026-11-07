import { createApp } from "./app.js";
import 'dotenv/config';
import { getMailer } from './lib/mailer.js';
import { startWorker } from './jobs/worker.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();
// Missing email config is loud but not fatal: emails wait in the outbox.
try {
  getMailer();
} catch (error) {
  console.error(`Email is not configured; emails will wait in the outbox: ${(error as Error).message}`);
}
startWorker();

app.listen(port, () => {
  console.log(`Server listening on port ${port}...`);
});