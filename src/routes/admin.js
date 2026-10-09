import express from 'express';
import { getDatabase, verifyPassword } from '../db.js';
import { generateToken, requireAdminAuth } from '../auth.js';
import { CONFIG } from '../config.js';

export const adminRouter = express.Router();

// Helper to map Android SDK to OS Name
function getAndroidOsName(sdkInt) {
  const map = {
    36: 'Android 16',
    35: 'Android 15',
    34: 'Android 14',
    33: 'Android 13',
    32: 'Android 12L',
    31: 'Android 12',
    30: 'Android 11',
    29: 'Android 10',
    28: 'Android 9 Pie',
    27: 'Android 8.1 Oreo',
    26: 'Android 8.0 Oreo'
  };
  return map[sdkInt] || `Android (SDK ${sdkInt})`;
}

// ---------------- AUTHENTICATION ----------------
adminRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Bad Request', message: 'Username and password required.' });
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, username, password_hash, salt FROM admin_users WHERE username = ?').get(username);

  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid admin credentials.' });
  }

  const token = generateToken({ id: user.id, username: user.username }, 24);
  return res.status(200).json({
    status: 'ok',
    token,
    user: { id: user.id, username: user.username }
  });
});

adminRouter.post('/auth/logout', requireAdminAuth, (req, res) => {
  return res.status(200).json({ status: 'ok', message: 'Logged out successfully.' });
});

adminRouter.get('/auth/me', requireAdminAuth, (req, res) => {
  return res.status(200).json({ status: 'ok', admin: req.admin });
});

