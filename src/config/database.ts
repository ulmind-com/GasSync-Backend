// ============================================================
// GasSync Backend - MongoDB Connection Manager
// ============================================================

import mongoose from 'mongoose';
import config from './index';
import { logger } from '../utils/logger';

class Database {
  private static instance: Database;
  private isConnected = false;

  private constructor() {}

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.info('MongoDB already connected');
      return;
    }

    try {
      // Mongoose connection options
      mongoose.set('strictQuery', true);

      // Connection event handlers
      mongoose.connection.on('connected', () => {
        this.isConnected = true;
        logger.info('✅ MongoDB Atlas connected successfully');
      });

      mongoose.connection.on('error', (err) => {
        logger.error('❌ MongoDB connection error:', err);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('⚠️ MongoDB disconnected');
        this.isConnected = false;
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await this.disconnect();
        process.exit(0);
      });

      // Connect
      await mongoose.connect(config.mongodbUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
      });
    } catch (error) {
      logger.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    await mongoose.disconnect();
    this.isConnected = false;
    logger.info('🔌 MongoDB disconnected gracefully');
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export default Database;
