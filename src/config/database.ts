import mongoose, { Schema, model, Document } from 'mongoose';
import { config } from './env';
import { logger } from '../utils/logger';

export async function connectDatabase() {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('✅ MongoDB Atlas connected');
  } catch (err) {
    logger.error('MongoDB connection failed', err);
    process.exit(1);
  }
}

// ── Interfaces ────────────────────────────────────────────

export interface ITopic extends Document {
  title: string;
  source: string;
  score: number;
  keywords: string[];
  channelId: string;
  status: 'pending' | 'processing' | 'scripted' | 'failed';
  createdAt: Date;
}

export type VideoStatus =
  | 'pending' | 'script_generating' | 'script_done'
  | 'voice_generating' | 'voice_done'
  | 'visuals_collecting' | 'visuals_done'
  | 'subtitles_done' | 'video_assembling' | 'video_done'
  | 'thumbnail_done' | 'seo_done'
  | 'uploading' | 'uploaded' | 'failed';

export interface IVideo extends Document {
  _id: string;
  topicId: mongoose.Types.ObjectId;
  channelId: string;
  title: string;
  description: string;
  tags: string[];
  scriptContent: string;
  // Cloud storage keys/URLs instead of local paths
  scriptUrl: string;
  voiceUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  subtitleUrl: string;
  metadataUrl: string;
  // Storage keys (used to download for processing)
  voiceKey: string;
  videoKey: string;
  visualKeys: string[];
  // YouTube
  youtubeVideoId: string;
  youtubeUrl: string;
  scheduledPublishAt: Date | null;
  duration: number;
  status: VideoStatus;
  pipeline: string;
  retryCount: number;
  errorLog: string[];
  isShort: boolean;
  analytics: { views: number; likes: number; comments: number; lastFetched: Date };
  createdAt: Date;
  updatedAt: Date;
}

// ── Schemas ───────────────────────────────────────────────

const TopicSchema = new Schema<ITopic>({
  title: { type: String, required: true },
  source: { type: String, required: true },
  score: { type: Number, default: 0 },
  keywords: [String],
  channelId: { type: String, default: 'default' },
  status: { type: String, default: 'pending' },
}, { timestamps: true });

const VideoSchema = new Schema<IVideo>({
  _id: { type: String, required: true },
  topicId: { type: Schema.Types.ObjectId, ref: 'Topic' },
  channelId: { type: String, default: 'default' },
  title: String,
  description: String,
  tags: [String],
  scriptContent: String,
  scriptUrl: String,
  voiceUrl: String,
  videoUrl: String,
  thumbnailUrl: String,
  subtitleUrl: String,
  metadataUrl: String,
  voiceKey: String,
  videoKey: String,
  visualKeys: [String],
  youtubeVideoId: String,
  youtubeUrl: String,
  scheduledPublishAt: { type: Date, default: null },
  duration: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  pipeline: { type: String, default: 'script' },
  retryCount: { type: Number, default: 0 },
  errorLog: [String],
  isShort: { type: Boolean, default: false },
  analytics: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    lastFetched: Date,
  },
}, { timestamps: true });

VideoSchema.index({ status: 1 });
VideoSchema.index({ channelId: 1 });
VideoSchema.index({ createdAt: -1 });
TopicSchema.index({ status: 1, createdAt: -1 });

export const Topic = model<ITopic>('Topic', TopicSchema);
export const Video = model<IVideo>('Video', VideoSchema);
