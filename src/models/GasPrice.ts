// ============================================================
// GasSync Backend - Gas Price Model
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';

export type FuelType = 'regular' | 'midgrade' | 'premium' | 'diesel' | 'e85' | 'unl88';
export type PriceSource = 'api_eia' | 'api_collect' | 'user_bill' | 'user_report' | 'admin';

export interface IGasPrice extends Document {
  _id: mongoose.Types.ObjectId;
  station?: mongoose.Types.ObjectId;
  fuelType: FuelType;
  price: number;
  currency: string;
  source: PriceSource;
  region?: string; // state code for EIA data
  city?: string;
  state?: string;
  zipCode?: string;
  // Denormalized location info (mainly for community posts from bills, which
  // often have no linked GasStation but DO carry a name / place / GPS point).
  stationName?: string;
  stationAddress?: string;
  googlePlaceId?: string;
  location?: {
    type: string;
    coordinates: number[]; // [longitude, latitude]
  };
  reportedBy?: mongoose.Types.ObjectId; // user who reported
  recordedAt: Date;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const gasPriceSchema = new Schema<IGasPrice>(
  {
    station: {
      type: Schema.Types.ObjectId,
      ref: 'GasStation',
      default: null,
      index: true,
    },
    fuelType: {
      type: String,
      enum: ['regular', 'midgrade', 'premium', 'diesel', 'e85', 'unl88'],
      required: [true, 'Fuel type is required'],
      index: true,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      max: [20, 'Price seems unrealistically high'],
    },
    currency: {
      type: String,
      default: 'USD',
    },
    source: {
      type: String,
      enum: ['api_eia', 'api_collect', 'user_bill', 'user_report', 'admin'],
      required: [true, 'Price source is required'],
      index: true,
    },
    region: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 2,
      index: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    stationName: {
      type: String,
      trim: true,
      default: null,
    },
    stationAddress: {
      type: String,
      trim: true,
      default: null,
    },
    googlePlaceId: {
      type: String,
      default: null,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: undefined,
      },
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    recordedAt: {
      type: Date,
      required: [true, 'Recorded date is required'],
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes for efficient queries
gasPriceSchema.index({ station: 1, fuelType: 1, recordedAt: -1 });
gasPriceSchema.index({ fuelType: 1, recordedAt: -1 });
gasPriceSchema.index({ state: 1, fuelType: 1, recordedAt: -1 });
gasPriceSchema.index({ region: 1, fuelType: 1, recordedAt: -1 });
gasPriceSchema.index({ source: 1, recordedAt: -1 });
gasPriceSchema.index({ location: '2dsphere' });

// A GeoJSON Point is only valid with a [lng, lat] coordinates array. Strip any
// incomplete location so the doc is simply left out of the geo index instead
// of failing to save ("Point must be an array or object").
gasPriceSchema.pre('save', function () {
  const loc = this.location;
  if (!loc || !Array.isArray(loc.coordinates) || loc.coordinates.length !== 2) {
    this.location = undefined;
  }
});

// TTL index — auto-delete prices older than 1 year (optional, can be adjusted)
// gasPriceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

const GasPrice: Model<IGasPrice> = mongoose.model<IGasPrice>('GasPrice', gasPriceSchema);
export default GasPrice;
