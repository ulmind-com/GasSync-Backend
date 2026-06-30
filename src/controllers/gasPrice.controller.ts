// ============================================================
// GasSync Backend - Gas Price Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import GasPrice from '../models/GasPrice';
import PriceHistory from '../models/PriceHistory';
import GasStation from '../models/GasStation';
import StationPriceCache from '../models/StationPriceCache';
import { tryConsumeGoogleQuota } from '../models/ApiUsage';
import Bill from '../models/Bill';
import { ApiResponseHelper } from '../utils/apiResponse';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCe6KCXl5MO1INT16N9I_kiMwXxwZHJc8o';
const CACHE_TTL_HOURS = 24;

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
      } as any)
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
          } as any)
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
        stationName: station.name,
        stationAddress: station.address,
        location:
          station.location && Array.isArray(station.location.coordinates) && station.location.coordinates.length === 2
            ? { type: 'Point', coordinates: station.location.coordinates }
            : undefined,
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
      } as any)
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

  /**
   * @swagger
   * /api/v1/prices/by-place/{googlePlaceId}:
   *   get:
   *     summary: Get fuel prices for a station by Google Place ID (cached 24hr)
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: path
   *         name: googlePlaceId
   *         required: true
   *         schema:
   *           type: string
   *         description: Google Places place_id
   *     responses:
   *       200:
   *         description: Station fuel prices (from cache or fresh from Google)
   */
  static async getStationPricesByPlaceId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { googlePlaceId } = req.params;

      if (!googlePlaceId) {
        throw new BadRequestError('Google Place ID is required');
      }

      // ─── ALWAYS fetch community prices from DB (independent of cache/Google) ───
      const communityPrices = await Bill.find({
        googlePlaceId,
        status: { $in: ['extracted', 'verified'] },
        pricePerGallon: { $ne: null },
      })
        .sort({ billDate: -1 })
        .limit(10)
        .populate('user', 'displayName avatarUrl')
        .lean();

      logger.info(`[by-place] ${googlePlaceId} — found ${communityPrices.length} community prices`);

      const mappedCommunity = communityPrices.map(b => ({
        id: b._id,
        fuelType: b.fuelType || 'regular',
        price: b.pricePerGallon,
        reportedBy: (b.user as any)?.displayName || 'Anonymous',
        reportedByAvatar: (b.user as any)?.avatarUrl || null,
        billDate: b.billDate,
        source: 'user_bill',
        imageUrl: b.imageUrl,
        totalAmount: b.totalAmount,
        totalGallons: b.totalGallons,
        helpfulCount: b.helpfulUsers?.length || 0,
        notHelpfulCount: b.notHelpfulUsers?.length || 0,
        helpfulUsers: b.helpfulUsers || [],
        notHelpfulUsers: b.notHelpfulUsers || [],
      }));

      // ─── Fuel prices: check 24hr cache, else fetch from Google ───
      let fuelPrices: any[] = [];
      let stationName = '';
      let source = 'none';
      let fetchedAt: Date | null = null;

      const cached = await StationPriceCache.findOne({ googlePlaceId }).lean();

      if (cached && cached.fuelPrices.length > 0) {
        // Cache HIT — use cached Google fuel prices
        logger.info(`[by-place] Cache HIT for fuel prices: ${googlePlaceId}`);
        fuelPrices = cached.fuelPrices;
        stationName = cached.stationName;
        source = 'cache';
        fetchedAt = cached.fetchedAt;
      } else {
        // Cache MISS — fetch fresh from Google
        try {
          logger.info(`[by-place] Cache MISS for fuel prices: ${googlePlaceId} — fetching from Google`);

          const googleRes = await axios.get(
            `https://places.googleapis.com/v1/places/${googlePlaceId}`,
            {
              headers: {
                'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask': 'displayName,fuelOptions',
              },
              timeout: 10000,
            }
          );

          const placeData = googleRes.data;
          const fuelOptions = placeData?.fuelOptions?.fuelPrices || [];
          stationName = placeData?.displayName?.text || '';

          fuelPrices = fuelOptions.map((fp: any) => ({
            type: fp.type || 'UNKNOWN',
            price: fp.price?.units
              ? parseFloat(`${fp.price.units}.${(fp.price.nanos || 0).toString().padStart(9, '0').slice(0, 2)}`)
              : 0,
            currencyCode: fp.price?.currencyCode || 'USD',
            updateTime: fp.updateTime ? new Date(fp.updateTime) : new Date(),
          }));

          // Save to cache (24hr TTL)
          const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);
          await StationPriceCache.findOneAndUpdate(
            { googlePlaceId },
            { googlePlaceId, stationName, fuelPrices, fetchedAt: new Date(), expiresAt },
            { upsert: true, new: true }
          );

          source = 'google';
          fetchedAt = new Date();
          logger.info(`[by-place] Cached ${fuelPrices.length} fuel prices for: ${stationName || googlePlaceId}`);
        } catch (googleError: any) {
          logger.warn(`[by-place] Google API failed for ${googlePlaceId}: ${googleError?.message || 'unknown'}`);
          source = 'community_only';
        }
      }

      // ─── Return both fuel prices + community prices ───
      ApiResponseHelper.success(res, {
        source,
        stationName,
        fuelPrices,
        fetchedAt,
        communityPrices: mappedCommunity,
      }, `Station prices retrieved (${source}, ${mappedCommunity.length} community)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/by-station:
   *   get:
   *     summary: Fuel prices for a DB/OSM station by name + lat/lon (10-day cache, quota-capped)
   *     description: |
   *       For stations served from our own DB (no Google place_id). Community
   *       prices first (free). Cached Google price reused for 10 days. On a cache
   *       miss/stale, resolves the station via Google Text Search (with fuelOptions)
   *       only while under the daily budget cap; otherwise serves the last-known
   *       price from cache so the user never sees a blank.
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: name
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: lat
   *         required: true
   *         schema: { type: number }
   *       - in: query
   *         name: lon
   *         required: true
   *         schema: { type: number }
   */
  static async getStationPricesByNameLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const name = (req.query.name as string) || '';
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      if (!name || isNaN(lat) || isNaN(lon)) {
        throw new BadRequestError('name, lat, and lon query parameters are required');
      }

      // ─── 1. Community prices (FREE — within 500m) ───
      let mappedCommunity: any[] = [];
      try {
        const community = await Bill.find({
          location: { $nearSphere: { $geometry: { type: 'Point', coordinates: [lon, lat] }, $maxDistance: 500 } },
          status: { $in: ['extracted', 'verified'] },
          pricePerGallon: { $ne: null },
        }).sort({ billDate: -1 }).limit(10).populate('user', 'displayName avatarUrl').lean();
        mappedCommunity = community.map((b) => ({
          id: b._id,
          fuelType: b.fuelType || 'regular',
          price: b.pricePerGallon,
          reportedBy: (b.user as any)?.displayName || 'Anonymous',
          reportedByAvatar: (b.user as any)?.avatarUrl || null,
          billDate: b.billDate,
          source: 'user_bill',
          imageUrl: b.imageUrl,
        }));
      } catch (geoErr: any) {
        logger.debug(`[by-station] community geo query skipped: ${geoErr?.message}`);
      }

      // ─── 2. Price cache lookup (~200m) ───
      const D = 0.002;
      const cacheFilter = { stationLat: { $gte: lat - D, $lte: lat + D }, stationLon: { $gte: lon - D, $lte: lon + D } };
      const cached = await StationPriceCache.findOne(cacheFilter).lean();

      let fuelPrices: any[] = [];
      let stationName = name;
      let source = 'none';
      let fetchedAt: Date | null = null;

      const FRESH_MS = 10 * 24 * 60 * 60 * 1000; // 10-day freshness
      const cacheAgeOk = cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS;
      const haveCache = !!(cached && cached.fuelPrices.length > 0);
      const serveStale = () => {
        fuelPrices = cached!.fuelPrices;
        stationName = cached!.stationName || name;
        source = 'stale_cache';
        fetchedAt = cached!.fetchedAt;
      };

      if (haveCache && cacheAgeOk) {
        // Fresh enough — no API call
        fuelPrices = cached!.fuelPrices;
        stationName = cached!.stationName || name;
        source = 'cache';
        fetchedAt = cached!.fetchedAt;
      } else if (await tryConsumeGoogleQuota()) {
        // Stale/missing AND budget available — resolve via Google Text Search (incl. fuelOptions)
        try {
          logger.info(`[by-station] refresh via Google: ${name} @ ${lat},${lon}`);
          const gRes = await axios.post(
            'https://places.googleapis.com/v1/places:searchText',
            {
              textQuery: name,
              locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 500.0 } },
              maxResultCount: 1,
            },
            {
              headers: {
                'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.fuelOptions',
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            }
          );
          const place = gRes.data?.places?.[0];
          const fuelOptions = place?.fuelOptions?.fuelPrices || [];
          if (place && fuelOptions.length > 0) {
            stationName = place.displayName?.text || name;
            fuelPrices = fuelOptions.map((fp: any) => ({
              type: fp.type || 'UNKNOWN',
              price: fp.price?.units
                ? parseFloat(`${fp.price.units}.${(fp.price.nanos || 0).toString().padStart(9, '0').slice(0, 2)}`)
                : 0,
              currencyCode: fp.price?.currencyCode || 'USD',
              updateTime: fp.updateTime ? new Date(fp.updateTime) : new Date(),
            }));
            // Cache with long expiry so stale data stays available as fallback
            const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            await StationPriceCache.findOneAndUpdate(
              cacheFilter,
              { googlePlaceId: `osm-${lat.toFixed(4)},${lon.toFixed(4)}`, stationName, stationLat: lat, stationLon: lon, fuelPrices, fetchedAt: new Date(), expiresAt },
              { upsert: true, new: true }
            );
            source = 'google';
            fetchedAt = new Date();
          } else if (haveCache) {
            serveStale(); // Google had no price — keep old
          } else {
            source = 'community_only';
          }
        } catch (apiErr: any) {
          logger.warn(`[by-station] Google failed for ${name}: ${apiErr?.message || 'unknown'}`);
          if (haveCache) serveStale();
          else source = 'community_only';
        }
      } else if (haveCache) {
        // Daily budget hit — serve last-known price, never blank
        serveStale();
      } else {
        source = 'quota_exhausted';
      }

      ApiResponseHelper.success(res, {
        source,
        stationName,
        fuelPrices,
        fetchedAt,
        communityPrices: mappedCommunity,
      }, `Station prices retrieved (${source}, ${mappedCommunity.length} community)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/community/by-places:
   *   post:
   *     summary: Get community prices for multiple stations efficiently
   *     tags: [Gas Prices]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               placeIds:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Community prices retrieved
   */
  static async getCommunityPricesByPlaceIds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { placeIds } = req.body;
      if (!Array.isArray(placeIds)) {
        throw new BadRequestError('placeIds must be an array');
      }

      const communityPrices = await Bill.find({
        googlePlaceId: { $in: placeIds },
        status: { $in: ['extracted', 'verified'] },
        pricePerGallon: { $ne: null },
      })
        .sort({ billDate: -1 })
        .populate('user', 'displayName avatarUrl')
        .lean();

      ApiResponseHelper.success(res, communityPrices.map(b => ({
        id: b._id,
        googlePlaceId: b.googlePlaceId,
        stationId: b.googlePlaceId, // for frontend compatibility
        stationName: b.stationName,
        fuelType: b.fuelType || 'regular',
        price: b.pricePerGallon,
        reportedBy: (b.user as any)?.displayName || 'Anonymous',
        reportedByAvatar: (b.user as any)?.avatarUrl || null,
        billDate: b.billDate,
        source: 'user_bill',
        imageUrl: b.imageUrl,
        totalAmount: b.totalAmount,
        totalGallons: b.totalGallons,
        helpfulCount: b.helpfulUsers?.length || 0,
        notHelpfulCount: b.notHelpfulUsers?.length || 0,
        helpfulUsers: b.helpfulUsers || [],
        notHelpfulUsers: b.notHelpfulUsers || [],
      })), 'Community prices retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/prices/community/recent:
   *   get:
   *     summary: Get all recent community price reports (for home feed)
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *     responses:
   *       200:
   *         description: Recent community prices
   */
  static async getCommunityRecent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

      const communityPrices = await Bill.find({
        googlePlaceId: { $ne: null },
        status: { $in: ['extracted', 'verified'] },
        pricePerGallon: { $ne: null },
      })
        .sort({ billDate: -1 })
        .limit(limit)
        .populate('user', 'displayName avatarUrl')
        .lean();

      ApiResponseHelper.success(res, communityPrices.map(b => ({
        id: b._id,
        googlePlaceId: b.googlePlaceId,
        stationId: b.googlePlaceId,
        stationName: b.stationName,
        fuelType: b.fuelType || 'regular',
        price: b.pricePerGallon,
        reportedBy: (b.user as any)?.displayName || 'Anonymous',
        reportedByAvatar: (b.user as any)?.avatarUrl || null,
        billDate: b.billDate,
        source: 'user_bill',
        imageUrl: b.imageUrl,
        totalAmount: b.totalAmount,
        totalGallons: b.totalGallons,
        helpfulCount: b.helpfulUsers?.length || 0,
        notHelpfulCount: b.notHelpfulUsers?.length || 0,
        helpfulUsers: b.helpfulUsers || [],
        notHelpfulUsers: b.notHelpfulUsers || [],
      })), 'Recent community prices retrieved');
    } catch (error) {
      next(error);
    }
  }
  /**
   * @swagger
   * /api/v1/prices/community/nearby:
   *   get:
   *     summary: Get nearby community price reports (for local home feed)
   *     tags: [Gas Prices]
   *     parameters:
   *       - in: query
   *         name: lat
   *         required: true
   *         schema:
   *           type: number
   *       - in: query
   *         name: lng
   *         required: true
   *         schema:
   *           type: number
   *       - in: query
   *         name: radiusMiles
   *         schema:
   *           type: number
   *           default: 20
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *     responses:
   *       200:
   *         description: Nearby community prices
   */
  static async getCommunityNearby(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radiusMiles = parseFloat(req.query.radiusMiles as string) || 20;
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

      if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequestError('Valid lat and lng query parameters are required');
      }

      // Convert miles to meters for MongoDB $nearSphere (1 mile = 1609.34 meters)
      const maxDistance = radiusMiles * 1609.34;

      const communityPrices = await Bill.find({
        location: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat],
            },
            $maxDistance: maxDistance,
          }
        },
        status: { $in: ['extracted', 'verified'] },
        pricePerGallon: { $ne: null },
      })
        .limit(limit)
        .populate('user', 'displayName avatarUrl')
        .lean();

      // Ensure they are sorted by billDate (MongoDB $nearSphere forces distance sort, we can sort after if we want, or rely on distance)
      const sortedByDate = communityPrices.sort((a: any, b: any) => new Date(b.billDate || 0).getTime() - new Date(a.billDate || 0).getTime());

      ApiResponseHelper.success(res, sortedByDate.map(b => ({
        id: b._id,
        googlePlaceId: b.googlePlaceId,
        stationId: b.googlePlaceId,
        stationName: b.stationName,
        fuelType: b.fuelType || 'regular',
        price: b.pricePerGallon,
        reportedBy: (b.user as any)?.displayName || 'Anonymous',
        reportedByAvatar: (b.user as any)?.avatarUrl || null,
        billDate: b.billDate,
        source: 'user_bill',
        imageUrl: b.imageUrl,
        totalAmount: b.totalAmount,
        totalGallons: b.totalGallons,
        helpfulCount: b.helpfulUsers?.length || 0,
        notHelpfulCount: b.notHelpfulUsers?.length || 0,
        helpfulUsers: b.helpfulUsers || [],
        notHelpfulUsers: b.notHelpfulUsers || [],
      })), 'Nearby community prices retrieved');
    } catch (error) {
      next(error);
    }
  }
}
