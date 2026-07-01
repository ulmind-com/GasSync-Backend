// ============================================================
// GasSync Backend - Admin Controller
// ============================================================

import { Request, Response } from 'express';
import User from '../models/User';
import GasPrice from '../models/GasPrice';
import Bill from '../models/Bill';
import Feedback from '../models/Feedback';
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

      // 14-day activity trend (posts + new users per day) for the dashboard chart.
      const DAYS = 14;
      const startWindow = new Date();
      startWindow.setUTCHours(0, 0, 0, 0);
      startWindow.setUTCDate(startWindow.getUTCDate() - (DAYS - 1));

      const dayBucket = {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
      };

      const [postsByDay, usersByDay] = await Promise.all([
        GasPrice.aggregate([
          { $match: { source: { $in: communitySources }, createdAt: { $gte: startWindow } } },
          { $group: { _id: dayBucket, count: { $sum: 1 } } },
        ]),
        User.aggregate([
          { $match: { createdAt: { $gte: startWindow } } },
          { $group: { _id: dayBucket, count: { $sum: 1 } } },
        ]),
      ]);

      const postsMap = new Map(postsByDay.map((d: any) => [d._id, d.count]));
      const usersMap = new Map(usersByDay.map((d: any) => [d._id, d.count]));

      const trend: Array<{ date: string; posts: number; users: number }> = [];
      for (let i = 0; i < DAYS; i++) {
        const d = new Date(startWindow);
        d.setUTCDate(startWindow.getUTCDate() + i);
        const key = d.toISOString().slice(0, 10);
        trend.push({
          date: key,
          posts: postsMap.get(key) || 0,
          users: usersMap.get(key) || 0,
        });
      }

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
          trend,
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
   * Get paginated community posts.
   *
   * A "community post" = a bill the user uploaded (the Bill collection).
   * Each verified bill may also spawn a derived GasPrice (source 'user_bill')
   * used for price display, but the post itself lives in Bill — so this lists
   * bills and delete removes the actual bill (see deleteCommunityPost).
   */
  static getCommunityPosts = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [bills, total] = await Promise.all([
        Bill.find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('user', 'displayName email')
          .populate('station', 'name address city state'),
        Bill.countDocuments(),
      ]);

      // Map bills to the shape the admin Community Posts page renders.
      const posts = bills.map((b) => ({
        _id: b._id,
        fuelType: b.fuelType,
        price: b.pricePerGallon,
        isVerified: b.status === 'verified',
        status: b.status,
        stationName: b.stationName,
        stationAddress: b.stationAddress,
        googlePlaceId: b.googlePlaceId,
        location: b.location,
        imageUrl: b.imageUrl,
        reportedBy: b.user,
        station: b.station,
        createdAt: b.createdAt,
      }));

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
   * Delete a community post (the user-uploaded bill) from the DB, and
   * best-effort remove the price entry derived from it so nothing lingers.
   */
  static deleteCommunityPost = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const bill = await Bill.findByIdAndDelete(id);

      if (!bill) {
        res.status(404).json({ success: false, message: 'Community post not found' });
        return;
      }

      // Remove the GasPrice that this bill spawned (loosely linked by
      // reporter + price + fuel — the bill stored no direct reference).
      if (bill.pricePerGallon != null && bill.user) {
        await GasPrice.deleteMany({
          source: 'user_bill',
          reportedBy: bill.user,
          price: bill.pricePerGallon,
          ...(bill.fuelType ? { fuelType: bill.fuelType } : {}),
        });
      }

      res.json({ success: true, message: 'Community post deleted successfully' });
    } catch (error) {
      logger.error('Error in AdminController.deleteCommunityPost:', error);
      res.status(500).json({ success: false, message: 'Failed to delete community post' });
    }
  };

  /**
   * Get paginated user feedback (with optional category/status filters)
   */
  static getFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 15;
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {};
      if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
      if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;

      const [feedback, total, openCount] = await Promise.all([
        Feedback.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('userId', 'displayName email'),
        Feedback.countDocuments(filter),
        Feedback.countDocuments({ status: 'open' }),
      ]);

      res.json({
        success: true,
        data: {
          feedback,
          openCount,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error('Error in AdminController.getFeedback:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch feedback' });
    }
  };

  /**
   * Update feedback status (open / in-progress / resolved)
   */
  static updateFeedbackStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['open', 'in-progress', 'resolved'].includes(status)) {
        res.status(400).json({ success: false, message: 'Invalid status' });
        return;
      }

      const feedback = await Feedback.findByIdAndUpdate(id, { status }, { new: true });

      if (!feedback) {
        res.status(404).json({ success: false, message: 'Feedback not found' });
        return;
      }

      res.json({ success: true, data: feedback, message: 'Status updated' });
    } catch (error) {
      logger.error('Error in AdminController.updateFeedbackStatus:', error);
      res.status(500).json({ success: false, message: 'Failed to update feedback' });
    }
  };

  /**
   * Delete a feedback entry
   */
  static deleteFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const feedback = await Feedback.findByIdAndDelete(id);

      if (!feedback) {
        res.status(404).json({ success: false, message: 'Feedback not found' });
        return;
      }

      res.json({ success: true, message: 'Feedback deleted successfully' });
    } catch (error) {
      logger.error('Error in AdminController.deleteFeedback:', error);
      res.status(500).json({ success: false, message: 'Failed to delete feedback' });
    }
  };
}
