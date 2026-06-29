// ============================================================
// GasSync Backend - Admin Panel (Op-Level) Controller
// ============================================================
// ISOLATION NOTE:
//   Every method here is NEW and read-mostly. It only performs
//   aggregations / reads on existing collections plus a handful of
//   targeted admin mutations (delete bad bill, toggle station,
//   verify post) — none of which alter existing user/mobile flows or
//   existing schemas. Nothing in the existing app imports this file,
//   so it cannot affect existing logic.
// ============================================================

import { Request, Response } from 'express';
import User from '../models/User';
import GasPrice from '../models/GasPrice';
import GasStation from '../models/GasStation';
import Bill from '../models/Bill';
import PriceHistory from '../models/PriceHistory';
import Feedback from '../models/Feedback';
import Notification from '../models/Notification';
import AdminAuditLog from '../models/AdminAuditLog';
import { logger } from '../utils/logger';

// Cast to any[] so it satisfies the strict PriceSource enum in find/count
// queries — mirrors the existing admin.controller approach.
const COMMUNITY_SOURCES: any[] = ['user_report', 'user_bill'];

/**
 * Fire-and-forget audit logging. Never throws into the request flow.
 */
async function audit(
  req: Request,
  action: string,
  targetType?: string,
  targetId?: any,
  meta?: Record<string, any>
): Promise<void> {
  try {
    await AdminAuditLog.create({
      actor: req.userId,
      actorName: req.user?.displayName,
      action,
      targetType,
      targetId,
      meta: meta || {},
    });
  } catch (error) {
    logger.error('Failed to write admin audit log:', error);
  }
}

export class AdminPanelController {
  // ==========================================================
  // 1. BILLS / OCR MONITORING
  // ==========================================================

  /**
   * Paginated bills with optional status / provider / confidence filters.
   */
  static getBills = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {};
      if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
      if (req.query.provider && req.query.provider !== 'all') filter.ocrProvider = req.query.provider;
      if (req.query.minConfidence) {
        const min = parseFloat(req.query.minConfidence as string);
        if (!Number.isNaN(min)) filter.ocrConfidence = { $gte: min };
      }

