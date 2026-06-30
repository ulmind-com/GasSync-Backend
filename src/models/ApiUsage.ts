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

const todayKey = () => `google-fuel:${new Date().toISOString().slice(0, 10)}`;

/** True if we still have budget today — does NOT consume. Consume only after a
 *  successful (billable) Google call via incrementGoogleQuota(). */
export async function peekGoogleQuota(): Promise<boolean> {
  const doc = await ApiUsage.findOne({ key: todayKey() }).lean();
  return (doc?.count || 0) < DAILY_GOOGLE_PRICE_CAP;
}

/** Record one successful paid Google call against today's budget. */
export async function incrementGoogleQuota(): Promise<void> {
  await ApiUsage.findOneAndUpdate(
    { key: todayKey() },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

export default ApiUsage;
