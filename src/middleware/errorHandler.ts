// ============================================================
// GasSync Backend - Error Handling Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ApiResponseHelper } from '../utils/apiResponse';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

/**
 * Global error handler middleware
 */
export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  logger.error(`Error [${req.method} ${req.path}]:`, err.message);

  // Mongoose validation error
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    ApiResponseHelper.error(res, 'Validation failed', 422, details);
    return;
  }

  // Mongoose duplicate key error
  if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    const field = Object.keys((err as any).keyValue)[0];
    ApiResponseHelper.error(res, `${field} already exists`, 409);
    return;
  }

  // Mongoose cast error (invalid ObjectId)
  if (err instanceof mongoose.Error.CastError) {
    ApiResponseHelper.error(res, `Invalid ${err.path}: ${err.value}`, 400);
    return;
  }

  // Custom AppError
  if (err instanceof AppError) {
    ApiResponseHelper.error(res, err.message, err.statusCode, err.details);
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    ApiResponseHelper.error(res, 'Invalid token', 401);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    ApiResponseHelper.error(res, 'Token has expired', 401);
    return;
  }

  // Multer file size error
  if (err.name === 'MulterError') {
    ApiResponseHelper.error(res, `File upload error: ${err.message}`, 400);
    return;
  }

  // Default: Internal Server Error
  const statusCode = 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  if (process.env.NODE_ENV !== 'production') {
    logger.error('Stack trace:', err.stack);
  }

  ApiResponseHelper.error(res, message, statusCode);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  ApiResponseHelper.error(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
};
