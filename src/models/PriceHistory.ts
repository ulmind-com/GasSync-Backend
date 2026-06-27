// ============================================================
// GasSync Backend - Price History Model (Aggregated)
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';
import { FuelType, PriceSource } from './GasPrice';

export interface IPriceHistory extends Document {
  _id: mongoose.Types.ObjectId;
  region: string; // state code (e.g., "CA", "TX") or "US" for national
  fuelType: FuelType;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice?: number;
  sampleSize: number; // number of data points
  source: PriceSource;
  recordedDate: Date;
  weekNumber?: number;
  monthNumber?: number;
  year: number;
  createdAt: Date;
}

const priceHistorySchema = new Schema<IPriceHistory>(
  {
    region: {
      type: String,
      required: [true, 'Region is required'],
      trim: true,
      uppercase: true,
      index: true,
    },
    fuelType: {
      type: String,
      enum: ['regular', 'midgrade', 'premium', 'diesel', 'e85', 'unl88'],
      required: [true, 'Fuel type is required'],
      index: true,
    },
    avgPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    minPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    maxPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    medianPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    sampleSize: {
      type: Number,
      default: 1,
      min: 1,
    },
    source: {
      type: String,
      enum: ['api_eia', 'api_collect', 'user_bill', 'user_report', 'admin'],
      required: true,
      index: true,
    },
    recordedDate: {
      type: Date,
      required: [true, 'Recorded date is required'],
      index: true,
    },
    weekNumber: {
      type: Number,
      min: 1,
      max: 53,
    },
    monthNumber: {
      type: Number,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Unique compound index to prevent duplicate entries
priceHistorySchema.index(
  { region: 1, fuelType: 1, recordedDate: 1, source: 1 },
  { unique: true }
);

// Query optimization indexes
priceHistorySchema.index({ region: 1, fuelType: 1, recordedDate: -1 });
priceHistorySchema.index({ year: 1, monthNumber: 1 });

const PriceHistory: Model<IPriceHistory> = mongoose.model<IPriceHistory>(
  'PriceHistory',
  priceHistorySchema
);
export default PriceHistory;
