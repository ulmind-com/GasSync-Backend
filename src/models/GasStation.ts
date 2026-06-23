// ============================================================
// GasSync Backend - Gas Station Model
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IGasStation extends Document {
  _id: mongoose.Types.ObjectId;
  externalId?: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  amenities: string[];
  operatingHours?: {
    open: string;
    close: string;
    is24Hours: boolean;
  };
  phone?: string;
  isActive: boolean;
  lastPriceUpdate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gasStationSchema = new Schema<IGasStation>(
  {
    externalId: {
      type: String,
      sparse: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Station name is required'],
      trim: true,
      index: true,
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
      trim: true,
      index: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      index: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      uppercase: true,
      maxlength: 2,
      index: true,
    },
    zipCode: {
      type: String,
      required: [true, 'ZIP code is required'],
      trim: true,
      match: [/^\d{5}(-\d{4})?$/, 'Please enter a valid US ZIP code'],
      index: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true,
      },
      coordinates: {
        type: [Number],
        required: [true, 'Coordinates are required'],
        validate: {
          validator: function (coords: number[]) {
            return (
              coords.length === 2 &&
              coords[0] >= -180 && coords[0] <= 180 && // longitude
              coords[1] >= -90 && coords[1] <= 90 // latitude
            );
          },
          message: 'Invalid coordinates. Format: [longitude, latitude]',
        },
      },
    },
    amenities: {
      type: [String],
      default: [],
    },
    operatingHours: {
      open: { type: String, default: '06:00' },
      close: { type: String, default: '22:00' },
      is24Hours: { type: Boolean, default: false },
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastPriceUpdate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// 2dsphere index for geospatial queries (find nearby stations)
gasStationSchema.index({ location: '2dsphere' });

// Compound indexes for common queries
gasStationSchema.index({ state: 1, city: 1 });
gasStationSchema.index({ zipCode: 1, isActive: 1 });
gasStationSchema.index({ brand: 1, state: 1 });

const GasStation: Model<IGasStation> = mongoose.model<IGasStation>('GasStation', gasStationSchema);
export default GasStation;
