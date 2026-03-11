import mongoose, { Schema, Model, Types } from 'mongoose'

export interface IAccessEntry {
  userId: Types.ObjectId
  permission: 'view' | 'edit'
}

export interface IBord {
  _id: string
  organizationId: Types.ObjectId | null
  localBoardId: string
  title: string
  ownerId: Types.ObjectId
  contextType: 'personal' | 'organization'
  accessList: IAccessEntry[]
  lastPublishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const AccessEntrySchema = new Schema<IAccessEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: ['view', 'edit'], default: 'view' },
  },
  { _id: false }
)

const BordSchema = new Schema<IBord>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    localBoardId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contextType: {
      type: String,
      enum: ['personal', 'organization'],
      default: 'personal',
    },
    accessList: [AccessEntrySchema],
    lastPublishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

BordSchema.index({ ownerId: 1, localBoardId: 1 }, { unique: true })
BordSchema.index({ organizationId: 1 })

const Bord: Model<IBord> =
  mongoose.models.Bord || mongoose.model<IBord>('Bord', BordSchema)

export default Bord
