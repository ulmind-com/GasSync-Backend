// ============================================================
// GasSync Backend - Daily API Usage Counter
// ============================================================
// Tracks how many paid Google price lookups we've made today so we can
// hard-stop before exceeding the monthly budget. Google Cloud's own quota
// cap is the real guarantee; this avoids wasting rejected calls and lets us
// fall back to cached data the moment the daily limit is hit.

import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IApiUsage extends Document {
  key: string;   // e.g. "google-fuel:2026-07-01"
  count: number;
  updatedAt: Date;
}

const apiUsageSchema = new Schema<IApiUsage>(
  {
    key: { type: String, required: true, unique: true, index: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

const ApiUsage: Model<IApiUsage> = mongoose.model<IApiUsage>('ApiUsage', apiUsageSchema);

// Max paid Google price lookups per day. Each lookup = 1 Find-Place + 1
// Details call (~$0.04). ~40/day keeps the monthly bill under ~$30.
export const DAILY_GOOGLE_PRICE_CAP = Number(process.env.DAILY_GOOGLE_PRICE_CAP || 40);

/** Returns true and increments if we're still under today's cap, else false. */
export async function tryConsumeGoogleQuota(): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `google-fuel:${day}`;
  // Atomically bump only while under the cap.
  const doc = await ApiUsage.findOneAndUpdate(
    { key, count: { $lt: DAILY_GOOGLE_PRICE_CAP } },
    { $inc: { count: 1 } },
    { new: true, upsert: false }
  );
  if (doc) return true;
  // No doc under cap — either doesn't exist yet or cap reached. Try to create.
  try {
    await ApiUsage.create({ key, count: 1 });
    return true;
  } catch {
    return false; // exists and already at cap
  }
}

export default ApiUsage;
