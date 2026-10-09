import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 4000,
  DB_PATH: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'analytics.db'),
  JWT_SECRET: process.env.JWT_SECRET || process.env.ADMIN_SECRET || 'amar-hishab-dev-analytics-secret-key-2026',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'AmarHishabAdmin2026!',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RETENTION_DAYS_RAW_EVENTS: process.env.RETENTION_DAYS_RAW_EVENTS ? parseInt(process.env.RETENTION_DAYS_RAW_EVENTS, 10) : 90,
  ACTIVE_NOW_WINDOW_MS: 5 * 60 * 1000, // 5 minutes

  // Strict allowlists
  ALLOWED_EVENTS: new Set([
    'first_open',
    'app_open',
    'session_start',
    'heartbeat',
    'feature_used',
    'update_check',
    'update_available',
    'update_installed',
    'anonymous_error'
  ]),

  ALLOWED_FEATURES: new Set([
    'dashboard',
    'add_transaction',
    'transactions',
    'reports',
    'backup',
    'restore',
    'import',
    'export',
    'goals',
    'budget',
    'forecast',
    'monthly_comparison',
    'spending_insights',
    'profile',
    'settings',
    'notifications',
    'transfer',
    'custom_categories',
    'statement',
    'business_dashboard'
  ]),

  ALLOWED_ERROR_CATEGORIES: new Set([
    'sync_network_error',
    'storage_io_error',
    'data_format_error',
    'biometric_auth_error',
    'general_runtime_error'
  ])
};
