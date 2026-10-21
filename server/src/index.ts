import { buildApp } from './app';
import { loadConfig } from './config';
import { initDatabase } from './db/open';

const config = loadConfig();
const db = initDatabase(config.dbPath, { seed: true });
const app = await buildApp({
  db,
  appEnv: config.appEnv,
  delayMs: config.bulkIssueDelayMs,
  logger: config.appEnv !== 'test',
});
app.addHook('onClose', async () => db.close());

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, closing`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`Server listening on http://127.0.0.1:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
