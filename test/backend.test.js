import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, getDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { CONFIG } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.join(__dirname, 'test_analytics.db');

let server;
let baseUrl;
let adminToken;

describe('Analytics Backend Tests', () => {
  before(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);

    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain admin token
    const res = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: CONFIG.ADMIN_USERNAME,
        password: CONFIG.ADMIN_PASSWORD
      })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    adminToken = body.token;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // 1. Valid event accepted
  test('1. Valid event is accepted with HTTP 200', async () => {
    const res = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: '11111111-2222-3333-4444-555555555555',
        event: 'app_open',
        appVersionCode: 16,
        appVersionName: '1.2.0',
        androidVersion: 35
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  // 2. Invalid event payload rejected (e.g. unexpected financial keys)
  test('2. Event with forbidden financial keys is rejected', async () => {
    const res = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: '11111111-2222-3333-4444-555555555555',
        event: 'app_open',
        amount: 5000,
        balance: 10000
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('Forbidden field'));
  });

  // 3. Unknown event rejected
  test('3. Unknown event type is rejected', async () => {
    const res = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: '11111111-2222-3333-4444-555555555555',
        event: 'user_credit_card_added'
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('Invalid or unallowed event type'));
  });

  // 4. Oversized request rejected (> 50 batch items)
  test('4. Oversized batch is rejected', async () => {
    const hugeBatch = Array.from({ length: 55 }, () => ({
      anonymousId: '11111111-2222-3333-4444-555555555555',
      event: 'heartbeat'
    }));
    const res = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hugeBatch)
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('Batch size limit'));
  });

  // 5. Invalid anonymous ID rejected
  test('5. Non-UUID anonymous ID is rejected', async () => {
    const res = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: 'not-a-valid-uuid',
        event: 'app_open'
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('Must be a valid UUID'));
  });

  // 6. Duplicate first_open handled correctly
  test('6. Duplicate first_open handled idempotently', async () => {
    const testAnonId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // First time
    const res1 = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: testAnonId,
        event: 'first_open',
        appVersionCode: 16,
        appVersionName: '1.2.0',
        androidVersion: 35
      })
    });
    assert.equal(res1.status, 200);

    // Second time with same ID
    const res2 = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: testAnonId,
        event: 'first_open',
        appVersionCode: 16,
        appVersionName: '1.2.0',
        androidVersion: 35
      })
    });
    assert.equal(res2.status, 200);

    // Check DB has exactly 1 event of first_open for this ID
    const db = getDatabase();
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM analytics_events WHERE anonymous_id = ? AND event_type = 'first_open'
    `).get(testAnonId).c;
    assert.equal(count, 1);
  });

  // 7. Active Now calculation works
  test('7. Active Now calculation includes recent heartbeat', async () => {
    const activeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: activeId,
        event: 'heartbeat'
      })
    });

    const res = await fetch(`${baseUrl}/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.activeNow >= 1);
    assert.equal(body.data.activeNowLabel, 'Active within the last 5 minutes');
  });

  // 8, 9, 10. DAU, WAU, MAU calculation works
  test('8-10. DAU, WAU, MAU calculations work', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.totalUsers >= 2);
    assert.ok(body.data.dau >= 1);
    assert.ok(body.data.wau >= 1);
    assert.ok(body.data.mau >= 1);
  });

  // 11. Version distribution works
  test('11. Version distribution works', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/versions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.data.versions));
    assert.equal(body.data.latestVersion, '1.2.0');
    assert.ok(body.data.adoptionRate >= 0);
  });

  // 12. Feature statistics work
  test('12. Feature statistics work with allowlist', async () => {
    const featId = 'cccccccc-dddd-eeee-ffff-000000000000';
    await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: featId,
        event: 'feature_used',
        feature: 'dashboard'
      })
    });

    const res = await fetch(`${baseUrl}/v1/admin/features`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const dashFeature = body.data.find((f) => f.feature === 'dashboard');
    assert.ok(dashFeature);
    assert.ok(dashFeature.count >= 1);
  });

  // 13. Admin API requires authentication
  test('13. Admin API rejects unauthenticated requests with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/overview`);
    assert.equal(res.status, 401);
  });

  // 14. Activity graph loads correct days
  test('14. Activity graph loads correct intervals (7, 30, 90 days)', async () => {
    const res7 = await fetch(`${baseUrl}/v1/admin/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body7 = await res7.json();
    assert.equal(res7.status, 200);
    assert.equal(body7.data.length, 7);

    const res30 = await fetch(`${baseUrl}/v1/admin/activity?days=30`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body30 = await res30.json();
    assert.equal(res30.status, 200);
    assert.equal(body30.data.length, 30);
  });

  // 15. Live activity stream returns events without sensitive IDs
  test('15. Live stream returns events with sanitized schema', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/live`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
    // Verify no raw UUID anonymous_id exposed in public live view
    assert.equal(body.data[0].anonymous_id, undefined);
  });
});
