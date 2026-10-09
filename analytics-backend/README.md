# Amar Hishab — Developer Analytics Backend

Dedicated, lightweight, and completely isolated developer analytics backend for **Amar Hishab (আমার হিসাব)**.

## Key Features & Security Guarantees
- **Strictly Non-PII & Zero Financial Telemetry:** Rejects any request with financial data, personal details, balances, amounts, or unexpected fields.
- **Anonymous Install UUID:** Operates exclusively with anonymous UUID identifiers generated client-side.
- **Idempotent Ingestion:** Prevents duplicate `first_open` metrics from corrupting Total Users counts.
- **Active Now:** Computes active users based on the latest heartbeat received within the last 5 minutes.
- **Authenticated Admin Endpoints:** Protected by HMAC-SHA256 JWT tokens. Password hashed with PBKDF2 (100,000 rounds).
- **Data Retention:** Automatically prunes raw event logs older than configured retention period (default: 90 days).

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Run in production:
   ```bash
   npm start
   ```

4. Run test suite:
   ```bash
   npm test
   ```

## Production Deployment
Can be deployed to any Node.js hosting platform (Render, Railway, Fly.io, VPS, DigitalOcean, or AWS):
- Node version: 20+
- Start command: `npm start`
- Persistent disk: mount `/data` for `analytics.db` if using SQLite (or replace `db.js` with PostgreSQL adapter).
