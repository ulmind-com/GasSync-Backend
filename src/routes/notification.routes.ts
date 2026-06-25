// ============================================================
// GasSync Backend - Notification Routes
// ============================================================

import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// All notification routes require authentication
router.get('/', authenticate, NotificationController.getNotifications);
router.get('/unread-count', authenticate, NotificationController.getUnreadCount);
router.put('/mark-read', authenticate, NotificationController.markAllRead);
router.put('/:id/read', authenticate, NotificationController.markOneRead);
router.delete('/:id', authenticate, NotificationController.deleteNotification);

export default router;
