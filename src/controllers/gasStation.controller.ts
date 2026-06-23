// ============================================================
// GasSync Backend - Gas Station Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import GasStation from '../models/GasStation';
import GasPrice from '../models/GasPrice';
import { ApiResponseHelper } from '../utils/apiResponse';
import { NotFoundError, BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';

export class GasStationController {
  /**
   * @swagger
   * /api/v1/stations:
   *   get:
   *     summary: Get gas stations with optional filters
   *     tags: [Gas Stations]
   *     parameters:
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *         description: Filter by state code (e.g., TX, CA)
   *       - in: query
   *         name: city
   *         schema:
   *           type: string
   *         description: Filter by city name
   *       - in: query
   *         name: zipCode
   *         schema:
   *           type: string
   *         description: Filter by ZIP code
   *       - in: query
   *         name: brand
   *         schema:
   *           type: string
   *         description: Filter by brand (Shell, Chevron, etc.)
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
   *           maximum: 100
   *     responses:
   *       200:
   *         description: List of gas stations
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PaginatedStations'
   */
  static async getStations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { state, city, zipCode, brand } = req.query;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: Record<string, any> = { isActive: true };
      if (state) filter.state = (state as string).toUpperCase();
      if (city) filter.city = new RegExp(city as string, 'i');
      if (zipCode) filter.zipCode = zipCode;
      if (brand) filter.brand = new RegExp(brand as string, 'i');

      const [stations, total] = await Promise.all([
        GasStation.find(filter).skip(skip).limit(limit).sort({ name: 1 }).lean(),
        GasStation.countDocuments(filter),
      ]);

      ApiResponseHelper.paginated(res, stations, total, page, limit, 'Gas stations retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations/nearby:
   *   get:
   *     summary: Find gas stations near a location
   *     tags: [Gas Stations]
   *     parameters:
   *       - in: query
   *         name: lat
   *         required: true
   *         schema:
   *           type: number
   *         description: Latitude
   *       - in: query
   *         name: lng
   *         required: true
   *         schema:
   *           type: number
   *         description: Longitude
   *       - in: query
   *         name: radius
   *         schema:
   *           type: number
   *           default: 10
   *         description: Search radius in miles
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *     responses:
   *       200:
   *         description: Nearby gas stations with distance
   */
  static async getNearbyStations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radiusMiles = parseFloat(req.query.radius as string) || 10;
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

      if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequestError('Valid latitude and longitude are required');
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new BadRequestError('Latitude must be between -90 and 90, longitude between -180 and 180');
      }

      // Convert miles to meters (MongoDB uses meters)
      const radiusMeters = radiusMiles * 1609.34;

      const stations = await GasStation.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            distanceField: 'distance',
            maxDistance: radiusMeters,
            spherical: true,
            query: { isActive: true },
          },
        },
        { $limit: limit },
        {
          $addFields: {
            distanceMiles: { $round: [{ $divide: ['$distance', 1609.34] }, 2] },
          },
        },
      ]);

      // Fetch latest prices for each station
      const stationsWithPrices = await Promise.all(
        stations.map(async (station) => {
          const latestPrices = await GasPrice.find({ station: station._id })
            .sort({ recordedAt: -1 })
            .limit(4)
            .lean();

          const prices: Record<string, number | null> = {
            regular: null,
            midgrade: null,
            premium: null,
            diesel: null,
          };

          latestPrices.forEach((p) => {
            if (!prices[p.fuelType]) {
              prices[p.fuelType] = p.price;
            }
          });

          return { ...station, prices };
        })
      );

      ApiResponseHelper.success(res, stationsWithPrices, 'Nearby stations retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations/{id}:
   *   get:
   *     summary: Get a gas station by ID
   *     tags: [Gas Stations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Station ID
   *     responses:
   *       200:
   *         description: Gas station details with latest prices
   *       404:
   *         description: Station not found
   */
  static async getStationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const station = await GasStation.findById(req.params.id).lean();

      if (!station) {
        throw new NotFoundError('Gas station not found');
      }

      // Get latest prices
      const latestPrices = await GasPrice.find({ station: station._id })
        .sort({ recordedAt: -1 })
        .limit(20)
        .lean();

      // Get price history (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const priceHistory = await GasPrice.find({
        station: station._id,
        recordedAt: { $gte: thirtyDaysAgo },
      })
        .sort({ recordedAt: 1 })
        .lean();

      ApiResponseHelper.success(res, {
        ...station,
        latestPrices,
        priceHistory,
      }, 'Station details retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations:
   *   post:
   *     summary: Create a new gas station (Admin)
   *     tags: [Gas Stations]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/GasStationInput'
   *     responses:
   *       201:
   *         description: Gas station created
   *       401:
   *         description: Not authenticated
   *       403:
   *         description: Not authorized (admin only)
   */
  static async createStation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const station = new GasStation(req.body);
      await station.save();

      logger.info(`New gas station created: ${station.name} (${station.city}, ${station.state})`);

      ApiResponseHelper.created(res, station, 'Gas station created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations/{id}:
   *   put:
   *     summary: Update a gas station (Admin)
   *     tags: [Gas Stations]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/GasStationInput'
   *     responses:
   *       200:
   *         description: Gas station updated
   *       404:
   *         description: Station not found
   */
  static async updateStation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const station = await GasStation.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });

      if (!station) {
        throw new NotFoundError('Gas station not found');
      }

      ApiResponseHelper.success(res, station, 'Gas station updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations/{id}:
   *   delete:
   *     summary: Delete a gas station (Admin)
   *     tags: [Gas Stations]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Gas station deleted (soft delete)
   *       404:
   *         description: Station not found
   */
  static async deleteStation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const station = await GasStation.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      );

      if (!station) {
        throw new NotFoundError('Gas station not found');
      }

      logger.info(`Gas station deactivated: ${station.name}`);

      ApiResponseHelper.success(res, null, 'Gas station deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/stations/search:
   *   get:
   *     summary: Search gas stations by name, brand, or address
   *     tags: [Gas Stations]
   *     parameters:
   *       - in: query
   *         name: q
   *         required: true
   *         schema:
   *           type: string
   *         description: Search query
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *     responses:
   *       200:
   *         description: Search results
   */
  static async searchStations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query.q as string;
      const limit = Math.min(50, parseInt(req.query.limit as string) || 10);

      if (!query || query.length < 2) {
        throw new BadRequestError('Search query must be at least 2 characters');
      }

      const regex = new RegExp(query, 'i');

      const stations = await GasStation.find({
        isActive: true,
        $or: [
          { name: regex },
          { brand: regex },
          { address: regex },
          { city: regex },
          { zipCode: regex },
        ],
      })
        .limit(limit)
        .lean();

      ApiResponseHelper.success(res, stations, `Found ${stations.length} stations`);
    } catch (error) {
      next(error);
    }
  }
}
