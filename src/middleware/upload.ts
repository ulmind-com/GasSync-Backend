// ============================================================
// GasSync Backend - File Upload Middleware (Multer)
// ============================================================

import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import { BadRequestError } from '../utils/errors';

// Memory storage (for processing before uploading to cloud/local)
const storage = multer.memoryStorage();

// Disk storage (for local development)
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'bills'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

// File filter
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(`File type ${file.mimetype} is not allowed. Allowed: ${config.upload.allowedMimeTypes.join(', ')}`));
  }
};

// Export multer instances
export const uploadMemory = multer({
  storage: storage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter,
});

export const uploadDisk = multer({
  storage: diskStorage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter,
});

// Single bill image upload
export const uploadBillImage = config.nodeEnv === 'production' ? uploadMemory.single('billImage') : uploadDisk.single('billImage');
