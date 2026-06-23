// ============================================================
// GasSync Backend - Validation Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { ApiResponseHelper } from '../utils/apiResponse';

/**
 * Run validation chains and return errors if any
 */
export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);

    if (errors.isEmpty()) {
      return next();
    }

    const formattedErrors = errors.array().map((err: any) => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));

    ApiResponseHelper.error(res, 'Validation failed', 422, formattedErrors);
  };
};
