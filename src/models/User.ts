// ============================================================
// GasSync Backend - User Model
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password: string;
  displayName: string;
  avatarUrl?: string;
  phone?: string;
  preferredFuelType: 'regular' | 'midgrade' | 'premium' | 'diesel';
  defaultZipCode?: string;
  defaultState?: string;
  role: 'user' | 'admin';
  isEmailVerified: boolean;
  resetPasswordOTP?: string;
  resetPasswordExpire?: Date;
  refreshToken?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  favorites: Array<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    address: string;
    rating: number;
    totalRatings: number;
    isOpen: boolean | null;
    photoRef: string | null;
  }>;
  comparePassword(candidatePassword: string): Promise<boolean>;
  toPublicJSON(): Record<string, any>;
}

const favoriteSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    address: { type: String, default: '' },
    rating: { type: Number, default: 0 },
    totalRatings: { type: Number, default: 0 },
    isOpen: { type: Boolean, default: null },
    photoRef: { type: String, default: null },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't include password in queries by default
    },
    displayName: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true,
      minlength: [2, 'Display name must be at least 2 characters'],
      maxlength: [50, 'Display name cannot exceed 50 characters'],
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    preferredFuelType: {
      type: String,
      enum: ['regular', 'midgrade', 'premium', 'diesel'],
      default: 'regular',
    },
    defaultZipCode: {
      type: String,
      trim: true,
      match: [/^\d{5}(-\d{4})?$/, 'Please enter a valid US ZIP code'],
      default: null,
    },
    defaultState: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 2,
      default: null,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    resetPasswordOTP: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },
    refreshToken: {
      type: String,
      select: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    favorites: {
      type: [favoriteSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Return public user data (strip sensitive fields)
userSchema.methods.toPublicJSON = function (): Record<string, any> {
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    phone: this.phone,
    preferredFuelType: this.preferredFuelType,
    defaultZipCode: this.defaultZipCode,
    defaultState: this.defaultState,
    role: this.role,
    isEmailVerified: this.isEmailVerified,
    lastLoginAt: this.lastLoginAt,
    favorites: this.favorites || [],
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// Indexes (email index already created via schema `unique: true`)
userSchema.index({ role: 1 });

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
export default User;