// ---------------- ANALYTICS OVERVIEW ----------------
adminRouter.get('/overview', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const now = new Date();
  const todayPrefix = now.toISOString().substring(0, 10); // YYYY-MM-DD
  const fiveMinAgoIso = new Date(Date.now() - CONFIG.ACTIVE_NOW_WINDOW_MS).toISOString();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Total Unique Users
  const totalUsersRow = db.prepare('SELECT COUNT(*) as count FROM anonymous_users').get();
  const totalUsers = totalUsersRow ? totalUsersRow.count : 0;

  // Active Now (Heartbeat or event within last 5 minutes)
  const activeNowRow = db.prepare(`
    SELECT COUNT(DISTINCT anonymous_id) as count
    FROM app_sessions
    WHERE last_heartbeat >= ?
  `).get(fiveMinAgoIso);
  const activeNow = activeNowRow ? activeNowRow.count : 0;

  // DAU (Daily Active Users today)
  const dauRow = db.prepare(`
    SELECT COUNT(DISTINCT anonymous_id) as count
    FROM analytics_events
    WHERE server_received_at >= ?
  `).get(`${todayPrefix}T00:00:00.000Z`);
  const dau = dauRow ? dauRow.count : 0;

  // WAU (Weekly Active Users, past 7 days)
  const wauRow = db.prepare(`
    SELECT COUNT(DISTINCT anonymous_id) as count
    FROM analytics_events
    WHERE server_received_at >= ?
  `).get(sevenDaysAgoIso);
  const wau = wauRow ? wauRow.count : 0;

  // MAU (Monthly Active Users, past 30 days)
  const mauRow = db.prepare(`
    SELECT COUNT(DISTINCT anonymous_id) as count
    FROM analytics_events
    WHERE server_received_at >= ?
  `).get(thirtyDaysAgoIso);
  const mau = mauRow ? mauRow.count : 0;

  // New Users Today (first_seen starts with today)
  const newUsersRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM anonymous_users
    WHERE first_seen >= ?
  `).get(`${todayPrefix}T00:00:00.000Z`);
  const newUsersToday = newUsersRow ? newUsersRow.count : 0;

  const returningUsersToday = Math.max(0, dau - newUsersToday);

  // App Opens
  const opensRow = db.prepare(`SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'app_open'`).get();
  const appOpens = opensRow ? opensRow.count : 0;

  // Total Sessions
  const sessionsRow = db.prepare('SELECT COUNT(*) as count FROM app_sessions').get();
  const sessions = sessionsRow ? sessionsRow.count : 0;

  // Error Count
  const errorRow = db.prepare(`SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'anonymous_error'`).get();
  const errorCount = errorRow ? errorRow.count : 0;

  return res.status(200).json({
    status: 'ok',
    data: {
      totalUsers,
      activeNow,
      activeNowLabel: 'Active within the last 5 minutes',
      dau,
      wau,
      mau,
      newUsersToday,
      returningUsersToday,
      appOpens,
      sessions,
      errorCount,
      serverTime: now.toISOString()
    }
  });
});

// ---------------- ACTIVITY GRAPH (DAU / Trends) ----------------
adminRouter.get('/activity', requireAdminAuth, (req, res) => {
  const db = getDatabase();
  const daysParam = parseInt(req.query.days, 10);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;

  const results = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().substring(0, 10);
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    // Active users on dateStr
    const activeRow = db.prepare(`
      SELECT COUNT(DISTINCT anonymous_id) as count
      FROM analytics_events
      WHERE server_received_at BETWEEN ? AND ?
    `).get(dayStart, dayEnd);
    const dau = activeRow ? activeRow.count : 0;

    // New users on dateStr
    const newRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM anonymous_users
      WHERE first_seen BETWEEN ? AND ?
    `).get(dayStart, dayEnd);
    const newUsers = newRow ? newRow.count : 0;

    // Sessions on dateStr
    const sessionRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM app_sessions
      WHERE started_at BETWEEN ? AND ?
    `).get(dayStart, dayEnd);
    const sessionCount = sessionRow ? sessionRow.count : 0;

    const returningUsers = Math.max(0, dau - newUsers);

    results.push({
      date: dateStr,
      dau,
      newUsers,
      returningUsers,
      sessions: sessionCount
    });
  }

  return res.status(200).json({ status: 'ok', days, data: results });
});

// ---------------- APP VERSIONS & ADOPTION ----------------
adminRouter.get('/versions', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const totalUsersRow = db.prepare('SELECT COUNT(*) as count FROM anonymous_users').get();
  const total = totalUsersRow ? totalUsersRow.count : 0;

  const rows = db.prepare(`
    SELECT app_version_code, app_version_name, COUNT(*) as users
    FROM anonymous_users
    GROUP BY app_version_code, app_version_name
    ORDER BY app_version_code DESC
  `).all();

  const versions = rows.map((r) => {
    const percentage = total > 0 ? Number(((r.users / total) * 100).toFixed(1)) : 0;
    return {
      versionCode: r.app_version_code,
      versionName: r.app_version_name,
      users: r.users,
      percentage
    };
  });

  const latestVersion = versions.length > 0 ? versions[0].versionName : '1.2.0';
  const latestUsers = versions.length > 0 ? versions[0].users : 0;
  const olderUsers = Math.max(0, total - latestUsers);
  const adoptionRate = total > 0 ? Number(((latestUsers / total) * 100).toFixed(1)) : 0;

  return res.status(200).json({
    status: 'ok',
    data: {
      versions,
      latestVersion,
      usersOnLatest: latestUsers,
      usersOnOlder: olderUsers,
      adoptionRate
    }
  });
});

// ---------------- FEATURE USAGE ----------------
adminRouter.get('/features', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const totalFeatureEventsRow = db.prepare(`
    SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'feature_used'
  `).get();
  const totalEvents = totalFeatureEventsRow ? totalFeatureEventsRow.count : 0;

  const rows = db.prepare(`
    SELECT feature, COUNT(*) as count, COUNT(DISTINCT anonymous_id) as uniqueUsers
    FROM analytics_events
    WHERE event_type = 'feature_used' AND feature IS NOT NULL
    GROUP BY feature
    ORDER BY count DESC
  `).all();

  const features = rows.map((r) => ({
    feature: r.feature,
    count: r.count,
    uniqueUsers: r.uniqueUsers,
    percentage: totalEvents > 0 ? Number(((r.count / totalEvents) * 100).toFixed(1)) : 0
  }));

  return res.status(200).json({ status: 'ok', totalEvents, data: features });
});

// ---------------- ANDROID PLATFORMS / VERSIONS ----------------
adminRouter.get('/platforms', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM anonymous_users').get();
  const total = totalRow ? totalRow.count : 0;

  const rows = db.prepare(`
    SELECT android_version, COUNT(*) as users
    FROM anonymous_users
    GROUP BY android_version
    ORDER BY android_version DESC
  `).all();

  const platforms = rows.map((r) => ({
    androidVersion: r.android_version,
    osName: getAndroidOsName(r.android_version),
    users: r.users,
    percentage: total > 0 ? Number(((r.users / total) * 100).toFixed(1)) : 0
  }));

  return res.status(200).json({ status: 'ok', data: platforms });
});

// ---------------- ERROR MONITORING ----------------
adminRouter.get('/errors', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const todayIso = `${new Date().toISOString().substring(0, 10)}T00:00:00.000Z`;
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const todayCount = db.prepare(`
    SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'anonymous_error' AND server_received_at >= ?
  `).get(todayIso)?.count || 0;

  const weekCount = db.prepare(`
    SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'anonymous_error' AND server_received_at >= ?
  `).get(sevenDaysAgoIso)?.count || 0;

  const monthCount = db.prepare(`
    SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'anonymous_error' AND server_received_at >= ?
  `).get(thirtyDaysAgoIso)?.count || 0;

  const categories = db.prepare(`
    SELECT COALESCE(feature, 'general_runtime_error') as category, COUNT(*) as count
    FROM analytics_events
    WHERE event_type = 'anonymous_error'
    GROUP BY category
    ORDER BY count DESC
  `).all();

  return res.status(200).json({
    status: 'ok',
    data: {
      today: todayCount,
      thisWeek: weekCount,
      thisMonth: monthCount,
      categories
    }
  });
});

// ---------------- LIVE ACTIVITY STREAM ----------------
adminRouter.get('/live', requireAdminAuth, (req, res) => {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, event_type, feature, app_version_name, android_version, server_received_at
    FROM analytics_events
    ORDER BY id DESC
    LIMIT 30
  `).all();

  const live = rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    feature: r.feature,
    appVersionName: r.app_version_name,
    androidVersion: r.android_version,
    osName: getAndroidOsName(r.android_version),
    serverReceivedAt: r.server_received_at
  }));

  return res.status(200).json({ status: 'ok', count: live.length, data: live });
});
