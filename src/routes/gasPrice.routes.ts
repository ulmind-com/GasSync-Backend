// ============================================================
// GasSync Backend - Gas Price Routes
// ============================================================

import { Router } from 'express';
import { body } from 'express-validator';
import { GasPriceController } from '../controllers/gasPrice.controller';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// Validation
const reportPriceValidation = [
  body('stationId').isMongoId().withMessage('Valid station ID is required'),
  body('fuelType')
    .isIn(['regular', 'midgrade', 'premium', 'diesel', 'e85', 'unl88'])
    .withMessage('Invalid fuel type'),
  body('price')
    .isFloat({ min: 0.01, max: 20 })
    .withMessage('Price must be between $0.01 and $20.00'),
];

// Public routes
router.get('/latest', GasPriceController.getLatestPrices);
router.get('/history', GasPriceController.getPriceHistory);
router.get('/compare', GasPriceController.comparePrices);
router.get('/national-average', GasPriceController.getNationalAverage);
router.get('/by-place/:googlePlaceId', GasPriceController.getStationPricesByPlaceId);
router.get('/station/:stationId', GasPriceController.getStationPrices);
router.get('/community/recent', GasPriceController.getCommunityRecent);
router.post('/community/by-places', GasPriceController.getCommunityPricesByPlaceIds);

// Protected routes
router.post('/', authenticate, validate(reportPriceValidation), GasPriceController.reportPrice);

export default router;
