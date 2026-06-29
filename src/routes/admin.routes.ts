// ============================================================
// GasSync Backend - Admin Routes
// ============================================================

import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { AdminPanelController } from '../controllers/adminPanel.controller';
import { authenticate, authorize } from '../middleware/auth';
import { uploadNotificationImage } from '../middleware/upload';

const router = Router();

// All admin routes require authentication and 'admin' role
router.use(authenticate, authorize('admin'));

// Dashboard
router.get('/dashboard', AdminController.getDashboardStats);
router.get('/community-posts', AdminController.getCommunityPosts);
router.delete('/community-posts/:id', AdminController.deleteCommunityPost);

// Feedback
router.get('/feedback', AdminController.getFeedback);
router.patch('/feedback/:id', AdminController.updateFeedbackStatus);
router.delete('/feedback/:id', AdminController.deleteFeedback);

// User Management
router.get('/users', AdminController.getUsers);
router.delete('/users/:id', AdminController.deleteUser);

// Notifications
router.post('/notify/broadcast', uploadNotificationImage, AdminController.broadcastNotification);
router.post('/notify/user/:id', uploadNotificationImage, AdminController.sendUserNotification);

// ============================================================
// Op-Level Panel routes (isolated — AdminPanelController)
// ============================================================

// Bills / OCR monitoring
router.get('/bills', AdminPanelController.getBills);
router.get('/bills/stats', AdminPanelController.getBillStats);
router.delete('/bills/:id', AdminPanelController.deleteBill);

// User 360 deep-dive
router.get('/users/:id/overview', AdminPanelController.getUserOverview);

// Engagement metrics
router.get('/engagement', AdminPanelController.getEngagement);

// Price analytics + moderation
router.get('/price-analytics', AdminPanelController.getPriceAnalytics);
router.get('/moderation/outliers', AdminPanelController.getOutliers);
router.patch('/community-posts/:id/verify', AdminPanelController.verifyCommunityPost);

// Stations
router.get('/stations', AdminPanelController.getStations);
router.patch('/stations/:id', AdminPanelController.updateStation);

// Audit log
router.get('/audit-log', AdminPanelController.getAuditLog);

// CSV export
router.get('/export/:type', AdminPanelController.exportCsv);

export default router;

