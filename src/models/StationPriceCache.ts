// ============================================================
// GasSync Backend - Station Price Cache Model
// ============================================================
// Caches fuel prices fetched from Google Places API (New)
// TTL: 24 hours — reduces API costs dramatically

import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IFuelPrice {
  type: string;       // e.g., 'REGULAR_UNLEADED', 'MIDGRADE', 'PREMIUM', 'DIESEL'
  price: number;      // e.g., 3.459
  currencyCode: string; // e.g., 'USD'
  updateTime: Date;    // when Google last updated this price
}

export interface IStationPriceCache extends Document {
  _id: mongoose.Types.ObjectId;
  googlePlaceId: string;          // Google Places place_id (e.g., ChIJxyz...)
  stationName: string;
  fuelPrices: IFuelPrice[];
  fetchedAt: Date;                // when we fetched from Google
  expiresAt: Date;                // TTL — auto-delete after 24 hours
  createdAt: Date;
  updatedAt: Date;
}

const fuelPriceSchema = new Schema<IFuelPrice>(
  {
    type: { type: String, required: true },
    price: { type: Number, required: true },
    currencyCode: { type: String, default: 'USD' },
    updateTime: { type: Date, default: null },
  },
  { _id: false }
);

const stationPriceCacheSchema = new Schema<IStationPriceCache>(
  {
    googlePlaceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    stationName: {
      type: String,
      default: '',
    },
    fuelPrices: [fuelPriceSchema],
    fetchedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index — auto-deletes expired docs
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const StationPriceCache: Model<IStationPriceCache> = mongoose.model<IStationPriceCache>(
  'StationPriceCache',
  stationPriceCacheSchema
);
export default StationPriceCache;
