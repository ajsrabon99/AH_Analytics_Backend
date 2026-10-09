import express from 'express';
import { getDatabase } from '../db.js';
import { validateEventPayload } from '../validation.js';

export const ingestionRouter = express.Router();

function processSingleEvent(db, eventData, nowIso) {
  const {
    anonymousId,
    event,
    feature = null,
    timestamp,
    appVersionCode = 16,
    appVersionName = '1.2.0',
    androidVersion = 35
  } = eventData;

  const eventTimeIso = timestamp ? new Date(Number(timestamp)).toISOString() : nowIso;

  // 1. Check or upsert anonymous_users
  const userStmt = db.prepare('SELECT id, first_seen FROM anonymous_users WHERE anonymous_id = ?');
  const existingUser = userStmt.get(anonymousId);

  if (!existingUser) {
    const insertUser = db.prepare(`
      INSERT INTO anonymous_users (
        anonymous_id, first_seen, last_seen, app_version_code, app_version_name, android_version
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(anonymousId, eventTimeIso, nowIso, appVersionCode, appVersionName, androidVersion);
  } else {
    const updateUser = db.prepare(`
      UPDATE anonymous_users
      SET last_seen = ?, app_version_code = ?, app_version_name = ?, android_version = ?
      WHERE anonymous_id = ?
    `);
    updateUser.run(nowIso, appVersionCode, appVersionName, androidVersion, anonymousId);
  }

  // 2. Idempotent check for 'first_open'
  if (event === 'first_open') {
    const checkFirstOpen = db.prepare(`
      SELECT id FROM analytics_events WHERE anonymous_id = ? AND event_type = 'first_open' LIMIT 1
    `).get(anonymousId);

    if (checkFirstOpen) {
      // Deduplicated: Already logged first_open for this installation
      return;
    }
  }

  // 3. Insert into analytics_events
  const insertEvent = db.prepare(`
    INSERT INTO analytics_events (
      anonymous_id, event_type, feature, event_time, server_received_at, app_version_code, app_version_name, android_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run(
    anonymousId,
    event,
    feature,
    eventTimeIso,
    nowIso,
    appVersionCode,
    appVersionName,
    androidVersion
  );

  // 4. Session & heartbeat handling
  if (event === 'session_start' || event === 'app_open') {
    // Check if there is an active session within the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const activeSession = db.prepare(`
      SELECT id FROM app_sessions
      WHERE anonymous_id = ? AND last_heartbeat > ? AND ended_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(anonymousId, tenMinutesAgo);

    if (!activeSession) {
      const createSession = db.prepare(`
        INSERT INTO app_sessions (anonymous_id, started_at, last_heartbeat, ended_at, app_version_code)
        VALUES (?, ?, ?, NULL, ?)
      `);
      createSession.run(anonymousId, eventTimeIso, nowIso, appVersionCode);
    } else {
      const updateSession = db.prepare(`
        UPDATE app_sessions SET last_heartbeat = ? WHERE id = ?
      `);
      updateSession.run(nowIso, activeSession.id);
    }
  } else if (event === 'heartbeat') {
    // Update latest active session or create if missing
    const activeSession = db.prepare(`
      SELECT id FROM app_sessions
      WHERE anonymous_id = ? AND ended_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(anonymousId);

    if (activeSession) {
      const updateSession = db.prepare(`
        UPDATE app_sessions SET last_heartbeat = ? WHERE id = ?
      `);
      updateSession.run(nowIso, activeSession.id);
    } else {
      const createSession = db.prepare(`
        INSERT INTO app_sessions (anonymous_id, started_at, last_heartbeat, ended_at, app_version_code)
        VALUES (?, ?, ?, NULL, ?)
      `);
      createSession.run(anonymousId, eventTimeIso, nowIso, appVersionCode);
    }
  }
}

ingestionRouter.post('/events', (req, res) => {
  const body = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing request body.' });
  }

  const events = Array.isArray(body) ? body : [body];

  if (events.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'No events provided.' });
  }

  if (events.length > 50) {
    return res.status(400).json({ error: 'Bad Request', message: 'Batch size limit is 50 events.' });
  }

  // Validate all events first
  for (let i = 0; i < events.length; i++) {
    const validation = validateEventPayload(events[i]);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Validation failed for event at index ${i}: ${validation.error}`
      });
    }
  }

  const db = getDatabase();
  const nowIso = new Date().toISOString();

  try {
    for (const evt of events) {
      processSingleEvent(db, evt, nowIso);
    }
    return res.status(200).json({ status: 'ok', received: events.length });
  } catch (err) {
    console.error('Ingestion error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to record telemetry.' });
  }
});
