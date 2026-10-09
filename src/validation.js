import { CONFIG } from './config.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VERSION_NAME_REGEX = /^[0-9a-zA-Z._-]{1,20}$/;

const ALLOWED_KEYS = new Set([
  'anonymousId',
  'event',
  'feature',
  'timestamp',
  'appVersionCode',
  'appVersionName',
  'androidVersion'
]);

export function validateEventPayload(rawBody) {
  if (!rawBody || typeof rawBody !== 'object') {
    return { valid: false, error: 'Event payload must be a non-empty JSON object.' };
  }

  // 1. Strict key check: Forbid ANY unexpected key to block financial data injection
  const keys = Object.keys(rawBody);
  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key)) {
      return { valid: false, error: `Forbidden field '${key}' in analytics event payload.` };
    }
  }

  // 2. Validate anonymousId
  const { anonymousId } = rawBody;
  if (!anonymousId || typeof anonymousId !== 'string' || !UUID_REGEX.test(anonymousId)) {
    return { valid: false, error: 'Invalid or missing anonymousId. Must be a valid UUID string.' };
  }

  // 3. Validate event
  const { event } = rawBody;
  if (!event || typeof event !== 'string' || !CONFIG.ALLOWED_EVENTS.has(event)) {
    return { valid: false, error: `Invalid or unallowed event type: '${event}'.` };
  }

  // 4. Validate feature
  const { feature } = rawBody;
  if (event === 'feature_used') {
    if (!feature || typeof feature !== 'string' || !CONFIG.ALLOWED_FEATURES.has(feature)) {
      return { valid: false, error: `Invalid or unallowed feature: '${feature}'.` };
    }
  } else if (event === 'anonymous_error') {
    if (feature && !CONFIG.ALLOWED_ERROR_CATEGORIES.has(feature)) {
      return { valid: false, error: `Invalid error category: '${feature}'.` };
    }
  } else if (feature !== undefined && feature !== null) {
    return { valid: false, error: `Feature property is only allowed for 'feature_used' or 'anonymous_error'.` };
  }

  // 5. Validate timestamp
  const ts = rawBody.timestamp;
  if (ts !== undefined && ts !== null) {
    const numTs = Number(ts);
    if (isNaN(numTs) || numTs < 0) {
      return { valid: false, error: 'Timestamp must be a positive numeric timestamp.' };
    }
  }

  // 6. Validate appVersionCode
  const vc = rawBody.appVersionCode;
  if (vc !== undefined && vc !== null) {
    const numVc = Number(vc);
    if (!Number.isInteger(numVc) || numVc < 1) {
      return { valid: false, error: 'appVersionCode must be a positive integer.' };
    }
  }

  // 7. Validate appVersionName
  const vn = rawBody.appVersionName;
  if (vn !== undefined && vn !== null) {
    if (typeof vn !== 'string' || !VERSION_NAME_REGEX.test(vn)) {
      return { valid: false, error: 'appVersionName must be a valid version string.' };
    }
  }

  // 8. Validate androidVersion
  const av = rawBody.androidVersion;
  if (av !== undefined && av !== null) {
    const numAv = Number(av);
    if (!Number.isInteger(numAv) || numAv < 1 || numAv > 50) {
      return { valid: false, error: 'androidVersion must be a valid integer SDK version (e.g. 26 to 36).' };
    }
  }

  return { valid: true };
}
