// ============================================================
// GasSync Backend - File Upload Middleware (Multer)
// ============================================================

import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import config from '../config';
import { AppError } from '../utils/errors';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

// Configure Multer to use Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `bill-${uniqueSuffix}`;

    return {
      folder: 'gassync/bills',
      format: 'png', // Force png, or can use original format
      public_id: filename,
    };
  },
});

// Configure Multer to use Cloudinary for Avatars
const avatarStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `avatar-${uniqueSuffix}`;

    return {
      folder: 'gassync/avatars',
      format: 'png',
      public_id: filename,
    };
  },
});

// Configure Multer to use Cloudinary for Notifications
const notificationStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `notification-${uniqueSuffix}`;

    return {
      folder: 'gassync/notifications',
      format: 'png',
      public_id: filename,
    };
  },
});

// File filter for images only
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Only JPG, PNG and WEBP are allowed', 400));
  }
};

// Initialize multer for bills
export const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter,
});

// Initialize multer for avatars
export const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter,
});

// Initialize multer for notifications
export const uploadNotification = multer({
  storage: notificationStorage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter,
});

// Single bill image upload
export const uploadBillImage = upload.single('billImage');

// Single avatar image upload
export const uploadAvatarImage = uploadAvatar.single('avatar');

// Single notification image upload
export const uploadNotificationImage = uploadNotification.single('image');
