import mongoose, { Schema, Model, Types } from 'mongoose'

export interface IYjsDocument {
  boardId: string
  state: Buffer
  stateVector: Buffer | null
  version: number
  lastModifiedBy: Types.ObjectId | null
  connectedClients: number
  createdAt: Date
  updatedAt: Date
}

const yjsDocumentSchema = new Schema<IYjsDocument>(
  {
    boardId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    state: {
      type: Buffer,
      required: true,
    },
    stateVector: {
      type: Buffer,
      default: null,
    },
    version: {
      type: Number,
      default: 1,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    connectedClients: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
)

yjsDocumentSchema.index({ updatedAt: 1 })

const YjsDocument: Model<IYjsDocument> =
  mongoose.models.YjsDocument || mongoose.model<IYjsDocument>('YjsDocument', yjsDocumentSchema)

export default YjsDocument
