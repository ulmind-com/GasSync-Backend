// ============================================================
// GasSync Backend - Notification Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import Notification from '../models/Notification';
import { ApiResponseHelper } from '../utils/apiResponse';
import { logger } from '../utils/logger';

export class NotificationController {
  /**
   * @swagger
   * /api/v1/notifications:
   *   get:
   *     summary: Get user's notifications
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   */
  static async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const skip = (page - 1) * limit;

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find({ user: userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments({ user: userId }),
        Notification.countDocuments({ user: userId, isRead: false }),
      ]);

      ApiResponseHelper.success(res, {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }, 'Notifications retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/notifications/unread-count:
   *   get:
   *     summary: Get unread notification count
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   */
  static async getUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const count = await Notification.countDocuments({ user: userId, isRead: false });
      ApiResponseHelper.success(res, { unreadCount: count }, 'Unread count retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/notifications/mark-read:
   *   put:
   *     summary: Mark all notifications as read
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   */
  static async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      await Notification.updateMany({ user: userId, isRead: false }, { isRead: true });
      ApiResponseHelper.success(res, null, 'All notifications marked as read');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/notifications/{id}/read:
   *   put:
   *     summary: Mark a single notification as read
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   */
  static async markOneRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;
      await Notification.findOneAndUpdate({ _id: id, user: userId }, { isRead: true });
      ApiResponseHelper.success(res, null, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }
}
