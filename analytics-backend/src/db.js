import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG } from './config.js';

let dbInstance = null;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

export function initDatabase(dbFilePath = CONFIG.DB_PATH) {
  if (dbInstance) {
    return dbInstance;
  }

  // Ensure parent folder exists
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbFilePath);

  // Enable WAL mode for high concurrency
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // 1. anonymous_users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS anonymous_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT UNIQUE NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      app_version_code INTEGER NOT NULL,
      app_version_name TEXT NOT NULL,
      android_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_anon_users_id ON anonymous_users (anonymous_id);
    CREATE INDEX IF NOT EXISTS idx_anon_users_last_seen ON anonymous_users (last_seen);
  `);

  // 2. analytics_events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      feature TEXT,
      event_time TEXT NOT NULL,
      server_received_at TEXT NOT NULL,
      app_version_code INTEGER NOT NULL,
      app_version_name TEXT NOT NULL,
      android_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_anon_id ON analytics_events (anonymous_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events (event_type);
    CREATE INDEX IF NOT EXISTS idx_events_time ON analytics_events (event_time);
    CREATE INDEX IF NOT EXISTS idx_events_server_at ON analytics_events (server_received_at);
    CREATE INDEX IF NOT EXISTS idx_events_version ON analytics_events (app_version_code);
  `);

  // 3. app_sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      ended_at TEXT,
      app_version_code INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_anon_id ON app_sessions (anonymous_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_hb ON app_sessions (last_heartbeat);
  `);

  // 4. app_versions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_versions (
      version_code INTEGER PRIMARY KEY,
      version_name TEXT NOT NULL,
      release_date TEXT NOT NULL
    );
  `);

  // Seed baseline version v1.2.0 and v1.1.8
  const insertVersion = db.prepare(`
    INSERT OR IGNORE INTO app_versions (version_code, version_name, release_date)
    VALUES (?, ?, ?)
  `);
  insertVersion.run(15, '1.1.8', '2026-09-30');
  insertVersion.run(16, '1.2.0', '2026-10-06');

  // 5. admin_users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Seed default admin user if none exists
  const checkAdmin = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (checkAdmin.count === 0) {
    const { hash, salt } = hashPassword(CONFIG.ADMIN_PASSWORD);
    const insertAdmin = db.prepare(`
      INSERT INTO admin_users (username, password_hash, salt, created_at)
      VALUES (?, ?, ?, ?)
    `);
    insertAdmin.run(CONFIG.ADMIN_USERNAME, hash, salt, new Date().toISOString());
  }

  dbInstance = db;
  return dbInstance;
}

export function getDatabase() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function pruneOldEvents(retentionDays = CONFIG.RETENTION_DAYS_RAW_EVENTS) {
  const db = getDatabase();
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleteStmt = db.prepare('DELETE FROM analytics_events WHERE server_received_at < ?');
  const result = deleteStmt.run(cutoffDate);
  return result.changes;
}
