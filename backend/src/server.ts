import { createApp } from "./app.js";
import 'dotenv/config';
import { getMailer } from './lib/mailer.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();
// Missing email config is loud but not fatal: everything except invitations still works.
try {
  getMailer();
} catch (error) {
  console.error(`Email is not configured, so invitations will fail: ${(error as Error).message}`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}...`);
});