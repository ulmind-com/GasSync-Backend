// ============================================================
// GasSync Backend - Main Server Entry Point
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import fs from 'fs';

import config from './config';
import Database from './config/database';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { seedDatabase } from './utils/seeder';
import { initNotificationJobs } from './jobs/notification.jobs';

// Import routes
import authRoutes from './routes/auth.routes';
import gasStationRoutes from './routes/gasStation.routes';
import gasPriceRoutes from './routes/gasPrice.routes';
import billRoutes from './routes/bill.routes';
import notificationRoutes from './routes/notification.routes';
import feedbackRoutes from './routes/feedback.routes';

// ============================================================
// Initialize Express App
// ============================================================
const app = express();
app.set('trust proxy', 1);

// ============================================================
// Security Middleware
// ============================================================
app.use(helmet({
  contentSecurityPolicy: false, // Allow Swagger UI
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — allow the configured origins (CORS_ORIGINS env), any localhost, and
// any *.vercel.app deploy (preview URLs change), plus non-browser callers.
const allowedOrigins = config.cors.origin;
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /\.vercel\.app$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  // Don't count read requests — the app fires many GETs per screen (prices,
  // community, notifications), which would otherwise burn the budget and
  // wrongly 429 normal flows like logging back in. Only writes are limited.
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
});
app.use('/api/', limiter);

// ============================================================
// Body Parsing & Compression
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ============================================================
// Logging
// ============================================================
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ============================================================
// Static Files (for bill image uploads in dev)
// ============================================================
const uploadsDir = path.join(process.cwd(), 'uploads', 'bills');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ============================================================
// Swagger API Documentation
// ============================================================
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin-bottom: 20px; }
      .swagger-ui .info .title { font-size: 2em; }
    `,
    customSiteTitle: 'GasSync API Docs',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true,
    },
  })
);

// Swagger JSON endpoint
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ============================================================
// Health Check
// ============================================================

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is healthy
 */
app.get('/api/v1/health', (_req, res) => {
  const db = Database.getInstance();
  res.json({
    success: true,
    message: 'GasSync API is running ⛽',
    data: {
      status: 'healthy',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(process.uptime())}s`,
      database: db.getConnectionStatus() ? 'connected' : 'disconnected',
      version: '1.0.0',
    },
  });
});

// ============================================================
// API Routes
// ============================================================
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/stations', gasStationRoutes);
app.use('/api/v1/prices', gasPriceRoutes);
app.use('/api/v1/bills', billRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/feedback', feedbackRoutes);

// ============================================================
// Root redirect to docs
// ============================================================
app.get('/', (_req, res) => {
  res.redirect('/api-docs');
});

// ============================================================
// Error Handling
// ============================================================
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================
// Start Server
// ============================================================
async function startServer(): Promise<void> {
  try {
    // Connect to MongoDB
    const db = Database.getInstance();
    await db.connect();

    // Seed database (runs once — skips if data already exists)
    await seedDatabase();

    // Initialize notification cron jobs
    initNotificationJobs();

    // Start listening
    app.listen(config.port, () => {
      logger.info('================================================');
      logger.info(`⛽ GasSync API Server`);
      logger.info(`📡 Environment: ${config.nodeEnv}`);
      logger.info(`🚀 Server:      http://localhost:${config.port}`);
      logger.info(`📚 Swagger:     http://localhost:${config.port}/api-docs`);
      logger.info(`❤️  Health:      http://localhost:${config.port}/api/v1/health`);
      logger.info('================================================');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
