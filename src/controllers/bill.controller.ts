// ============================================================
// GasSync Backend - Bill Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Bill from '../models/Bill';
import GasPrice from '../models/GasPrice';
import GasStation from '../models/GasStation';
import { ApiResponseHelper } from '../utils/apiResponse';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors';
import { logger } from '../utils/logger';

export class BillController {
  /**
   * @swagger
   * /api/v1/bills:
   *   post:
   *     summary: Upload a gas bill/receipt image
   *     tags: [Bills]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - billImage
   *             properties:
   *               billImage:
   *                 type: string
   *                 format: binary
   *                 description: Gas bill/receipt image (JPEG, PNG, WebP)
   *               stationName:
   *                 type: string
   *                 description: Station name (if known)
   *               fuelType:
   *                 type: string
   *                 enum: [regular, midgrade, premium, diesel]
   *               notes:
   *                 type: string
   *     responses:
   *       201:
   *         description: Bill uploaded, processing started
   *       400:
   *         description: No image provided
   *       401:
   *         description: Not authenticated
   */
  static async uploadBill(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        throw new BadRequestError('Bill image is required');
      }

      // Build image URL (local for dev, cloud URL for production)
      const imageUrl = req.file.path
        ? `/uploads/bills/${req.file.filename}`
        : `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

      const bill = new Bill({
        user: req.userId,
        imageUrl,
        googlePlaceId: req.body.googlePlaceId || null,
        stationName: req.body.stationName || null,
        fuelType: req.body.fuelType || null,
        notes: req.body.notes || null,
        status: 'processing',
      });

      await bill.save();

      logger.info(`Bill uploaded by user ${req.userId}: ${bill._id}`);

      // TODO: Trigger async OCR processing here
      // For now, mark as 'processing' — OCR will be handled by a background job or separate endpoint

      ApiResponseHelper.created(res, bill, 'Bill uploaded successfully. Processing will begin shortly.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills:
   *   get:
   *     summary: Get user's bills
   *     tags: [Bills]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [uploading, processing, extracted, verified, failed]
   *       - in: query
   *         name: fuelType
   *         schema:
   *           type: string
   *           enum: [regular, midgrade, premium, diesel]
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter bills from this date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter bills until this date
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
   *         description: User's bills
   *       401:
   *         description: Not authenticated
   */
  static async getUserBills(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, fuelType, startDate, endDate } = req.query;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = { user: req.userId };
      if (status) filter.status = status;
      if (fuelType) filter.fuelType = fuelType;
      if (startDate || endDate) {
        filter.billDate = {};
        if (startDate) filter.billDate.$gte = new Date(startDate as string);
        if (endDate) filter.billDate.$lte = new Date(endDate as string);
      }

      const [bills, total] = await Promise.all([
        Bill.find(filter)
          .populate('station', 'name brand city state')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Bill.countDocuments(filter),
      ]);

      ApiResponseHelper.paginated(res, bills, total, page, limit, 'Bills retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills/{id}:
   *   get:
   *     summary: Get a specific bill
   *     tags: [Bills]
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
   *         description: Bill details
   *       404:
   *         description: Bill not found
   */
  static async getBillById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const bill = await Bill.findById(req.params.id)
        .populate('station', 'name brand address city state zipCode')
        .populate('user', 'displayName email')
        .lean();

      if (!bill) {
        throw new NotFoundError('Bill not found');
      }

      // Only allow owner or admin
      if (bill.user && (bill.user as any)._id.toString() !== req.userId && req.user?.role !== 'admin') {
        throw new ForbiddenError('You can only view your own bills');
      }

      ApiResponseHelper.success(res, bill, 'Bill retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills/{id}:
   *   put:
   *     summary: Update/correct bill data (after OCR extraction)
   *     tags: [Bills]
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
   *             type: object
   *             properties:
   *               stationName:
   *                 type: string
   *               fuelType:
   *                 type: string
   *                 enum: [regular, midgrade, premium, diesel]
   *               pricePerGallon:
   *                 type: number
   *               totalGallons:
   *                 type: number
   *               totalAmount:
   *                 type: number
   *               billDate:
   *                 type: string
   *                 format: date
   *               notes:
   *                 type: string
   *     responses:
   *       200:
   *         description: Bill updated
   *       404:
   *         description: Bill not found
   */
  static async updateBill(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const bill = await Bill.findById(req.params.id);

      if (!bill) {
        throw new NotFoundError('Bill not found');
      }

      if (bill.user.toString() !== req.userId && req.user?.role !== 'admin') {
        throw new ForbiddenError('You can only update your own bills');
      }

      const allowedFields = [
        'stationName', 'stationAddress', 'fuelType', 'pricePerGallon',
        'totalGallons', 'totalAmount', 'billDate', 'paymentMethod', 'notes',
      ];

      const correctedFields: string[] = [];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          (bill as any)[field] = req.body[field];
          correctedFields.push(field);
        }
      }

      if (correctedFields.length > 0) {
        bill.userCorrected = true;
        bill.correctedFields = correctedFields;
      }

      // If user provides price data, mark as verified
      if (req.body.pricePerGallon && req.body.billDate) {
        bill.status = 'verified';

        // Also create a GasPrice entry from the bill data
        const priceEntry = new GasPrice({
          station: bill.station || undefined,
          fuelType: bill.fuelType || 'regular',
          price: bill.pricePerGallon!,
          source: 'user_bill',
          state: req.body.state,
          city: req.body.city,
          reportedBy: req.userId,
          recordedAt: new Date(bill.billDate!),
        });
        await priceEntry.save();
      }

      await bill.save();

      logger.info(`Bill updated by user ${req.userId}: ${bill._id}`);

      ApiResponseHelper.success(res, bill, 'Bill updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills/{id}:
   *   delete:
   *     summary: Delete a bill
   *     tags: [Bills]
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
   *         description: Bill deleted
   *       404:
   *         description: Bill not found
   */
  static async deleteBill(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const bill = await Bill.findById(req.params.id);

      if (!bill) {
        throw new NotFoundError('Bill not found');
      }

      if (bill.user.toString() !== req.userId && req.user?.role !== 'admin') {
        throw new ForbiddenError('You can only delete your own bills');
      }

      await Bill.findByIdAndDelete(req.params.id);

      logger.info(`Bill deleted by user ${req.userId}: ${req.params.id}`);

      ApiResponseHelper.success(res, null, 'Bill deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills/{id}/process-ocr:
   *   post:
   *     summary: Submit OCR extracted text for a bill (from mobile app's ML Kit)
   *     tags: [Bills]
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
   *             type: object
   *             required:
   *               - ocrRawText
   *             properties:
   *               ocrRawText:
   *                 type: string
   *                 description: Raw text extracted by ML Kit on the mobile device
   *               ocrConfidence:
   *                 type: number
   *                 description: OCR confidence (0.0 - 1.0)
   *     responses:
   *       200:
   *         description: OCR processed, data extracted
   *       404:
   *         description: Bill not found
   */
  static async processOCR(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { ocrRawText, ocrConfidence } = req.body;

      if (!ocrRawText) {
        throw new BadRequestError('OCR raw text is required');
      }

      const bill = await Bill.findById(req.params.id);
      if (!bill) {
        throw new NotFoundError('Bill not found');
      }

      if (bill.user.toString() !== req.userId) {
        throw new ForbiddenError('You can only process your own bills');
      }

      // Store raw OCR text
      bill.ocrRawText = ocrRawText;
      bill.ocrConfidence = ocrConfidence || null;
      bill.ocrProvider = 'ml_kit';

      // ============================================================
      // INTELLIGENT EXTRACTION — Parse gas bill fields from raw text
      // ============================================================
      try {
        const extracted = extractBillData(ocrRawText);

        if (extracted.pricePerGallon) bill.pricePerGallon = extracted.pricePerGallon;
        if (extracted.totalGallons) bill.totalGallons = extracted.totalGallons;
        if (extracted.totalAmount) bill.totalAmount = extracted.totalAmount;
        if (extracted.fuelType) bill.fuelType = extracted.fuelType;
        if (extracted.stationName) bill.stationName = extracted.stationName;
        if (extracted.billDate) bill.billDate = extracted.billDate;
        if (extracted.paymentMethod) bill.paymentMethod = extracted.paymentMethod;

        bill.status = 'extracted';
        logger.info(`OCR extraction successful for bill ${bill._id}`);
      } catch (parseError) {
        bill.status = 'failed';
        bill.processingError = 'Failed to extract data from OCR text';
        logger.warn(`OCR extraction failed for bill ${bill._id}:`, parseError);
      }

      await bill.save();

      ApiResponseHelper.success(res, bill, `Bill OCR processed. Status: ${bill.status}`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @swagger
   * /api/v1/bills/stats:
   *   get:
   *     summary: Get user's bill statistics (spending summary)
   *     tags: [Bills]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: period
   *         schema:
   *           type: string
   *           enum: [7d, 30d, 90d, 1y, all]
   *           default: 30d
   *     responses:
   *       200:
   *         description: Bill statistics
   */
  static async getBillStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const period = (req.query.period as string) || '30d';

      const startDate = new Date();
      switch (period) {
        case '7d': startDate.setDate(startDate.getDate() - 7); break;
        case '30d': startDate.setDate(startDate.getDate() - 30); break;
        case '90d': startDate.setDate(startDate.getDate() - 90); break;
        case '1y': startDate.setFullYear(startDate.getFullYear() - 1); break;
        case 'all': startDate.setFullYear(2020); break;
      }

      const stats = await Bill.aggregate([
        {
          $match: {
            user: req.user!._id,
            status: { $in: ['extracted', 'verified'] },
            billDate: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: null,
            totalBills: { $sum: 1 },
            totalSpent: { $sum: '$totalAmount' },
            totalGallons: { $sum: '$totalGallons' },
            avgPricePerGallon: { $avg: '$pricePerGallon' },
            minPricePerGallon: { $min: '$pricePerGallon' },
            maxPricePerGallon: { $max: '$pricePerGallon' },
          },
        },
      ]);

      // Get monthly breakdown
      const monthlyBreakdown = await Bill.aggregate([
        {
          $match: {
            user: req.user!._id,
            status: { $in: ['extracted', 'verified'] },
            billDate: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$billDate' },
              month: { $month: '$billDate' },
            },
            totalSpent: { $sum: '$totalAmount' },
            totalGallons: { $sum: '$totalGallons' },
            avgPrice: { $avg: '$pricePerGallon' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);

      ApiResponseHelper.success(res, {
        summary: stats[0] || {
          totalBills: 0,
          totalSpent: 0,
          totalGallons: 0,
          avgPricePerGallon: null,
          minPricePerGallon: null,
          maxPricePerGallon: null,
        },
        monthlyBreakdown,
        period,
      }, 'Bill statistics retrieved');
    } catch (error) {
      next(error);
    }
  }
}

// ============================================================
// Helper: Extract structured data from raw OCR text
// ============================================================
function extractBillData(rawText: string): {
  pricePerGallon?: number;
  totalGallons?: number;
  totalAmount?: number;
  fuelType?: 'regular' | 'midgrade' | 'premium' | 'diesel';
  stationName?: string;
  billDate?: Date;
  paymentMethod?: string;
} {
  const text = rawText.toUpperCase();
  const result: any = {};

  // Extract price per gallon (e.g., "$3.459/GAL", "PRICE/GAL 3.459", "3.459 $/G")
  const pricePatterns = [
    /\$?\s*(\d+\.\d{2,3})\s*\/?\s*GAL/i,
    /PRICE\s*\/?\s*GAL\w*\s*:?\s*\$?\s*(\d+\.\d{2,3})/i,
    /UNIT\s*PRICE\s*:?\s*\$?\s*(\d+\.\d{2,3})/i,
    /(\d+\.\d{3})\s*(?:USD|DOLLARS?)?\s*(?:PER|\/)\s*GAL/i,
  ];

  for (const pattern of pricePatterns) {
    const match = rawText.match(pattern);
    if (match) {
      result.pricePerGallon = parseFloat(match[1]);
      break;
    }
  }

  // Extract total gallons (e.g., "12.345 GAL", "GALLONS: 12.345")
  const gallonPatterns = [
    /(\d+\.\d{1,3})\s*GAL(?:LON)?S?(?!\s*\/)/i,
    /GAL(?:LON)?S?\s*:?\s*(\d+\.\d{1,3})/i,
    /VOLUME\s*:?\s*(\d+\.\d{1,3})/i,
  ];

  for (const pattern of gallonPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      result.totalGallons = parseFloat(match[1]);
      break;
    }
  }

  // Extract total amount (e.g., "TOTAL $45.67", "SALE $45.67", "FUEL SALE 45.67")
  const totalPatterns = [
    /TOTAL\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /SALE\s*(?:TOTAL)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /AMOUNT\s*(?:DUE)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /FUEL\s*SALE\s*:?\s*\$?\s*(\d+\.\d{2})/i,
  ];

  for (const pattern of totalPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      result.totalAmount = parseFloat(match[1]);
      break;
    }
  }

  // Extract fuel type
  if (/PREMIUM|SUPER|V[- ]?POWER|93/i.test(text)) {
    result.fuelType = 'premium';
  } else if (/MID\s*GRADE|PLUS|MID|89/i.test(text)) {
    result.fuelType = 'midgrade';
  } else if (/DIESEL|DSL/i.test(text)) {
    result.fuelType = 'diesel';
  } else if (/REGULAR|UNLEADED|UNL|87/i.test(text)) {
    result.fuelType = 'regular';
  }

  // Extract station name (first line is often the station name)
  const lines = rawText.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    if (firstLine.length >= 3 && firstLine.length <= 50 && !/\d{2}\/\d{2}/.test(firstLine)) {
      result.stationName = firstLine;
    }
  }

  // Extract date (MM/DD/YYYY, MM-DD-YYYY, etc.)
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
  ];

  for (const pattern of datePatterns) {
    const match = rawText.match(pattern);
    if (match) {
      let year = parseInt(match[3]);
      if (year < 100) year += 2000;
      const date = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
      if (!isNaN(date.getTime()) && date <= new Date()) {
        result.billDate = date;
        break;
      }
    }
  }

  // Extract payment method
  if (/VISA/i.test(text)) result.paymentMethod = 'VISA';
  else if (/MASTER\s*CARD|MC/i.test(text)) result.paymentMethod = 'MasterCard';
  else if (/AMEX|AMERICAN\s*EXPRESS/i.test(text)) result.paymentMethod = 'Amex';
  else if (/DEBIT/i.test(text)) result.paymentMethod = 'Debit';
  else if (/CASH/i.test(text)) result.paymentMethod = 'Cash';
  else if (/APPLE\s*PAY/i.test(text)) result.paymentMethod = 'Apple Pay';
  else if (/GOOGLE\s*PAY/i.test(text)) result.paymentMethod = 'Google Pay';

  return result;
}
