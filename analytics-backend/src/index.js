import { CONFIG } from './config.js';
import { initDatabase, pruneOldEvents } from './db.js';
import { createApp } from './app.js';

// 1. Initialize SQLite database and default admin user
initDatabase(CONFIG.DB_PATH);
console.log(`[Amar Hishab Analytics] Database initialized at ${CONFIG.DB_PATH}`);

// 2. Schedule daily retention cleanup
setInterval(() => {
  try {
    const pruned = pruneOldEvents(CONFIG.RETENTION_DAYS_RAW_EVENTS);
    if (pruned > 0) {
      console.log(`[Retention Policy] Pruned ${pruned} raw events older than ${CONFIG.RETENTION_DAYS_RAW_EVENTS} days`);
    }
  } catch (err) {
    console.error('[Retention Policy] Prune error:', err);
  }
}, 24 * 60 * 60 * 1000).unref();

// 3. Start Express server
const app = createApp();

app.listen(CONFIG.PORT, () => {
  console.log(`[Amar Hishab Analytics Backend] Listening on port ${CONFIG.PORT}`);
  console.log(`- Ingestion endpoint: POST http://localhost:${CONFIG.PORT}/v1/events`);
  console.log(`- Admin overview:     GET  http://localhost:${CONFIG.PORT}/v1/admin/overview`);
});
