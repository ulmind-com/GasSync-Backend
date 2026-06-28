// ============================================================
// GasSync Backend - Admin Controller
// ============================================================

import { Request, Response } from 'express';
import User from '../models/User';
import GasPrice from '../models/GasPrice';
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
      const imageUrl = req.file?.path || req.body.imageUrl;

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

      const payloadData = data || { type: 'broadcast' };
      if (imageUrl) {
        payloadData.image = imageUrl; // Keep in data just in case frontend needs it
      }

      for (const user of users) {
        if (!Expo.isExpoPushToken(user.expoPushToken)) {
          continue;
        }

        const message: ExpoPushMessage = {
          to: user.expoPushToken,
          sound: 'default',
          title,
          body,
          data: payloadData,
        };

        if (imageUrl) {
          message.mutableContent = true;
          // Use any to bypass TS error if richContent is strictly typed
          (message as any).richContent = { image: imageUrl };
        }

        messages.push(message);
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
      const imageUrl = req.file?.path || req.body.imageUrl;

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

      const payloadData = data || { type: 'direct' };
      if (imageUrl) {
        payloadData.image = imageUrl; // Keep in data for fallback
      }

      const message: ExpoPushMessage = {
        to: user.expoPushToken,
        sound: 'default',
        title,
        body,
        data: payloadData,
      };

      if (imageUrl) {
        message.mutableContent = true;
        // Use any to bypass TS error if richContent is strictly typed
        (message as any).richContent = { image: imageUrl };
      }

      const chunks = expo.chunkPushNotifications([message]);
      const ticketChunk = await expo.sendPushNotificationsAsync(chunks[0]);
      
      logger.info(`Direct push to user ${id} ticket:`, ticketChunk);

      res.json({ success: true, message: 'Notification sent successfully' });
    } catch (error) {
      logger.error('Error in AdminController.sendUserNotification:', error);
      res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
  };

  /**
   * Get Dashboard Stats (OP Level)
   */
  static getDashboardStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // User Stats
      const [totalUsers, users24h] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: oneDayAgo } }),
      ]);

      // Community Post Stats
      const communitySources = ['user_report', 'user_bill'];
      const [totalPosts, posts24h] = await Promise.all([
        GasPrice.countDocuments({ source: { $in: communitySources as any[] } }),
        GasPrice.countDocuments({ source: { $in: communitySources as any[] }, createdAt: { $gte: oneDayAgo } }),
      ]);

      // Top reporting stations for community posts. Community posts rarely have
      // a city/state (they come from bills), but they do carry a station name,
      // so we group by that and fall back to city when a name is missing.
      const topLocations = await GasPrice.aggregate([
        { $match: { source: { $in: communitySources } } },
        {
          $group: {
            _id: {
              $ifNull: ['$stationName', { $ifNull: ['$city', 'Unknown'] }],
            },
            count: { $sum: 1 },
            city: { $first: '$city' },
            state: { $first: '$state' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 6 },
        {
          $project: {
            _id: 0,
            name: '$_id',
            city: 1,
            state: 1,
            count: 1,
          },
        },
      ]);

      // Recent Activity
      const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5).select('displayName email createdAt');
      const recentPrices = await GasPrice.find({ source: { $in: communitySources as any[] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('reportedBy', 'displayName')
        .populate('station', 'name')
        .select('fuelType price city state stationName googlePlaceId location createdAt reportedBy station');

      res.json({
        success: true,
        data: {
          metrics: {
            totalUsers,
            users24h,
            totalPosts,
            posts24h
          },
          topLocations,
          recentActivity: {
            users: recentUsers,
            prices: recentPrices
          }
        }
      });
    } catch (error) {
      logger.error('Error in AdminController.getDashboardStats:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
    }
  };

  /**
   * Get paginated community posts
   */
  static getCommunityPosts = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const communitySources = ['user_report', 'user_bill'];
      const query = { source: { $in: communitySources as any[] } };

      const [posts, total] = await Promise.all([
        GasPrice.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('reportedBy', 'displayName email')
          .populate('station', 'name address city state'),
        GasPrice.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: {
          posts,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error('Error in AdminController.getCommunityPosts:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch community posts' });
    }
  };

  /**
   * Delete a community post (gas price report)
   */
  static deleteCommunityPost = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const post = await GasPrice.findByIdAndDelete(id);

      if (!post) {
        res.status(404).json({ success: false, message: 'Community post not found' });
        return;
      }

      res.json({ success: true, message: 'Community post deleted successfully' });
    } catch (error) {
      logger.error('Error in AdminController.deleteCommunityPost:', error);
      res.status(500).json({ success: false, message: 'Failed to delete community post' });
    }
  };
}
