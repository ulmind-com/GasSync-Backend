// ============================================================
// GasSync Backend - Environment Configuration
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
  mongodbUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: string;
  gasApi: {
    eiaApiKey: string;
    eiaBaseUrl: string;
    collectApiKey: string;
    collectApiBaseUrl: string;
  };
  cors: {
    origin: string[];
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  upload: {
    maxFileSize: number; // bytes
    allowedMimeTypes: string[];
  };
}

const config: Config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'gassync-super-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'gassync-refresh-secret-key-change-in-production',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  gasApi: {
    eiaApiKey: process.env.EIA_API_KEY || '',
    eiaBaseUrl: 'https://api.eia.gov/v2',
    collectApiKey: process.env.COLLECT_API_KEY || '',
    collectApiBaseUrl: 'https://api.collectapi.com/gasPrice',
  },
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:19006').split(','),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  },
};

// Validate required env vars
if (!config.mongodbUri) {
  throw new Error('MONGODB_URI environment variable is required');
}

export default config;
