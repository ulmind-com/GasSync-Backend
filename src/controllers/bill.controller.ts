// ============================================================
// GasSync Backend - Bill Controller
// ============================================================

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
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

      // Cloudinary stores the file and gives us a URL in req.file.path
      const imageUrl = req.file.path || `/uploads/bills/${req.file.filename}`;

      const bill = new Bill({
        user: req.userId,
        imageUrl,
        googlePlaceId: req.body.googlePlaceId || null,
        stationName: req.body.stationName || null,
        fuelType: req.body.fuelType || null,
        notes: req.body.notes || null,
        billDate: new Date(),
        status: 'processing',
      });

      await bill.save();
      logger.info(`Bill uploaded by user ${req.userId}: ${bill._id}`);

      // ─── OCR Pipeline: Send image to OCR.space for text extraction ───
      try {
        const OCR_API_KEY = process.env.OCR_SPACE_API_KEY || 'K81540990988957';
        
        logger.info(`[OCR] Starting OCR for bill ${bill._id} — image: ${imageUrl}`);

        const ocrFormData = new URLSearchParams();
        ocrFormData.append('url', imageUrl);
        ocrFormData.append('OCREngine', '2');        // Engine 2 = best for receipts
        ocrFormData.append('isTable', 'true');        // Better table/receipt parsing
        ocrFormData.append('scale', 'true');           // Upscale for better accuracy
        ocrFormData.append('detectOrientation', 'true');

        const ocrResponse = await axios.post(
          'https://api.ocr.space/parse/image',
          ocrFormData.toString(),
          {
            headers: {
              'apikey': OCR_API_KEY,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 30000,
          }
        );

        const ocrResult = ocrResponse.data;

        if (ocrResult?.ParsedResults && ocrResult.ParsedResults.length > 0 && !ocrResult.IsErroredOnProcessing) {
          const ocrText = ocrResult.ParsedResults[0].ParsedText || '';
          
          logger.info(`[OCR] Raw text extracted (${ocrText.length} chars) for bill ${bill._id}`);

          // Store raw OCR data
          bill.ocrRawText = ocrText;
          bill.ocrConfidence = ocrResult.ParsedResults[0]?.TextOverlay?.confidence || null;
          bill.ocrProvider = 'ocr_space';

          // ─── Parse structured data from raw OCR text ───
          const extracted = extractBillData(ocrText);

          if (extracted.pricePerGallon) bill.pricePerGallon = extracted.pricePerGallon;
          if (extracted.totalGallons) bill.totalGallons = extracted.totalGallons;
          if (extracted.totalAmount) bill.totalAmount = extracted.totalAmount;
          if (extracted.fuelType) bill.fuelType = extracted.fuelType;
          if (extracted.stationName && !bill.stationName) bill.stationName = extracted.stationName;
          if (extracted.billDate) bill.billDate = extracted.billDate;
          if (extracted.paymentMethod) bill.paymentMethod = extracted.paymentMethod;

          // If we got a price, mark as extracted
          if (extracted.pricePerGallon || extracted.totalAmount) {
            bill.status = 'extracted';
            logger.info(`[OCR] ✅ Extraction success for bill ${bill._id}: $${extracted.pricePerGallon}/gal, ${extracted.fuelType}, total: $${extracted.totalAmount}`);
          } else {
            bill.status = 'extracted'; // Still mark as extracted so user can correct
            logger.info(`[OCR] ⚠️ No price found in OCR text for bill ${bill._id}, user can correct manually`);
          }
        } else {
          const errorMsg = ocrResult?.ErrorMessage?.[0] || 'Unknown OCR error';
          logger.warn(`[OCR] ❌ OCR failed for bill ${bill._id}: ${errorMsg}`);
          bill.status = 'extracted'; // Don't block — let user correct
          bill.processingError = `OCR processing failed: ${errorMsg}`;
          bill.ocrProvider = 'ocr_space';
        }

        await bill.save();
      } catch (ocrError: any) {
        // OCR failure should NOT block the bill upload
        logger.error(`[OCR] Exception during OCR for bill ${bill._id}: ${ocrError.message}`);
        bill.status = 'extracted';
        bill.processingError = `OCR exception: ${ocrError.message}`;
        await bill.save();
      }

      // Return complete bill with extracted data
      const completeBill = await Bill.findById(bill._id).populate('user', 'displayName email').lean();

      ApiResponseHelper.created(res, completeBill, 'Bill uploaded and processed.');
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

  // 1. Extract Price per Gallon
  const pricePatterns = [
    // Standard formats
    /\$?\s*(\d+\.\d{2,3})\s*\/?\s*GAL/i,
    /PRICE\s*\/?\s*GAL\w*\s*:?\s*\$?\s*(\d+\.\d{2,3})/i,
    /PRICE\s*\/?\s*G\s*:?\s*\$?\s*(\d+\.\d{2,3})/i,
    /UNIT\s*PRICE\s*:?\s*\$?\s*(\d+\.\d{2,3})/i,
    /(\d+\.\d{3})\s*(?:USD|DOLLARS?)?\s*(?:PER|\/)\s*(?:GAL|G)/i,
    // "10.000G @ 3.199/G" or "10.000 @ 3.199"
    /@\s*\$?\s*(\d+\.\d{2,3})/i,
    // Just "PRICE 3.499"
    /PRICE\s*:?\s*\$?\s*(\d+\.\d{3})/i
  ];

  for (const pattern of pricePatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      if (val > 1.0 && val < 10.0) { // Gas prices are generally $1-$10
        result.pricePerGallon = val;
        break;
      }
    }
  }

  // 2. Extract Total Gallons
  const gallonPatterns = [
    /(\d+\.\d{1,3})\s*GAL(?:LON)?S?(?!\s*\/)/i,
    /GAL(?:LON)?S?\s*:?\s*(\d+\.\d{1,3})/i,
    /VOLUME\s*:?\s*(\d+\.\d{1,3})/i,
    // "10.000G @ 3.199/G"
    /(\d+\.\d{3})\s*G\s*@/i,
    // Just a standalone 3-decimal number that is likely gallons (e.g. 12.345)
    /(?:^|\s)(\d+\.\d{3})(?:\s|$)/m
  ];

  for (const pattern of gallonPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      // Gallons usually between 1 and 100 for passenger vehicles
      if (val > 0.5 && val < 150) {
        // If it perfectly matches the price, skip it (avoid confusing price with gallons if price has 3 decimals)
        if (result.pricePerGallon && Math.abs(val - result.pricePerGallon) < 0.001) continue;
        result.totalGallons = val;
        break;
      }
    }
  }

  // 3. Extract Total Amount
  const totalPatterns = [
    /TOTAL\s*(?:USD)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /SALE\s*(?:TOTAL)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /AMOUNT\s*(?:DUE)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /FUEL\s*SALE\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /CREDIT\s*(?:CARD)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /DEBIT\s*(?:CARD)?\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /VISA\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /MASTERCARD\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /AMEX\s*:?\s*\$?\s*(\d+\.\d{2})/i
  ];

  for (const pattern of totalPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      result.totalAmount = parseFloat(match[1]);
      break;
    }
  }

  // Fallback for Total Amount if not found: find the largest dollar amount at the end
  if (!result.totalAmount) {
    const allMatches = [...rawText.matchAll(/\$?\s*(\d+\.\d{2})(?!\d)/g)];
    const amounts = allMatches.map(m => parseFloat(m[1])).filter(v => v > 1.0);
    if (amounts.length > 0) {
      result.totalAmount = Math.max(...amounts); // Total is usually the highest amount on the receipt
    }
  }

  // 4. Smart Cross-Computation (The "OP" Intelligence)
  if (result.totalAmount && result.pricePerGallon && !result.totalGallons) {
    result.totalGallons = parseFloat((result.totalAmount / result.pricePerGallon).toFixed(3));
  } else if (result.totalAmount && result.totalGallons && !result.pricePerGallon) {
    result.pricePerGallon = parseFloat((result.totalAmount / result.totalGallons).toFixed(3));
  } else if (result.totalGallons && result.pricePerGallon && !result.totalAmount) {
    result.totalAmount = parseFloat((result.totalGallons * result.pricePerGallon).toFixed(2));
  }

  // 5. Extract Fuel Type
  if (/PREMIUM|SUPER|V[- ]?POWER|93|SUPREME/i.test(text)) {
    result.fuelType = 'premium';
  } else if (/MID\s*GRADE|PLUS|MID|89/i.test(text)) {
    result.fuelType = 'midgrade';
  } else if (/DIESEL|DSL|AUTO\s*DSL/i.test(text)) {
    result.fuelType = 'diesel';
  } else if (/REGULAR|UNLEADED|UNL|87|REG|87\s*UNL/i.test(text)) {
    result.fuelType = 'regular';
  }

  // 6. Extract Station Name
  const lines = rawText.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    // Try to find known brands first
    const brands = ['SHELL', 'EXXON', 'MOBIL', 'CHEVRON', 'TEXACO', 'BP', 'ARCO', 'SUNOCO', 'VALERO', 'SPEEDWAY', 'WAWA', 'RACETRAC', 'QUICKTRIP', 'QT', 'MURPHY', 'COSTCO', 'SAMS CLUB', 'KROGER'];
    const brandMatch = brands.find(b => text.includes(b));
    
    if (brandMatch) {
      result.stationName = brandMatch;
    } else {
      const firstLine = lines[0].trim();
      if (firstLine.length >= 3 && firstLine.length <= 50 && !/\d{2}\/\d{2}/.test(firstLine)) {
        result.stationName = firstLine;
      }
    }
  }

  // 7. Extract Date
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

  // 8. Extract Payment Method
  if (/VISA/i.test(text)) result.paymentMethod = 'VISA';
  else if (/MASTER\s*CARD|MC/i.test(text)) result.paymentMethod = 'MasterCard';
  else if (/AMEX|AMERICAN\s*EXPRESS/i.test(text)) result.paymentMethod = 'Amex';
  else if (/DISCOVER/i.test(text)) result.paymentMethod = 'Discover';
  else if (/DEBIT/i.test(text)) result.paymentMethod = 'Debit';
  else if (/CASH/i.test(text)) result.paymentMethod = 'Cash';
  else if (/APPLE\s*PAY/i.test(text)) result.paymentMethod = 'Apple Pay';
  else if (/GOOGLE\s*PAY/i.test(text)) result.paymentMethod = 'Google Pay';

  return result;
}
