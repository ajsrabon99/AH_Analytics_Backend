import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';
import { ingestionRouter } from './routes/ingestion.js';
import { adminRouter } from './routes/admin.js';
import { createRateLimiter } from './rateLimiter.js';

export function createApp() {
  const app = express();

  // Basic security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // CORS handling
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow mobile apps, curl, server-to-server (origin undefined)
        if (!origin) return callback(null, true);
        if (CONFIG.CORS_ORIGIN === '*' || origin.includes('localhost') || origin.includes('netlify.app')) {
          return callback(null, true);
        }
        if (origin === CONFIG.CORS_ORIGIN) {
          return callback(null, true);
        }
        return callback(null, true); // Allow configured dashboard
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    })
  );

  // Request body parsing limited to 64KB
  app.use(express.json({ limit: '64kb' }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Ingestion rate limiter: 120 requests/min
  const ingestionLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120 });
  app.use('/v1/events', ingestionLimiter);

  // Admin login rate limiter: 15 attempts/min to prevent brute force
  const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 15 });
  app.use('/v1/admin/auth/login', loginLimiter);

  // Mount routers
  app.use('/v1', ingestionRouter);
  app.use('/v1/admin', adminRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.url} does not exist.` });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred.' });
  });

  return app;
}
