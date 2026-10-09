export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute
  const maxRequests = options.max || 120; // 120 reqs/min

  const hits = new Map();

  // Periodic cleanup every 2 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits.entries()) {
      if (now - data.resetTime > windowMs) {
        hits.delete(key);
      }
    }
  }, 2 * 60 * 1000).unref();

  return function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${ip}`;

    const now = Date.now();
    let record = hits.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please wait before retrying.'
      });
    }

    next();
  };
}
