// ============================================================
// GasSync Backend - Auth Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import User from '../models/User';
import { ApiResponseHelper } from '../utils/apiResponse';
import { BadRequestError, UnauthorizedError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Generate JWT tokens
 */
const generateTokens = (userId: string, email: string, role: string) => {
  const accessToken = jwt.sign(
    { userId, email, role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any }
  );

  const refreshToken = jwt.sign(
    { userId, email, role },
    config.jwtRefreshSecret,
    { expiresIn: config.jwtRefreshExpiresIn as any }
  );

  return { accessToken, refreshToken };
};

export class AuthController {
  /**
   * @swagger
   * /api/v1/auth/register:
   *   post:
   *     summary: Register a new user
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *               - displayName
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: john@example.com
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 example: SecurePass123!
   *               displayName:
   *                 type: string
   *                 example: John Doe
   *               preferredFuelType:
   *                 type: string
   *                 enum: [regular, midgrade, premium, diesel]
   *                 default: regular
   *               defaultZipCode:
   *                 type: string
   *                 example: "77001"
   *     responses:
   *       201:
   *         description: User registered successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       409:
   *         description: Email already exists
   *       422:
   *         description: Validation error
   */
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, displayName, preferredFuelType, defaultZipCode } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new ConflictError('An account with this email already exists');
      }

      // Create user
      const user = new User({
        email,
        password,
        displayName,
        preferredFuelType: preferredFuelType || 'regular',
        defaultZipCode,
      });

      await user.save();

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(
        user._id.toString(),
        user.email,
        user.role
      );

      // Save refresh token
      user.refreshToken = refreshToken;
      user.lastLoginAt = new Date();
      await user.save();

      logger.info(`New user registered: ${user.email}`);

      ApiResponseHelper.created(res, {
        user: user.toPublicJSON(),
        accessToken,
        refreshToken,
      }, 'Registration successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/login:
   *   post:
   *     summary: Login with email and password
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: john@example.com
   *               password:
   *                 type: string
   *                 example: SecurePass123!
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       401:
   *         description: Invalid credentials
   */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      // Find user with password field
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

      if (!user) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(
        user._id.toString(),
        user.email,
        user.role
      );

      // Update refresh token and last login
      user.refreshToken = refreshToken;
      user.lastLoginAt = new Date();
      await user.save();

      logger.info(`User logged in: ${user.email}`);

      ApiResponseHelper.success(res, {
        user: user.toPublicJSON(),
        accessToken,
        refreshToken,
      }, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/refresh:
   *   post:
   *     summary: Refresh access token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - refreshToken
   *             properties:
   *               refreshToken:
   *                 type: string
   *     responses:
   *       200:
   *         description: Token refreshed successfully
   *       401:
   *         description: Invalid refresh token
   */
  static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new BadRequestError('Refresh token is required');
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as any;

      // Find user and check if refresh token matches
      const user = await User.findById(decoded.userId).select('+refreshToken');

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = generateTokens(user._id.toString(), user.email, user.role);

      // Update refresh token
      user.refreshToken = tokens.refreshToken;
      await user.save();

      ApiResponseHelper.success(res, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      }, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/logout:
   *   post:
   *     summary: Logout (invalidate refresh token)
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Logged out successfully
   *       401:
   *         description: Not authenticated
   */
  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user) {
        await User.findByIdAndUpdate(req.userId, { refreshToken: null });
        logger.info(`User logged out: ${req.user.email}`);
      }

      ApiResponseHelper.success(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/me:
   *   get:
   *     summary: Get current user profile
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Current user profile
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       401:
   *         description: Not authenticated
   */
  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await User.findById(req.userId);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      ApiResponseHelper.success(res, user.toPublicJSON(), 'User profile retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/me:
   *   put:
   *     summary: Update current user profile
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               displayName:
   *                 type: string
   *               phone:
   *                 type: string
   *               preferredFuelType:
   *                 type: string
   *                 enum: [regular, midgrade, premium, diesel]
   *               defaultZipCode:
   *                 type: string
   *               defaultState:
   *                 type: string
   *     responses:
   *       200:
   *         description: Profile updated
   *       401:
   *         description: Not authenticated
   */
  static async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const allowedFields = ['displayName', 'phone', 'preferredFuelType', 'defaultZipCode', 'defaultState', 'avatarUrl'];
      const updates: Record<string, any> = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const user = await User.findByIdAndUpdate(req.userId, updates, {
        new: true,
        runValidators: true,
      });

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      ApiResponseHelper.success(res, user.toPublicJSON(), 'Profile updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/auth/change-password:
   *   post:
   *     summary: Change password
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - currentPassword
   *               - newPassword
   *             properties:
   *               currentPassword:
   *                 type: string
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *     responses:
   *       200:
   *         description: Password changed
   *       401:
   *         description: Current password is wrong
   */
  static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.userId).select('+password');
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      const isValid = await user.comparePassword(currentPassword);
      if (!isValid) {
        throw new UnauthorizedError('Current password is incorrect');
      }

      user.password = newPassword;
      await user.save();

      logger.info(`Password changed for user: ${user.email}`);

      ApiResponseHelper.success(res, null, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }
}
