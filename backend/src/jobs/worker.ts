// The app's background work, in-process: run due jobs every few seconds,
// queue reminders every few minutes, prune once an hour. One pass at a time;
// a slow pass delays the next instead of overlapping it.

import { pruneJobs, queueDueReminders, runDueJobs } from './queue.js';

export function startWorker({ everyMs = 5_000 } = {}): () => void {
  let running = false;
  let ticks = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (ticks % 60 === 0) await queueDueReminders(); // ~5 minutes
      if (ticks % 720 === 0) await pruneJobs(); // ~1 hour
      while ((await runDueJobs()) > 0) {
        // drain a backlog before sleeping
      }
    } catch (error) {
      console.error('Worker pass failed:', error);
    } finally {
      ticks += 1;
      running = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
