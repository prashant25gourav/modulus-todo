import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors,
      });
      return;
    }
    res.locals.body = parseResult.data;
    next();
  };
};

export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parseResult = schema.safeParse(req.query);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors,
      });
      return;
    }
    res.locals.query = parseResult.data;
    next();
  };
};

export const validateObjectId = (paramName: string = 'id') => {
  const objectIdRegex = /^[0-9a-f]{24}$/i;
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    if (typeof value !== 'string' || !objectIdRegex.test(value)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid task ID',
      });
      return;
    }
    next();
  };
};
