import { Request, Response, NextFunction } from 'express';
import Feedback from '../models/Feedback';
import { ApiResponseHelper } from '../utils/apiResponse';

export class FeedbackController {
  /**
   * @swagger
   * /api/v1/user/feedback:
   *   post:
   *     summary: Submit user feedback
   *     tags: [User]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - subject
   *               - message
   *             properties:
   *               email:
   *                 type: string
   *               subject:
   *                 type: string
   *               message:
   *                 type: string
   *               category:
   *                 type: string
   *                 enum: [bug, feature, general]
   *     responses:
   *       201:
   *         description: Feedback submitted successfully
   */
  static async submitFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, subject, message, category } = req.body;
      const userId = req.userId || null; // Optional if logged in

      const feedback = new Feedback({
        userId,
        email,
        subject,
        message,
        category: category || 'general',
      });

      await feedback.save();

      ApiResponseHelper.created(res, { feedback }, 'Feedback submitted successfully');
    } catch (error) {
      next(error);
    }
  }
}
