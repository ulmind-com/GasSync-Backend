// ============================================================
// GasSync Backend - Push Notification Utility (Expo)
// ============================================================

import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

const expo = new Expo();

interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: 'default' | null;
}

/**
 * Send a single push notification to an Expo push token.
 */
export async function sendPushNotification(payload: PushPayload): Promise<ExpoPushTicket | null> {
  const { token, title, body, data = {}, badge, sound = 'default' } = payload;

  if (!Expo.isExpoPushToken(token)) {
    console.warn(`[Push] Invalid Expo push token: ${token}`);
    return null;
  }

  const message: ExpoPushMessage = {
    to: token,
    title,
    body,
    data,
    sound,
    ...(badge !== undefined && { badge }),
  };

  try {
    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket.status === 'error') {
      console.error(`[Push] Error sending to ${token}:`, ticket.message);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        console.warn(`[Push] Token ${token} is no longer registered.`);
      }
    }
    return ticket;
  } catch (error) {
    console.error('[Push] Failed to send notification:', error);
    return null;
  }
}

/**
 * Send push notifications to multiple Expo push tokens.
 */
export async function sendBulkPushNotifications(
  payloads: PushPayload[]
): Promise<ExpoPushTicket[]> {
  const messages: ExpoPushMessage[] = [];

  for (const { token, title, body, data = {}, badge, sound = 'default' } of payloads) {
    if (!Expo.isExpoPushToken(token)) {
      console.warn(`[Push] Skipping invalid token: ${token}`);
      continue;
    }
    messages.push({
      to: token,
      title,
      body,
      data,
      sound,
      ...(badge !== undefined && { badge }),
    });
  }

  if (messages.length === 0) return [];

  // Chunk messages into batches (Expo recommends max ~100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    try {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    } catch (error) {
      console.error('[Push] Error sending chunk:', error);
    }
  }

  return tickets;
}

export { expo };
