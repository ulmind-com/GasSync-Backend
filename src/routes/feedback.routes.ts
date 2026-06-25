import { Router } from 'express';
import { body } from 'express-validator';
import { FeedbackController } from '../controllers/feedback.controller';
import { validate } from '../middleware/validate';

const router = Router();

const feedbackValidation = [
  body('subject').notEmpty().withMessage('Subject is required').isLength({ min: 2, max: 100 }).withMessage('Subject must be between 2 and 100 characters'),
  body('message').notEmpty().withMessage('Message is required').isLength({ min: 10, max: 1000 }).withMessage('Message must be between 10 and 1000 characters'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('category').optional().isIn(['bug', 'feature', 'general']).withMessage('Invalid category'),
];

// Public route - anyone can submit feedback (we'll capture userId if they happen to pass an auth token, handled in middleware if needed, but here it's public)
// To optionally get req.userId, we could add an optionalAuth middleware, but for now we'll just allow it publicly and the controller extracts req.userId if available.
router.post('/', validate(feedbackValidation), FeedbackController.submitFeedback);

export default router;
