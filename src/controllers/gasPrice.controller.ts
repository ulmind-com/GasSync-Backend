// ============================================================
// GasSync Backend - Gas Price Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import GasPrice from '../models/GasPrice';
import PriceHistory from '../models/PriceHistory';
import GasStation from '../models/GasStation';
import { ApiResponseHelper } from '../utils/apiResponse';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class GasPriceController {
  /**
   * @swagger
   * /api/v1/prices/latest:
   *   get:
   *     summary: Get latest gas prices (optionally filtered)
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *         description: Filter by state code
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *       - in: query
   *         name: source
   *         schema:
   *           type: string
   *           enum: [api_eia, api_collect, user_bill, user_report]
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
   *     responses:
   *       200:
   *         description: Latest gas prices
   */
  static async getLatestPrices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { state, fuelType, source } = req.query;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {};
      if (state) filter.state = (state as string).toUpperCase();
      if (fuelType) filter.fuelType = fuelType;
      if (source) filter.source = source;

      const [prices, total] = await Promise.all([
        GasPrice.find(filter)
          .populate('station', 'name brand city state zipCode')
          .sort({ recordedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        GasPrice.countDocuments(filter),
      ]);

      ApiResponseHelper.paginated(res, prices, total, page, limit, 'Latest prices retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/station/{stationId}:
   *   get:
   *     summary: Get price history for a specific station
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: path
   *         name: stationId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *       - in: query
   *         name: days
   *         schema:
   *           type: integer
   *           default: 30
   *         description: Number of days of history
   *     responses:
   *       200:
   *         description: Station price history
   *       404:
   *         description: Station not found
   */
  static async getStationPrices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stationId } = req.params;
      const fuelType = req.query.fuelType as string;
      const days = parseInt(req.query.days as string) || 30;

      const station = await GasStation.findById(stationId);
      if (!station) {
        throw new NotFoundError('Gas station not found');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const filter: Record<string, any> = {
        station: stationId,
        recordedAt: { $gte: startDate },
      };
      if (fuelType) filter.fuelType = fuelType;

      const prices = await GasPrice.find(filter)
        .sort({ recordedAt: 1 })
        .lean();

      // Calculate stats
      const stats = {
        count: prices.length,
        avgPrice: prices.length > 0
          ? Number((prices.reduce((sum, p) => sum + p.price, 0) / prices.length).toFixed(3))
          : null,
        minPrice: prices.length > 0 ? Math.min(...prices.map((p) => p.price)) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices.map((p) => p.price)) : null,
        latestPrice: prices.length > 0 ? prices[prices.length - 1].price : null,
      };

      ApiResponseHelper.success(res, { station, prices, stats }, 'Station prices retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/history:
   *   get:
   *     summary: Get aggregated price history (trends)
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: region
   *         schema:
   *           type: string
   *           default: US
   *         description: Region code (state or US for national)
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *           default: regular
   *       - in: query
   *         name: period
   *         schema:
   *           type: string
   *           enum: [7d, 30d, 90d, 1y, all]
   *           default: 30d
   *         description: Time period
   *     responses:
   *       200:
   *         description: Price history trends
   */
  static async getPriceHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const region = ((req.query.region as string) || 'US').toUpperCase();
      const fuelType = (req.query.fuelType as string) || 'regular';
      const period = (req.query.period as string) || '30d';

      // Calculate start date
      const startDate = new Date();
      switch (period) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(startDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        case 'all':
          startDate.setFullYear(2020);
          break;
        default:
          startDate.setDate(startDate.getDate() - 30);
      }

      const history = await PriceHistory.find({
        region,
        fuelType,
        recordedDate: { $gte: startDate },
      })
        .sort({ recordedDate: 1 })
        .lean();

      // Calculate trend
      let trend = 'stable';
      if (history.length >= 2) {
        const recent = history[history.length - 1].avgPrice;
        const previous = history[0].avgPrice;
        const change = ((recent - previous) / previous) * 100;
        trend = change > 1 ? 'up' : change < -1 ? 'down' : 'stable';
      }

      ApiResponseHelper.success(res, {
        region,
        fuelType,
        period,
        trend,
        dataPoints: history.length,
        history,
      }, 'Price history retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/compare:
   *   get:
   *     summary: Compare gas prices across states
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: states
   *         required: true
   *         schema:
   *           type: string
   *         description: Comma-separated state codes (e.g., TX,CA,NY)
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *           default: regular
   *     responses:
   *       200:
   *         description: Price comparison across states
   */
  static async comparePrices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const statesParam = req.query.states as string;
      const fuelType = (req.query.fuelType as string) || 'regular';

      if (!statesParam) {
        throw new BadRequestError('States parameter is required (comma-separated state codes)');
      }

      const states = statesParam.split(',').map((s) => s.trim().toUpperCase());

      if (states.length < 2 || states.length > 10) {
        throw new BadRequestError('Please provide between 2 and 10 states for comparison');
      }

      const comparison = await Promise.all(
        states.map(async (state) => {
          const latestHistory = await PriceHistory.findOne({
            region: state,
            fuelType,
          })
            .sort({ recordedDate: -1 })
            .lean();

          return {
            state,
            fuelType,
            avgPrice: latestHistory?.avgPrice || null,
            minPrice: latestHistory?.minPrice || null,
            maxPrice: latestHistory?.maxPrice || null,
            recordedDate: latestHistory?.recordedDate || null,
          };
        })
      );

      // Sort by price (cheapest first)
      comparison.sort((a, b) => (a.avgPrice || 999) - (b.avgPrice || 999));

      ApiResponseHelper.success(res, comparison, 'Price comparison retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices:
   *   post:
   *     summary: Report a gas price (authenticated users)
   *     tags: [Gas Prices]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - stationId
   *               - fuelType
   *               - price
   *             properties:
   *               stationId:
   *                 type: string
   *               fuelType:
   *                 type: string
   *                 enum: [regular, midgrade, premium, diesel]
   *               price:
   *                 type: number
   *                 example: 3.49
   *     responses:
   *       201:
   *         description: Price reported successfully
   *       401:
   *         description: Not authenticated
   */
  static async reportPrice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stationId, fuelType, price } = req.body;

      const station = await GasStation.findById(stationId);
      if (!station) {
        throw new NotFoundError('Gas station not found');
      }

      const gasPrice = new GasPrice({
        station: stationId,
        fuelType,
        price,
        source: 'user_report',
        state: station.state,
        city: station.city,
        zipCode: station.zipCode,
        reportedBy: req.userId,
        recordedAt: new Date(),
      });

      await gasPrice.save();

      // Update station's last price update
      station.lastPriceUpdate = new Date();
      await station.save();

      logger.info(`Price reported: ${station.name} - ${fuelType}: $${price}`);

      ApiResponseHelper.created(res, gasPrice, 'Price reported successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/national-average:
   *   get:
   *     summary: Get national average gas prices
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *     responses:
   *       200:
   *         description: National average prices
   */
  static async getNationalAverage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fuelType = req.query.fuelType as string;

      const filter: Record<string, any> = { region: 'US' };
      if (fuelType) filter.fuelType = fuelType;

      const latestAverages = await PriceHistory.find(filter)
        .sort({ recordedDate: -1 })
        .limit(fuelType ? 1 : 4) // 4 fuel types if no filter
        .lean();

      // Get 7-day trend
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const weeklyTrend = await PriceHistory.find({
        region: 'US',
        fuelType: fuelType || 'regular',
        recordedDate: { $gte: weekAgo },
      })
        .sort({ recordedDate: 1 })
        .lean();

      ApiResponseHelper.success(res, {
        current: latestAverages,
        weeklyTrend,
      }, 'National average prices retrieved');
    } catch (error) {
      next(error);
    }
  }
}
