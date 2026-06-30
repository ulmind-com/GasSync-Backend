// ============================================================
// GasSync Backend - Notification Cron Jobs
// ============================================================

import cron from 'node-cron';
import User from '../models/User';
import Bill from '../models/Bill';
import { sendPushNotification, sendBulkPushNotifications } from '../utils/pushNotification';
import Notification from '../models/Notification';
import { logger } from '../utils/logger';

/**
 * Inactivity Reminder — Runs daily at 10:00 AM UTC
 * Sends a push notification to users who haven't uploaded a bill in 7+ days.
 */
function scheduleInactivityReminder() {
  cron.schedule('0 10 * * *', async () => {
    logger.info('[Cron] Running inactivity reminder job...');

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Find users who have a push token
      const usersWithTokens = await User.find({
        expoPushToken: { $ne: null, $exists: true },
      }).select('_id expoPushToken displayName');

      if (usersWithTokens.length === 0) {
        logger.info('[Cron] No users with push tokens found.');
        return;
      }

      const payloads: { token: string; title: string; body: string; data: Record<string, any> }[] = [];

      for (const user of usersWithTokens) {
        // Check if this user has uploaded any bill in the last 7 days
        const recentBill = await Bill.findOne({
          user: user._id,
          createdAt: { $gte: sevenDaysAgo },
        }).lean();

        if (!recentBill) {
          const title = '⛽ Miss reporting gas prices?';
          const body = "It's been a week since your last upload. Help the community by sharing prices near you!";
          const data = { type: 'inactivity_reminder' };

          // Save to DB for bell icon
          await Notification.create({ user: user._id, title, body, type: 'inactivity_reminder', data });

          if (user.expoPushToken) {
            payloads.push({ token: user.expoPushToken, title, body, data });
          }
        }
      }

      if (payloads.length > 0) {
        await sendBulkPushNotifications(payloads);
        logger.info(`[Cron] Sent ${payloads.length} inactivity reminders.`);
      } else {
        logger.info('[Cron] No inactive users to remind.');
      }
    } catch (error) {
      logger.error('[Cron] Inactivity reminder job failed:', error);
    }
  });

  logger.info('[Cron] Inactivity reminder scheduled (daily at 10:00 AM UTC)');
}

/**
 * Price Drop Alert — Runs daily at 8:00 AM UTC
 * Checks favorite stations for price drops and notifies users.
 */
function schedulePriceDropAlert() {
  cron.schedule('0 8 * * *', async () => {
    logger.info('[Cron] Running price drop alert job...');

    try {
      // Find users with push tokens AND favorites
      const users = await User.find({
        expoPushToken: { $ne: null, $exists: true },
        'favorites.0': { $exists: true }, // has at least 1 favorite
      }).select('_id expoPushToken favorites displayName');

      if (users.length === 0) {
        logger.info('[Cron] No users with favorites and push tokens.');
        return;
      }

      const payloads: { token: string; title: string; body: string; data: Record<string, any> }[] = [];

      for (const user of users) {
        for (const fav of user.favorites) {
          // Find the 2 most recent community prices for this station
          // fav.id could be an old Google Place ID or a new OSM ID (e.g. node/123)
          const recentBills = await Bill.find({
            $or: [
              { googlePlaceId: fav.id },
              { osmId: fav.id }
            ],
            status: { $in: ['extracted', 'verified'] },
            pricePerGallon: { $ne: null },
          })
            .sort({ billDate: -1 })
            .limit(2)
            .lean();

          if (recentBills.length === 2) {
            const latestPrice = recentBills[0].pricePerGallon!;
            const previousPrice = recentBills[1].pricePerGallon!;
            const drop = previousPrice - latestPrice;

            // Alert if price dropped by at least $0.05
            if (drop >= 0.05) {
              const title = `📉 Price drop at ${fav.name}!`;
              const body = `Gas prices dropped by $${drop.toFixed(2)}/gal to $${latestPrice.toFixed(2)} at ${fav.name}.`;
              const data = { type: 'price_drop', stationId: fav.id, stationName: fav.name };

              // Save to DB for bell icon
              await Notification.create({ user: user._id, title, body, type: 'price_drop', data });

              if (user.expoPushToken) {
                payloads.push({ token: user.expoPushToken, title, body, data });
              }
              break; // Only one notification per user per job run
            }
          }
        }
      }

      if (payloads.length > 0) {
        await sendBulkPushNotifications(payloads);
        logger.info(`[Cron] Sent ${payloads.length} price drop alerts.`);
      } else {
        logger.info('[Cron] No price drops detected for favorites.');
      }
    } catch (error) {
      logger.error('[Cron] Price drop alert job failed:', error);
    }
  });

  logger.info('[Cron] Price drop alert scheduled (daily at 8:00 AM UTC)');
}

/**
 * Initialize all notification cron jobs.
 */
export function initNotificationJobs() {
  scheduleInactivityReminder();
  schedulePriceDropAlert();
  logger.info('[Cron] All notification jobs initialized.');
}
