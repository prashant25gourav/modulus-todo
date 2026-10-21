import mongoose from 'mongoose';
import pino from 'pino';

export const logger = pino({
  name: 'db',
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
});

/**
 * Replace any MongoDB connection URI with [redacted] to prevent credential leaks.
 */
export const redactUri = (text: string): string => {
  return text.replace(/mongodb(\+srv)?:\/\/[^\s"']+/gi, '[redacted]');
};

export interface DbState {
  code: number;
  status: 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown';
}

/**
 * Connect to MongoDB instance using Mongoose.
 */
export const connectDB = async (uri: string): Promise<typeof mongoose> => {
  try {
    const connection = await mongoose.connect(uri);
    logger.info('Database connection established successfully');
    return connection;
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
      'Database connection failed'
    );
    throw error;
  }
};

/**
 * Disconnect from MongoDB instance.
 */
export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting database');
    throw error;
  }
};

/**
 * Return current Mongoose connection state.
 */
export const getDbState = (): DbState => {
  const stateCode = mongoose.connection.readyState;
  const stateMap: Record<number, DbState['status']> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    code: stateCode,
    status: stateMap[stateCode] || 'unknown',
  };
};
