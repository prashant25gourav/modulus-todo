import app from './app';
import { env } from './config/env';
import { connectDB, redactUri } from './config/db';
import pino from 'pino';

const logger = pino({
  name: 'server',
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
});

const startServer = async (): Promise<void> => {
  try {
    await connectDB(env.MONGODB_URI);

    const server = app.listen(env.PORT, () => {
      logger.info('Server running on port ' + env.PORT + ' in ' + env.NODE_ENV + ' mode');
    });

    const gracefulShutdown = (signal: string) => {
      logger.info('Received ' + signal + '. Gracefully shutting down...');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    const errName = error instanceof Error ? error.name : 'UnknownError';
    const errCode = (error as { code?: string | number })?.code ?? 'N/A';
    const rawMessage = error instanceof Error ? error.message : String(error);
    const sanitizedMessage = redactUri(rawMessage);

    logger.error(
      {
        errName,
        errCode,
        errMessage: sanitizedMessage,
      },
      'Failed to start server due to connection error'
    );
    process.exit(1);
  }
};

void startServer();
