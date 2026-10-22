import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { getDbState } from './config/db';
import authRoutes from './routes/auth.routes';

const app = express();

// Security Note on Reverse Proxies:
// 'trust proxy' is intentionally NOT configured at this stage. It will be configured
// during production deployment according to the specific reverse proxy topology
// (e.g., AWS ALB, Nginx, Cloudflare) to prevent client IP spoofing in rate-limiting
// and request logging.

// Security middleware
app.use(helmet());
app.use(cors());

// HTTP request logging with strict data redaction
// Ensures credentials, auth tokens, session cookies, and passwords are never logged.
// Request bodies are omitted from serializers to prevent logging sensitive payload data.
export const httpLogger = pinoHttp({
  logger: pino({
    level: process.env.NODE_ENV === 'test' && !process.env.TEST_LOGS ? 'silent' : 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        'password',
        'req.body.password',
        '*.passwordHash',
        'passwordHash',
      ],
      censor: '[REDACTED]',
    },
  }),
  serializers: {
    req(req) {
      const sanitized = pino.stdSerializers.req(req);
      delete (sanitized as unknown as Record<string, unknown>).body;
      return sanitized;
    },
  },
});
app.use(httpLogger);

// Global rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests, please try again later.',
  },
});
app.use(limiter);

// Body parsing with strict 10kb limit
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  const dbState = getDbState();
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbState,
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Resource not found',
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const errObj = err as { type?: string; status?: number; statusCode?: number };
  const statusCode = errObj.status || errObj.statusCode || 500;

  // Handle malformed JSON body parser error (consistent 400 JSON response, no stack trace)
  if (
    errObj.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400)
  ) {
    res.status(400).json({
      status: 'error',
      message: 'Malformed JSON payload',
    });
    return;
  }

  // Handle payload too large error (consistent 413 JSON response, no stack trace)
  if (errObj.type === 'entity.too.large' || statusCode === 413) {
    res.status(413).json({
      status: 'error',
      message: 'Payload too large',
    });
    return;
  }

  // Consistent error response; omit stack trace in production and on client errors
  const showStack = !isProduction && statusCode >= 500;
  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    ...(showStack ? { stack: err.stack } : {}),
  });
});

export default app;
