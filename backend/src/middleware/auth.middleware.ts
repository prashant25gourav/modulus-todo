import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { User, IUser } from '../models/user.model';

// Extend Express Request type to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

/**
 * Middleware ensuring request possesses a valid, unexpired, untampered JWT bearer token.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user) {
      res.status(401).json({
        status: 'error',
        message: 'Unauthorized',
      });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
    });
  }
};
