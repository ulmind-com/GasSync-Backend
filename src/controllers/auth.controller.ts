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
import { OTP } from '../models/OTP';
import { sendOTP } from '../utils/mailer';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client();

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
      const { email, password, displayName, preferredFuelType, defaultZipCode, otp } = req.body;

      if (!otp) {
        throw new BadRequestError('OTP is required for registration');
      }

      // Check OTP
      const validOtp = await OTP.findOne({ email: email.toLowerCase(), otp });
      if (!validOtp) {
        throw new BadRequestError('Invalid or expired OTP');
      }

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

      // Delete OTP
      await OTP.deleteOne({ _id: validOtp._id });

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

  static async sendOTPHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) throw new BadRequestError('Email is required');

      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new ConflictError('An account with this email already exists');
      }

      // Delete any existing OTP for this email
      await OTP.deleteMany({ email: email.toLowerCase() });

      // Generate 4 digit OTP
      const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
      
      await OTP.create({ email: email.toLowerCase(), otp: otpCode });
      
      // Send email
      await sendOTP(email, otpCode);

      ApiResponseHelper.success(res, null, 'OTP sent successfully');
    } catch (error) {
      next(error);
    }
  }

  static async verifyOTPHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) throw new BadRequestError('Email and OTP are required');

      const validOtp = await OTP.findOne({ email: email.toLowerCase(), otp });
      if (!validOtp) {
        throw new BadRequestError('Invalid or expired OTP');
      }

      ApiResponseHelper.success(res, null, 'OTP is valid');
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

  static async googleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;
      if (!idToken) throw new BadRequestError('idToken is required');

      // Verify the Google ID Token
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: [
          process.env.GOOGLE_WEB_CLIENT_ID || '',
          process.env.GOOGLE_IOS_CLIENT_ID || '',
          process.env.GOOGLE_ANDROID_CLIENT_ID || '',
        ].filter(Boolean),
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new UnauthorizedError('Invalid Google token');
      }

      const email = payload.email.toLowerCase();
      const displayName = payload.name || 'Google User';
      const avatarUrl = payload.picture;

      // Find if user already exists
      let user = await User.findOne({ email });

      if (!user) {
        // Create new user (using a random secure password for oauth users)
        const randomPassword = require('crypto').randomBytes(16).toString('hex') + 'A1!';
        user = new User({
          email,
          password: randomPassword,
          displayName,
          avatarUrl,
        });
        await user.save();
        logger.info(`New user registered via Google: ${email}`);
      } else {
        // Optionally update avatar if they didn't have one
        if (!user.avatarUrl && avatarUrl) {
          user.avatarUrl = avatarUrl;
          await user.save();
        }
        logger.info(`Existing user logged in via Google: ${email}`);
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

      ApiResponseHelper.success(res, {
        user: user.toPublicJSON(),
        accessToken,
        refreshToken,
      }, 'Google login successful');
    } catch (error) {
      logger.error('Google Auth Error:', error);
      next(new UnauthorizedError('Google authentication failed'));
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
   * /api/v1/auth/avatar:
   *   post:
   *     summary: Upload and update user avatar
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               avatar:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Avatar updated successfully
   *       401:
   *         description: Not authenticated
   *       400:
   *         description: Bad request (no file)
   */
  static async uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        throw new BadRequestError('No image file provided');
      }

      const user = await User.findById(req.userId);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Cloudinary returns the secure URL in req.file.path
      user.avatarUrl = req.file.path;
      await user.save();

      ApiResponseHelper.success(res, user.toPublicJSON(), 'Avatar updated successfully');
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
  static async toggleFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const station = req.body;
      if (!station || !station.id) {
        throw new BadRequestError('Station object with id is required');
      }

      const user = await User.findById(req.userId);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      const existingIndex = user.favorites.findIndex(f => f.id === station.id);
      
      if (existingIndex >= 0) {
        // Remove from favorites
        user.favorites.splice(existingIndex, 1);
      } else {
        // Add to favorites
        user.favorites.push({
          id: station.id,
          name: station.name,
          lat: station.lat,
          lon: station.lon,
          address: station.address || '',
          rating: station.rating || 0,
          totalRatings: station.totalRatings || 0,
          isOpen: station.isOpen ?? null,
          photoRef: station.photoRef || null,
        });
      }

      await user.save();
      
      ApiResponseHelper.success(res, user.favorites, 'Favorites updated successfully');
    } catch (error) {
      next(error);
    }
  }
}
