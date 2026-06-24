// ============================================================
// GasSync Backend - User Bill Model
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';
import { FuelType } from './GasPrice';

export type BillStatus = 'uploading' | 'processing' | 'extracted' | 'verified' | 'failed';

export interface IBill extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  station?: mongoose.Types.ObjectId;
  imageUrl: string;
  thumbnailUrl?: string;
  googlePlaceId?: string;

  // Extracted data from OCR
  stationName?: string;
  stationAddress?: string;
  fuelType?: FuelType;
  pricePerGallon?: number;
  totalGallons?: number;
  totalAmount?: number;
  billDate?: Date;
  paymentMethod?: string;

  // OCR metadata
  ocrRawText?: string;
  ocrConfidence?: number; // 0.0 to 1.0
  ocrProvider?: string;

  // Processing status
  status: BillStatus;
  processingError?: string;

  // User corrections
  userCorrected: boolean;
  correctedFields?: string[];

  // Notes
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const billSchema = new Schema<IBill>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    station: {
      type: Schema.Types.ObjectId,
      ref: 'GasStation',
      default: null,
    },
    googlePlaceId: {
      type: String,
      default: null,
      index: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'Bill image URL is required'],
    },
    thumbnailUrl: {
      type: String,
      default: null,
    },

    // Extracted data
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
    fuelType: {
      type: String,
      enum: ['regular', 'midgrade', 'premium', 'diesel', 'e85', 'unl88'],
      default: null,
    },
    pricePerGallon: {
      type: Number,
      min: 0,
      max: 20,
      default: null,
    },
    totalGallons: {
      type: Number,
      min: 0,
      default: null,
    },
    totalAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    billDate: {
      type: Date,
      default: null,
      index: true,
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: null,
    },

    // OCR metadata
    ocrRawText: {
      type: String,
      default: null,
    },
    ocrConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },
    ocrProvider: {
      type: String,
      default: 'ml_kit',
    },

    // Status
    status: {
      type: String,
      enum: ['uploading', 'processing', 'extracted', 'verified', 'failed'],
      default: 'uploading',
      index: true,
    },
    processingError: {
      type: String,
      default: null,
    },

    // User corrections
    userCorrected: {
      type: Boolean,
      default: false,
    },
    correctedFields: {
      type: [String],
      default: [],
    },

    notes: {
      type: String,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
billSchema.index({ user: 1, createdAt: -1 });
billSchema.index({ user: 1, billDate: -1 });
billSchema.index({ user: 1, status: 1 });
billSchema.index({ station: 1, billDate: -1 });

const Bill: Model<IBill> = mongoose.model<IBill>('Bill', billSchema);
export default Bill;
