// ============================================================
// GasSync Backend - Admin Routes
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { AdminPanelController } from '../controllers/adminPanel.controller';
import { authenticate, authorize } from '../middleware/auth';
import { uploadNotificationImage } from '../middleware/upload';

const router = Router();

// All admin routes require authentication and 'admin' role
router.use(authenticate, authorize('admin'));

/**
 * Gate mutating actions behind write permission. Read-only admins
 * (adminPermission === 'read') may view everything but cannot modify.
 * Legacy admins without the field are treated as full 'write' access,
 * so existing admin behaviour is unchanged.
 */
const requireWrite = (req: Request, res: Response, next: NextFunction): void => {
  const perm = req.user?.adminPermission || 'write';
  if (perm !== 'write') {
    res.status(403).json({
      success: false,
      code: 'READ_ONLY_ADMIN',
      message: 'Read-only access: you do not have permission to perform this action.',
    });
    return;
  }
  next();
};

// Dashboard
router.get('/dashboard', AdminController.getDashboardStats);
router.get('/community-posts', AdminController.getCommunityPosts);
router.post('/community-posts/bulk-delete', requireWrite, AdminController.bulkDeleteCommunityPosts);
router.delete('/community-posts/:id', requireWrite, AdminController.deleteCommunityPost);

// Feedback
router.get('/feedback', AdminController.getFeedback);
router.patch('/feedback/:id', requireWrite, AdminController.updateFeedbackStatus);
router.delete('/feedback/:id', requireWrite, AdminController.deleteFeedback);

// User Management
router.get('/users', AdminController.getUsers);
router.delete('/users/:id', requireWrite, AdminController.deleteUser);

// Notifications
router.post('/notify/broadcast', requireWrite, uploadNotificationImage, AdminController.broadcastNotification);
router.post('/notify/user/:id', requireWrite, uploadNotificationImage, AdminController.sendUserNotification);

// ============================================================
// Op-Level Panel routes (isolated — AdminPanelController)
// ============================================================

// Bills / OCR monitoring
router.get('/bills', AdminPanelController.getBills);
router.get('/bills/stats', AdminPanelController.getBillStats);
router.delete('/bills/:id', requireWrite, AdminPanelController.deleteBill);

// User 360 deep-dive
router.get('/users/:id/overview', AdminPanelController.getUserOverview);

// Engagement metrics
router.get('/engagement', AdminPanelController.getEngagement);

// Price analytics + moderation
router.get('/price-analytics', AdminPanelController.getPriceAnalytics);
router.get('/moderation/outliers', AdminPanelController.getOutliers);
router.patch('/community-posts/:id/verify', requireWrite, AdminPanelController.verifyCommunityPost);
router.delete('/prices/:id', requireWrite, AdminPanelController.deletePrice);

// Stations
router.get('/stations', AdminPanelController.getStations);
router.post('/stations/bulk-delete', requireWrite, AdminPanelController.bulkDeleteStations);
router.patch('/stations/:id', requireWrite, AdminPanelController.updateStation);

// Audit log
router.get('/audit-log', AdminPanelController.getAuditLog);

// CSV export
router.get('/export/:type', AdminPanelController.exportCsv);

// Current admin profile (permission-aware)
router.get('/me', AdminPanelController.getMe);

// Admin management (create admins with read / write access — write only)
router.get('/admins', AdminPanelController.getAdmins);
router.post('/admins', requireWrite, AdminPanelController.createAdmin);
router.patch('/admins/:id', requireWrite, AdminPanelController.updateAdmin);
router.delete('/admins/:id', requireWrite, AdminPanelController.deleteAdmin);

export default router;

