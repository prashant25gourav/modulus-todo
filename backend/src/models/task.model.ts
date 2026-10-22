import { Schema, model, Document, Types } from 'mongoose';

export type TaskPriority = 'low' | 'medium' | 'high';

export interface ITask extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  description?: string;
  scheduledAt: Date;
  deadline: Date;
  priority: TaskPriority;
  completed: boolean;
  completedAt: Date | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: undefined,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    deadline: {
      type: Date,
      required: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.__v;
        ret.id = ret._id ? (ret._id as { toString(): string }).toString() : undefined;
        delete ret._id;

        // Ensure dates format consistently as UTC ISO strings
        if (ret.scheduledAt instanceof Date) ret.scheduledAt = ret.scheduledAt.toISOString();
        if (ret.deadline instanceof Date) ret.deadline = ret.deadline.toISOString();
        if (ret.completedAt instanceof Date) ret.completedAt = ret.completedAt.toISOString();
        if (ret.createdAt instanceof Date) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt instanceof Date) ret.updatedAt = ret.updatedAt.toISOString();

        return ret;
      },
    },
  }
);

// Four compound indexes serving task queries with deterministic _id tie-breaker
taskSchema.index({ userId: 1, createdAt: -1, _id: -1 });
taskSchema.index({ userId: 1, completed: 1, deadline: 1, _id: -1 });
taskSchema.index({ userId: 1, completed: 1, priority: 1, deadline: 1, _id: -1 });
taskSchema.index({ userId: 1, tags: 1, _id: -1 });

export const Task = model<ITask>('Task', taskSchema);
