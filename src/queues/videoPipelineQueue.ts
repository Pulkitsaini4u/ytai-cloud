import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ── Upstash Redis connection (TLS required) ───────────────
export const redisConnection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
  lazyConnect: true,
});

redisConnection.on('connect', () => logger.info('✅ Upstash Redis connected'));
redisConnection.on('error', (err) => logger.error('Redis error', { message: err.message }));

const defaultOpts: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
};

// ── Queues ────────────────────────────────────────────────
export const topicQueue    = new Queue('topic',    defaultOpts);
export const scriptQueue   = new Queue('script',   defaultOpts);
export const voiceQueue    = new Queue('voice',    defaultOpts);
export const visualQueue   = new Queue('visual',   defaultOpts);
export const subtitleQueue = new Queue('subtitle', defaultOpts);
export const videoQueue    = new Queue('video',    defaultOpts);
export const thumbnailQueue = new Queue('thumbnail', defaultOpts);
export const seoQueue      = new Queue('seo',      defaultOpts);
export const uploadQueue   = new Queue('upload',   defaultOpts);

export const allQueues = { topic: topicQueue, script: scriptQueue, voice: voiceQueue, visual: visualQueue, subtitle: subtitleQueue, video: videoQueue, thumbnail: thumbnailQueue, seo: seoQueue, upload: uploadQueue };

// ── Job payload types ─────────────────────────────────────
export interface TopicJobData { channelId: string }
export interface ScriptJobData { videoId: string; topicId: string; topicTitle: string; channelId: string; isShort?: boolean }
export interface VoiceJobData { videoId: string; scriptText: string; channelId: string }
export interface VisualJobData { videoId: string; topicTitle: string; scriptSections: any[]; channelId: string }
export interface SubtitleJobData { videoId: string; voiceKey: string; scriptText: string; estimatedDuration: number; channelId: string }
export interface VideoAssemblyJobData { videoId: string; voiceKey: string; visualKeys: string[]; subtitleKey: string; channelId: string; isShort?: boolean }
export interface ThumbnailJobData { videoId: string; title: string; coverKey?: string; channelId: string }
export interface SEOJobData { videoId: string; topicTitle: string; scriptExcerpt: string; channelId: string }
export interface UploadJobData { videoId: string; videoKey: string; thumbnailKey: string; channelId: string; scheduledPublishAt?: string }

// ── Trigger helpers ───────────────────────────────────────
export const triggerTopicDiscovery = (channelId = 'default') => topicQueue.add('discover', { channelId });
export const triggerScriptGen = (d: ScriptJobData) => scriptQueue.add('script', d);
export const triggerVoiceGen = (d: VoiceJobData) => voiceQueue.add('voice', d);
export const triggerVisualCollection = (d: VisualJobData) => visualQueue.add('visual', d);
export const triggerSubtitleGen = (d: SubtitleJobData) => subtitleQueue.add('subtitle', d);
export const triggerVideoAssembly = (d: VideoAssemblyJobData) => videoQueue.add('video', d);
export const triggerThumbnailGen = (d: ThumbnailJobData) => thumbnailQueue.add('thumbnail', d);
export const triggerSEOGen = (d: SEOJobData) => seoQueue.add('seo', d);
export const triggerUpload = (d: UploadJobData) => uploadQueue.add('upload', d, { priority: 1 });

// ── Queue stats ───────────────────────────────────────────
export async function getQueueStatuses() {
  const out: Record<string, object> = {};
  for (const [name, q] of Object.entries(allQueues)) {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        q.getWaitingCount(), q.getActiveCount(), q.getCompletedCount(), q.getFailedCount(),
      ]);
      out[name] = { waiting, active, completed, failed };
    } catch { out[name] = { error: 'unavailable' }; }
  }
  return out;
}
