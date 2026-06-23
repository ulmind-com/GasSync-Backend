// ============================================================
// GasSync Backend - Gas Station Routes
// ============================================================

import { Router } from 'express';
import { body, query } from 'express-validator';
import { GasStationController } from '../controllers/gasStation.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// Validation rules
const createStationValidation = [
  body('name').trim().notEmpty().withMessage('Station name is required'),
  body('brand').trim().notEmpty().withMessage('Brand is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state')
    .trim()
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .withMessage('State must be a 2-letter code'),
  body('zipCode')
    .matches(/^\d{5}(-\d{4})?$/)
    .withMessage('Invalid US ZIP code'),
  body('location.coordinates')
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be [longitude, latitude]'),
];

const nearbyValidation = [
  query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
];

// Public routes
router.get('/search', GasStationController.searchStations);
router.get('/nearby', validate(nearbyValidation), GasStationController.getNearbyStations);
router.get('/', GasStationController.getStations);
router.get('/:id', GasStationController.getStationById);

// Admin routes
router.post('/', authenticate, authorize('admin'), validate(createStationValidation), GasStationController.createStation);
router.put('/:id', authenticate, authorize('admin'), GasStationController.updateStation);
router.delete('/:id', authenticate, authorize('admin'), GasStationController.deleteStation);

export default router;