      const [bills, total] = await Promise.all([
        Bill.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('user', 'displayName email')
          .populate('station', 'name city state')
          .select(
            'user station status ocrProvider ocrConfidence processingError stationName ' +
              'fuelType pricePerGallon totalAmount totalGallons billDate userCorrected ' +
              'imageUrl thumbnailUrl createdAt'
          ),
        Bill.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: {
          bills,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getBills:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch bills' });
    }
  };

  /**
   * OCR health stats: status breakdown, avg confidence, provider success rate.
   */
  static getBillStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [statusAgg, providerAgg, confidenceAgg, total, totalToday, failedWithError] =
        await Promise.all([
          Bill.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
          Bill.aggregate([
            {
              $group: {
                _id: { $ifNull: ['$ocrProvider', 'unknown'] },
                total: { $sum: 1 },
                verified: { $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                avgConfidence: { $avg: '$ocrConfidence' },
              },
            },
            { $sort: { total: -1 } },
          ]),
          Bill.aggregate([
            { $match: { ocrConfidence: { $ne: null } } },
            { $group: { _id: null, avg: { $avg: '$ocrConfidence' } } },
          ]),
          Bill.countDocuments(),
          Bill.countDocuments({ createdAt: { $gte: oneDayAgo } }),
          Bill.countDocuments({ status: 'failed', processingError: { $ne: null } }),
        ]);

      const statusBreakdown: Record<string, number> = {
        uploading: 0,
        processing: 0,
        extracted: 0,
        verified: 0,
        failed: 0,
      };
      statusAgg.forEach((s: any) => {
        statusBreakdown[s._id] = s.count;
      });

      const verifiedCount = statusBreakdown.verified;
      const failedCount = statusBreakdown.failed;
      const successRate = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

      res.json({
        success: true,
        data: {
          total,
          totalToday,
          verifiedCount,
          failedCount,
          failedWithError,
          successRate,
          avgConfidence: confidenceAgg[0]?.avg ?? null,
          statusBreakdown,
          providers: providerAgg.map((p: any) => ({
            provider: p._id,
            total: p.total,
            verified: p.verified,
            failed: p.failed,
            avgConfidence: p.avgConfidence,
            successRate: p.total > 0 ? Math.round((p.verified / p.total) * 100) : 0,
          })),
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getBillStats:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch bill stats' });
    }
  };

  /**
   * Delete a bad / spam bill.
   */
  static deleteBill = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const bill = await Bill.findByIdAndDelete(id);

      if (!bill) {
        res.status(404).json({ success: false, message: 'Bill not found' });
        return;
      }

      await audit(req, 'bill.delete', 'Bill', id, { stationName: bill.stationName });
      res.json({ success: true, message: 'Bill deleted successfully' });
    } catch (error) {
      logger.error('Error in AdminPanelController.deleteBill:', error);
      res.status(500).json({ success: false, message: 'Failed to delete bill' });
    }
  };

  // ==========================================================
  // 2. USER 360 DEEP-DIVE
  // ==========================================================

  static getUserOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const [
        billCount,
        reportCount,
        feedbackCount,
        notificationCount,
        recentBills,
        recentReports,
        recentFeedback,
      ] = await Promise.all([
        Bill.countDocuments({ user: id }),
        GasPrice.countDocuments({ reportedBy: id }),
        Feedback.countDocuments({ userId: id }),
        Notification.countDocuments({ user: id }),
        Bill.find({ user: id })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('status stationName fuelType pricePerGallon totalAmount createdAt'),
        GasPrice.find({ reportedBy: id })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('fuelType price stationName city state source isVerified createdAt'),
        Feedback.find({ userId: id })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('category subject status createdAt'),
      ]);

      res.json({
        success: true,
        data: {
          user: user.toPublicJSON(),
          extra: {
            lastLoginAt: user.lastLoginAt ?? null,
            pushNotificationsEnabled: user.pushNotificationsEnabled,
            hasPushToken: !!user.expoPushToken,
            isEmailVerified: user.isEmailVerified,
            favoritesCount: Array.isArray(user.favorites) ? user.favorites.length : 0,
          },
          counts: {
            bills: billCount,
            reports: reportCount,
            feedback: feedbackCount,
            notifications: notificationCount,
          },
          recent: {
            bills: recentBills,
            reports: recentReports,
            feedback: recentFeedback,
          },
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getUserOverview:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch user overview' });
    }
  };

  // ==========================================================
  // 3. ENGAGEMENT METRICS
  // ==========================================================

  static getEngagement = async (req: Request, res: Response): Promise<void> => {
    try {
      const now = Date.now();
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        dau,
        wau,
        mau,
        pushEnabled,
        emailVerified,
        withToken,
        fuelDist,
        signupTrendRaw,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ lastLoginAt: { $gte: dayAgo } }),
        User.countDocuments({ lastLoginAt: { $gte: weekAgo } }),
        User.countDocuments({ lastLoginAt: { $gte: monthAgo } }),
        User.countDocuments({ pushNotificationsEnabled: true }),
        User.countDocuments({ isEmailVerified: true }),
        User.countDocuments({ expoPushToken: { $exists: true, $ne: null } }),
        User.aggregate([{ $group: { _id: '$preferredFuelType', count: { $sum: 1 } } }]),
        (() => {
          const DAYS = 30;
          const startWindow = new Date();
          startWindow.setUTCHours(0, 0, 0, 0);
          startWindow.setUTCDate(startWindow.getUTCDate() - (DAYS - 1));
          return User.aggregate([
            { $match: { createdAt: { $gte: startWindow } } },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
                },
                count: { $sum: 1 },
              },
            },
          ]);
        })(),
      ]);

      // Build a continuous 30-day signup trend.
      const DAYS = 30;
      const startWindow = new Date();
      startWindow.setUTCHours(0, 0, 0, 0);
      startWindow.setUTCDate(startWindow.getUTCDate() - (DAYS - 1));
      const signupMap = new Map(signupTrendRaw.map((d: any) => [d._id, d.count]));
      const signupTrend: Array<{ date: string; count: number }> = [];
      for (let i = 0; i < DAYS; i++) {
        const d = new Date(startWindow);
        d.setUTCDate(startWindow.getUTCDate() + i);
        const key = d.toISOString().slice(0, 10);
        signupTrend.push({ date: key, count: signupMap.get(key) || 0 });
      }

      const pct = (n: number) => (totalUsers > 0 ? Math.round((n / totalUsers) * 100) : 0);

      res.json({
        success: true,
        data: {
          totalUsers,
          activity: { dau, wau, mau },
          rates: {
            pushEnabledPct: pct(pushEnabled),
            emailVerifiedPct: pct(emailVerified),
            withTokenPct: pct(withToken),
          },
          counts: { pushEnabled, emailVerified, withToken },
          fuelDistribution: fuelDist.map((f: any) => ({
            fuelType: f._id || 'unknown',
            count: f.count,
          })),
          signupTrend,
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getEngagement:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch engagement metrics' });
    }
  };

  // ==========================================================
  // 4. PRICE ANALYTICS + MODERATION
  // ==========================================================

  /**
   * Average / min / max community-reported price grouped by fuel type,
   * plus the latest PriceHistory snapshots per region.
   */
  static getPriceAnalytics = async (_req: Request, res: Response): Promise<void> => {
    try {
      const [byFuel, byState, latestHistory] = await Promise.all([
        GasPrice.aggregate([
          { $match: { source: { $in: COMMUNITY_SOURCES } } },
          {
            $group: {
              _id: '$fuelType',
              avg: { $avg: '$price' },
              min: { $min: '$price' },
              max: { $max: '$price' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        GasPrice.aggregate([
          { $match: { source: { $in: COMMUNITY_SOURCES }, state: { $ne: null } } },
          {
            $group: {
              _id: '$state',
              avg: { $avg: '$price' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        PriceHistory.find().sort({ recordedDate: -1 }).limit(20),
      ]);

      res.json({
        success: true,
        data: {
          byFuel: byFuel.map((f: any) => ({
            fuelType: f._id,
            avg: f.avg,
            min: f.min,
            max: f.max,
            count: f.count,
          })),
          byState: byState.map((s: any) => ({ state: s._id, avg: s.avg, count: s.count })),
          latestHistory,
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getPriceAnalytics:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch price analytics' });
    }
  };

  /**
   * Flag community posts whose price deviates strongly from the average
   * for that fuel type (possible bad / spam reports).
   */
  static getOutliers = async (req: Request, res: Response): Promise<void> => {
    try {
      const deviation = parseFloat(req.query.deviation as string) || 0.4; // 40%

      const fuelAverages = await GasPrice.aggregate([
        { $match: { source: { $in: COMMUNITY_SOURCES } } },
        { $group: { _id: '$fuelType', avg: { $avg: '$price' } } },
      ]);

      const avgMap = new Map<string, number>(fuelAverages.map((f: any) => [f._id, f.avg]));

      // Build an $or of out-of-band ranges per fuel type.
      const orConditions: any[] = [];
      avgMap.forEach((avg, fuelType) => {
        if (!avg) return;
        const low = avg * (1 - deviation);
        const high = avg * (1 + deviation);
        orConditions.push({ fuelType, $or: [{ price: { $lt: low } }, { price: { $gt: high } }] });
      });

      let outliers: any[] = [];
      if (orConditions.length > 0) {
        outliers = await GasPrice.find({
          source: { $in: COMMUNITY_SOURCES },
          $or: orConditions,
        })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate('reportedBy', 'displayName email')
          .select('fuelType price stationName city state source isVerified createdAt reportedBy');
      }

      res.json({
        success: true,
        data: {
          deviation,
          fuelAverages: fuelAverages.map((f: any) => ({ fuelType: f._id, avg: f.avg })),
          outliers,
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getOutliers:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch outliers' });
    }
  };

  /**
   * Toggle the isVerified flag on a community post (existing field).
   */
  static verifyCommunityPost = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { isVerified } = req.body;

      const post = await GasPrice.findByIdAndUpdate(
        id,
        { isVerified: !!isVerified },
        { new: true }
      );

      if (!post) {
        res.status(404).json({ success: false, message: 'Community post not found' });
        return;
      }

      await audit(req, 'post.verify', 'GasPrice', id, { isVerified: !!isVerified });
      res.json({ success: true, data: post, message: 'Post updated' });
    } catch (error) {
      logger.error('Error in AdminPanelController.verifyCommunityPost:', error);
      res.status(500).json({ success: false, message: 'Failed to update post' });
    }
  };

  // ==========================================================
  // 5. STATIONS
  // ==========================================================

  static getStations = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {};
      if (req.query.search) {
        const term = (req.query.search as string).trim();
        filter.$or = [
          { name: { $regex: term, $options: 'i' } },
          { city: { $regex: term, $options: 'i' } },
          { brand: { $regex: term, $options: 'i' } },
        ];
      }
      if (req.query.status === 'active') filter.isActive = true;
      if (req.query.status === 'inactive') filter.isActive = false;

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [stations, total, activeCount, staleCount] = await Promise.all([
        GasStation.find(filter)
          .sort({ lastPriceUpdate: -1 })
          .skip(skip)
          .limit(limit)
          .select('name brand address city state isActive lastPriceUpdate createdAt'),
        GasStation.countDocuments(filter),
        GasStation.countDocuments({ isActive: true }),
        GasStation.countDocuments({
          $or: [{ lastPriceUpdate: { $lt: sevenDaysAgo } }, { lastPriceUpdate: null }],
        }),
      ]);

      res.json({
        success: true,
        data: {
          stations: stations.map((s) => ({
            ...s.toObject(),
            isStale: !s.lastPriceUpdate || s.lastPriceUpdate < sevenDaysAgo,
          })),
          summary: { activeCount, staleCount },
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getStations:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stations' });
    }
  };

  static updateStation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const station = await GasStation.findByIdAndUpdate(
        id,
        { isActive: !!isActive },
        { new: true }
      );

      if (!station) {
        res.status(404).json({ success: false, message: 'Station not found' });
        return;
      }

      await audit(req, 'station.toggle', 'GasStation', id, { isActive: !!isActive });
      res.json({ success: true, data: station, message: 'Station updated' });
    } catch (error) {
      logger.error('Error in AdminPanelController.updateStation:', error);
      res.status(500).json({ success: false, message: 'Failed to update station' });
    }
  };

  // ==========================================================
  // 6. AUDIT LOG
  // ==========================================================

  static getAuditLog = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        AdminAuditLog.find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('actor', 'displayName email'),
        AdminAuditLog.countDocuments(),
      ]);

      res.json({
        success: true,
        data: {
          logs,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      logger.error('Error in AdminPanelController.getAuditLog:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch audit log' });
    }
  };

  // ==========================================================
  // 7. CSV EXPORT
  // ==========================================================

  static exportCsv = async (req: Request, res: Response): Promise<void> => {
    try {
      const { type } = req.params;
      let rows: string[][] = [];
      let filename = 'export.csv';

      if (type === 'users') {
        const users = await User.find()
          .sort({ createdAt: -1 })
          .limit(5000)
          .select('displayName email role preferredFuelType isEmailVerified lastLoginAt createdAt');
        rows.push(['Name', 'Email', 'Role', 'Fuel', 'Verified', 'LastLogin', 'Joined']);
        users.forEach((u: any) => {
          rows.push([
            u.displayName || '',
            u.email || '',
            u.role || '',
            u.preferredFuelType || '',
            String(u.isEmailVerified),
            u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '',
            new Date(u.createdAt).toISOString(),
          ]);
        });
        filename = 'users.csv';
      } else if (type === 'posts') {
        const posts = await GasPrice.find({ source: { $in: COMMUNITY_SOURCES } })
          .sort({ createdAt: -1 })
          .limit(5000)
          .populate('reportedBy', 'email')
          .select('fuelType price stationName city state source isVerified createdAt reportedBy');
        rows.push(['FuelType', 'Price', 'Station', 'City', 'State', 'Source', 'Verified', 'ReportedBy', 'Date']);
        posts.forEach((p: any) => {
          rows.push([
            p.fuelType || '',
            String(p.price ?? ''),
            p.stationName || '',
            p.city || '',
            p.state || '',
            p.source || '',
            String(p.isVerified),
            p.reportedBy?.email || '',
            new Date(p.createdAt).toISOString(),
          ]);
        });
        filename = 'community-posts.csv';
      } else if (type === 'bills') {
        const bills = await Bill.find()
          .sort({ createdAt: -1 })
          .limit(5000)
          .populate('user', 'email')
          .select('status ocrProvider ocrConfidence stationName fuelType pricePerGallon totalAmount createdAt user');
        rows.push(['Status', 'Provider', 'Confidence', 'Station', 'Fuel', 'PricePerGal', 'Total', 'User', 'Date']);
        bills.forEach((b: any) => {
          rows.push([
            b.status || '',
            b.ocrProvider || '',
            String(b.ocrConfidence ?? ''),
            b.stationName || '',
            b.fuelType || '',
            String(b.pricePerGallon ?? ''),
            String(b.totalAmount ?? ''),
            b.user?.email || '',
            new Date(b.createdAt).toISOString(),
          ]);
        });
        filename = 'bills.csv';
      } else {
        res.status(400).json({ success: false, message: 'Invalid export type' });
        return;
      }

      // CSV-escape each cell (handles commas, quotes, newlines).
      const csv = rows
        .map((row) =>
          row
            .map((cell) => {
              const v = String(cell ?? '');
              return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            })
            .join(',')
        )
        .join('\n');

      await audit(req, 'export.csv', type, undefined, { rows: rows.length - 1 });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      logger.error('Error in AdminPanelController.exportCsv:', error);
      res.status(500).json({ success: false, message: 'Failed to export data' });
    }
  };
}
