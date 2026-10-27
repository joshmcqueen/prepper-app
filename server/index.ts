import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from './app.ts';
import { startScheduler } from './reminders.ts';

const https =
  process.env.TLS_CERT && process.env.TLS_KEY
    ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }
    : undefined;
const { app, store } = await buildApp({
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  logger: true,
  https,
});
const stopScheduler = startScheduler(store);
app.addHook('onClose', async () => {
  stopScheduler();
});
await app.listen({ port: Number(process.env.PORT || 3001), host: process.env.HOST || '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopScheduler();
    void app.close();
  });
