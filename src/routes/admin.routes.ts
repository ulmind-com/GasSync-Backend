// ============================================================
// GasSync Backend - Admin Routes
// ============================================================

import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate, authorize } from '../middleware/auth';
import { uploadNotificationImage } from '../middleware/upload';

const router = Router();

// All admin routes require authentication and 'admin' role
router.use(authenticate, authorize('admin'));

// Dashboard
router.get('/dashboard', AdminController.getDashboardStats);

// User Management
router.get('/users', AdminController.getUsers);
router.delete('/users/:id', AdminController.deleteUser);

// Notifications
router.post('/notify/broadcast', uploadNotificationImage, AdminController.broadcastNotification);
router.post('/notify/user/:id', uploadNotificationImage, AdminController.sendUserNotification);

export default router;

