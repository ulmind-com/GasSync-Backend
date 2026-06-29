// ============================================================
// GasSync Backend - Admin Audit Log Model
// ============================================================
// Purely additive collection. Records actions taken through the
// new admin-panel endpoints. Nothing in the existing flow depends
// on this model, so it can never break existing logic.
// ============================================================

import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IAdminAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  actor: mongoose.Types.ObjectId; // admin user who performed the action
  actorName?: string;
  action: string; // e.g. 'bill.delete', 'station.toggle', 'post.verify'
  targetType?: string; // e.g. 'Bill', 'GasStation', 'GasPrice'
  targetId?: string;
  meta?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const adminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorName: {
      type: String,
      default: null,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      default: null,
    },
    targetId: {
      type: String,
      default: null,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

adminAuditLogSchema.index({ createdAt: -1 });

const AdminAuditLog: Model<IAdminAuditLog> = mongoose.model<IAdminAuditLog>(
  'AdminAuditLog',
  adminAuditLogSchema
);

export default AdminAuditLog;
