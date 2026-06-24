import { Resend } from 'resend';
import { logger } from './logger';

export const sendOTP = async (email: string, otp: string) => {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY is missing. Simulating OTP send in console: ' + otp);
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
  // Default to a generic onboarding address if not set, but the user should set RESEND_SENDER_EMAIL
  const senderEmail = process.env.RESEND_SENDER_EMAIL || 'onboarding@resend.dev';

  try {
    const { data, error } = await resend.emails.send({
      from: `GasSync <${senderEmail}>`,
      to: [email],
      subject: 'Your GasSync Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E5E5EA; border-radius: 12px;">
          <h2 style="color: #34C759; text-align: center;">GasSync</h2>
          <p style="color: #1C1C1E; font-size: 16px;">Hello,</p>
          <p style="color: #1C1C1E; font-size: 16px;">Here is your verification code to continue signing up for GasSync. This code will expire in 5 minutes.</p>
          <div style="background-color: #F2F2F7; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1C1C1E;">${otp}</span>
          </div>
          <p style="color: #8E8E93; font-size: 14px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      throw new Error(error.message);
    }

    logger.info(`OTP sent successfully to ${email} via Resend`);
  } catch (error: any) {
    logger.error('Failed to send OTP email via Resend: ' + error.message);
    throw new Error('Failed to send OTP email');
  }
};
