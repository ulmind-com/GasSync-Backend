// ============================================================
// GasSync Backend - Admin Controller
// ============================================================

import { Request, Response } from 'express';
import User from '../models/User';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { logger } from '../utils/logger';

// Initialize Expo client
const expo = new Expo();

export class AdminController {
  /**
   * Get all users (Paginated)
   */
  static getUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        User.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
        User.countDocuments(),
      ]);

      res.json({
        success: true,
        data: {
          users: users.map(user => user.toPublicJSON()),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error('Error in AdminController.getUsers:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
  };

  /**
   * Delete a user
   */
  static deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (id === req.userId) {
        res.status(400).json({ success: false, message: 'Cannot delete yourself' });
        return;
      }

      const user = await User.findByIdAndDelete(id);

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
      logger.error('Error in AdminController.deleteUser:', error);
      res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
  };

  /**
   * Broadcast a notification to all users with a push token
   */
  static broadcastNotification = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, body, data } = req.body;

      if (!title || !body) {
        res.status(400).json({ success: false, message: 'Title and body are required' });
        return;
      }

      // Find all users with a valid expoPushToken
      const users = await User.find({ 
        expoPushToken: { $exists: true, $ne: null },
        pushNotificationsEnabled: true
      });

      const messages: ExpoPushMessage[] = [];
      let tokenCount = 0;

      for (const user of users) {
        if (!Expo.isExpoPushToken(user.expoPushToken)) {
          continue;
        }

        messages.push({
          to: user.expoPushToken,
          sound: 'default',
          title,
          body,
          data: data || { type: 'broadcast' },
        });
        tokenCount++;
      }

      if (messages.length === 0) {
        res.json({ success: true, message: 'No valid push tokens found to broadcast' });
        return;
      }

      // Chunk and send
      const chunks = expo.chunkPushNotifications(messages);
      
      // We do this asynchronously to avoid blocking the response for large broadcasts
      (async () => {
        for (const chunk of chunks) {
          try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            logger.info('Broadcast push ticket chunk:', ticketChunk);
          } catch (error) {
            logger.error('Error sending broadcast push chunk:', error);
          }
        }
      })();

      res.json({ 
        success: true, 
        message: `Broadcast notification initiated for ${tokenCount} users` 
      });
    } catch (error) {
      logger.error('Error in AdminController.broadcastNotification:', error);
      res.status(500).json({ success: false, message: 'Failed to broadcast notification' });
    }
  };

  /**
   * Send notification to a specific user
   */
  static sendUserNotification = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { title, body, data } = req.body;

      if (!title || !body) {
        res.status(400).json({ success: false, message: 'Title and body are required' });
        return;
      }

      const user = await User.findById(id);

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      if (!user.expoPushToken || !Expo.isExpoPushToken(user.expoPushToken)) {
        res.status(400).json({ success: false, message: 'User does not have a valid push token' });
        return;
      }

      if (!user.pushNotificationsEnabled) {
        res.status(400).json({ success: false, message: 'User has disabled push notifications' });
        return;
      }

      const messages: ExpoPushMessage[] = [{
        to: user.expoPushToken,
        sound: 'default',
        title,
        body,
        data: data || { type: 'direct' },
      }];

      const chunks = expo.chunkPushNotifications(messages);
      const ticketChunk = await expo.sendPushNotificationsAsync(chunks[0]);
      
      logger.info(`Direct push to user ${id} ticket:`, ticketChunk);

      res.json({ success: true, message: 'Notification sent successfully' });
    } catch (error) {
      logger.error('Error in AdminController.sendUserNotification:', error);
      res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
  };
}
