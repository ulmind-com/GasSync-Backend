// ============================================================
// GasSync Backend - Bill Routes
// ============================================================

import { Router } from 'express';
import { body } from 'express-validator';
import { BillController } from '../controllers/bill.controller';
import { authenticate } from '../middleware/auth';
import { uploadBillImage } from '../middleware/upload';
import { validate } from '../middleware/validate';

const router = Router();

// All bill routes require authentication
router.use(authenticate);

// Validation
const updateBillValidation = [
  body('fuelType')
    .optional()
    .isIn(['regular', 'midgrade', 'premium', 'diesel', 'e85', 'unl88'])
    .withMessage('Invalid fuel type'),
  body('pricePerGallon')
    .optional()
    .isFloat({ min: 0.01, max: 20 })
    .withMessage('Price must be between $0.01 and $20.00'),
  body('totalGallons')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Gallons must be positive'),
  body('totalAmount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be positive'),
];

const ocrValidation = [
  body('ocrRawText').notEmpty().withMessage('OCR raw text is required'),
  body('ocrConfidence')
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage('Confidence must be between 0 and 1'),
];

// Routes
router.get('/stats', BillController.getBillStats);
router.get('/', BillController.getUserBills);
router.get('/:id', BillController.getBillById);
router.post('/', uploadBillImage, BillController.uploadBill);
router.put('/:id', validate(updateBillValidation), BillController.updateBill);
router.delete('/:id', BillController.deleteBill);
router.post('/:id/process-ocr', validate(ocrValidation), BillController.processOCR);

export default router;
