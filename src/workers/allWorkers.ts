import { Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { redisConnection, triggerScriptGen, triggerVoiceGen, triggerVisualCollection, triggerSubtitleGen, triggerVideoAssembly, triggerThumbnailGen, triggerSEOGen, triggerUpload } from '../queues/videoPipelineQueue';
import { fetchTrendingTopics, getPendingTopics } from '../services/topicService';
import { generateScript, generateShortsScript } from '../services/scriptService';
import { generateVoice } from '../services/voiceService';
import { collectVisuals, collectCoverImage } from '../services/visualService';
import { generateSubtitles } from '../services/subtitleService';
import { assembleVideo } from '../services/videoService';
import { generateThumbnail } from '../services/thumbnailService';
import { generateSEOMetadata } from '../services/seoService';
import { uploadToYouTube } from '../youtube/uploaderService';
import { Video, Topic } from '../config/database';
import { logger } from '../utils/logger';
import { config } from '../config/env';

const workerOpts = { connection: redisConnection };

// ── Coordination state via Redis ──────────────────────────
async function saveCoordState(key: string, data: any) {
  await redisConnection.setex(`coord:${key}`, 3600, JSON.stringify(data));
}
async function loadCoordState(key: string): Promise<any> {
  const raw = await redisConnection.get(`coord:${key}`);
  return raw ? JSON.parse(raw) : {};
}
async function clearCoordState(key: string) {
  await redisConnection.del(`coord:${key}`);
}

const updateVideo = (id: string, data: any) => Video.findOneAndUpdate({ _id: id }, data);

// ── 1. TOPIC WORKER ───────────────────────────────────────
export function createTopicWorker() {
  return new Worker('topic', async (job: Job) => {
    const { channelId = 'default' } = job.data;
    logger.info(`[TopicWorker] Fetching topics for channel: ${channelId}`);

    await fetchTrendingTopics(channelId);
    const pending = await getPendingTopics(channelId, config.pipeline.maxVideosPerDay);

    for (const topic of pending) {
      const videoId = uuidv4();
      await Video.create({ _id: videoId, topicId: topic._id, channelId, status: 'pending', pipeline: 'script' });
      await Topic.findByIdAndUpdate(topic._id, { status: 'processing' });
      await triggerScriptGen({ videoId, topicId: topic.id, topicTitle: topic.title, channelId });
      logger.info(`[TopicWorker] Queued: "${topic.title}" → ${videoId}`);
    }

    return { queued: pending.length };
  }, { ...workerOpts, concurrency: 1 });
}

// ── 2. SCRIPT WORKER ──────────────────────────────────────
export function createScriptWorker() {
  return new Worker('script', async (job: Job) => {
    const { videoId, topicId, topicTitle, channelId, isShort } = job.data;
    logger.info(`[ScriptWorker] Generating script for: "${topicTitle}"`);

    await updateVideo(videoId, { status: 'script_generating' });

    const topic = await Topic.findById(topicId);
    if (!topic) throw new Error(`Topic not found: ${topicId}`);

    const script = isShort
      ? await generateShortsScript(topic)
      : await generateScript(topic, videoId);

    const scriptText = typeof script === 'string' ? script : script.fullText;
    const sections   = typeof script === 'string' ? [] : script.sections;
    const duration   = typeof script === 'string' ? 60  : script.estimatedDuration;

    await updateVideo(videoId, { status: 'script_done', scriptContent: scriptText.slice(0, 5000) });

    await triggerVoiceGen({ videoId, scriptText, channelId });
    await triggerVisualCollection({ videoId, topicTitle, scriptSections: sections.length ? sections : [{ content: scriptText, type: 'body', estimatedSeconds: duration }], channelId });

    return { videoId };
  }, { ...workerOpts, concurrency: 2 });
}

// ── 3. VOICE WORKER ───────────────────────────────────────
export function createVoiceWorker() {
  return new Worker('voice', async (job: Job) => {
    const { videoId, scriptText, channelId } = job.data;
    logger.info(`[VoiceWorker] Generating voice for: ${videoId}`);

    await updateVideo(videoId, { status: 'voice_generating' });

    const { key, url } = await generateVoice(scriptText, videoId);

    await updateVideo(videoId, { status: 'voice_done', voiceKey: key, voiceUrl: url });

    // Notify coordinator: voice done
    const state = await loadCoordState(`assembly:${videoId}`);
    state.voiceKey = key;
    await saveCoordState(`assembly:${videoId}`, state);

    // Trigger subtitles
    await triggerSubtitleGen({
      videoId,
      voiceKey: key,
      scriptText,
      estimatedDuration: scriptText.split(/\s+/).length / 2.5,
      channelId,
    });

    return { videoId, voiceKey: key };
  }, { ...workerOpts, concurrency: 1 }); // TTS is sequential
}

// ── 4. VISUAL WORKER ──────────────────────────────────────
export function createVisualWorker() {
  return new Worker('visual', async (job: Job) => {
    const { videoId, topicTitle, scriptSections, channelId } = job.data;
    logger.info(`[VisualWorker] Collecting visuals for: ${videoId}`);

    await updateVideo(videoId, { status: 'visuals_collecting' });

    const [visualKeys, coverKey] = await Promise.all([
      collectVisuals(scriptSections, topicTitle, videoId),
      collectCoverImage(topicTitle, videoId),
    ]);

    await updateVideo(videoId, { status: 'visuals_done', visualKeys });

    // Notify assembly coordinator
    const state = await loadCoordState(`assembly:${videoId}`);
    state.visualKeys = visualKeys;
    state.coverKey = coverKey;
    state.channelId = channelId;
    state.topicTitle = topicTitle;
    await saveCoordState(`assembly:${videoId}`, state);
    await checkAndTriggerAssembly(videoId, state);

    return { videoId, count: visualKeys.length };
  }, { ...workerOpts, concurrency: 2 });
}

// ── 5. SUBTITLE WORKER ────────────────────────────────────
export function createSubtitleWorker() {
  return new Worker('subtitle', async (job: Job) => {
    const { videoId, voiceKey, scriptText, estimatedDuration, channelId } = job.data;
    logger.info(`[SubtitleWorker] Generating subtitles for: ${videoId}`);

    const subtitleKey = await generateSubtitles(voiceKey, scriptText, videoId, estimatedDuration);
    await updateVideo(videoId, { status: 'subtitles_done', subtitleUrl: subtitleKey });

    // Notify assembly coordinator
    const state = await loadCoordState(`assembly:${videoId}`);
    state.subtitleKey = subtitleKey;
    state.channelId = channelId;
    await saveCoordState(`assembly:${videoId}`, state);
    await checkAndTriggerAssembly(videoId, state);

    return { videoId, subtitleKey };
  }, { ...workerOpts, concurrency: 2 });
}

// ── Assembly coordinator ──────────────────────────────────
async function checkAndTriggerAssembly(videoId: string, state: any) {
  if (!state.visualKeys?.length || !state.voiceKey || !state.subtitleKey) return;

  const video = await Video.findOne({ _id: videoId });
  if (!video || ['video_assembling','video_done','uploading','uploaded'].includes(video.status)) return;

  await updateVideo(videoId, { status: 'video_assembling' });
  await triggerVideoAssembly({
    videoId,
    voiceKey: state.voiceKey,
    visualKeys: state.visualKeys,
    subtitleKey: state.subtitleKey,
    channelId: state.channelId,
  });
  await clearCoordState(`assembly:${videoId}`);
}

// ── 6. VIDEO ASSEMBLY WORKER ──────────────────────────────
export function createVideoWorker() {
  return new Worker('video', async (job: Job) => {
    const { videoId, voiceKey, visualKeys, subtitleKey, channelId, isShort } = job.data;
    logger.info(`[VideoWorker] Assembling video: ${videoId}`);

    const { key, url, duration } = await assembleVideo(videoId, voiceKey, visualKeys, subtitleKey, isShort);
    await updateVideo(videoId, { status: 'video_done', videoKey: key, videoUrl: url, duration });

    const video = await Video.findOne({ _id: videoId }).populate('topicId');
    const topicTitle = (video?.topicId as any)?.title ?? video?.title ?? 'Video';
    const coverKey = await loadCoordState(`upload:${videoId}`).then(s => s.coverKey).catch(() => undefined);

    // Trigger thumbnail + SEO in parallel
    await Promise.all([
      triggerThumbnailGen({ videoId, title: topicTitle, coverKey, channelId }),
      triggerSEOGen({ videoId, topicTitle, scriptExcerpt: video?.scriptContent ?? topicTitle, channelId }),
    ]);

    return { videoId, videoKey: key, duration };
  }, { ...workerOpts, concurrency: 1 }); // FFmpeg is CPU-heavy
}

// ── 7. THUMBNAIL WORKER ───────────────────────────────────
export function createThumbnailWorker() {
  return new Worker('thumbnail', async (job: Job) => {
    const { videoId, title, coverKey, channelId } = job.data;
    logger.info(`[ThumbnailWorker] Generating thumbnail for: ${videoId}`);

    const { key, url } = await generateThumbnail(title, videoId, coverKey);
    await updateVideo(videoId, { status: 'thumbnail_done', thumbnailUrl: url });

    // Notify upload coordinator
    const state = await loadCoordState(`upload:${videoId}`);
    state.thumbnailKey = key;
    state.channelId = channelId;
    await saveCoordState(`upload:${videoId}`, state);
    await checkAndTriggerUpload(videoId, state);

    return { videoId, thumbnailKey: key };
  }, { ...workerOpts, concurrency: 2 });
}

// ── 8. SEO WORKER ─────────────────────────────────────────
export function createSEOWorker() {
  return new Worker('seo', async (job: Job) => {
    const { videoId, topicTitle, scriptExcerpt, channelId } = job.data;
    logger.info(`[SEOWorker] Generating SEO for: ${videoId}`);

    const metadata = await generateSEOMetadata(topicTitle, scriptExcerpt, videoId);
    await updateVideo(videoId, { status: 'seo_done', title: metadata.title, description: metadata.description, tags: metadata.tags });

    // Notify upload coordinator
    const state = await loadCoordState(`upload:${videoId}`);
    state.metadata = metadata;
    state.channelId = channelId;
    await saveCoordState(`upload:${videoId}`, state);
    await checkAndTriggerUpload(videoId, state);

    return { videoId, title: metadata.title };
  }, { ...workerOpts, concurrency: 3 });
}

// ── Upload coordinator ────────────────────────────────────
async function checkAndTriggerUpload(videoId: string, state: any) {
  if (!state.thumbnailKey || !state.metadata) return;

  const video = await Video.findOne({ _id: videoId });
  if (!video?.videoKey || ['uploading','uploaded'].includes(video.status)) return;

  // Schedule for 10 AM next day UTC
  const scheduled = new Date();
  scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  scheduled.setUTCHours(10, 0, 0, 0);

  await triggerUpload({
    videoId,
    videoKey: video.videoKey,
    thumbnailKey: state.thumbnailKey,
    channelId: state.channelId,
    scheduledPublishAt: scheduled.toISOString(),
  });

  await clearCoordState(`upload:${videoId}`);
}

// ── 9. UPLOAD WORKER ──────────────────────────────────────
export function createUploadWorker() {
  return new Worker('upload', async (job: Job) => {
    const { videoId, videoKey, thumbnailKey, channelId, scheduledPublishAt } = job.data;
    logger.info(`[UploadWorker] Uploading to YouTube: ${videoId}`);

    await updateVideo(videoId, { status: 'uploading' });

    // Load metadata from DB
    const video = await Video.findOne({ _id: videoId });
    if (!video) throw new Error(`Video not found: ${videoId}`);

    const metadata = {
      title: video.title ?? 'Untitled',
      description: video.description ?? '',
      tags: video.tags ?? [],
      hashtags: [],
      categoryId: 28,
      language: 'en',
    };

    const scheduledDate = scheduledPublishAt ? new Date(scheduledPublishAt) : null;
    const { videoId: ytId, url } = await uploadToYouTube(videoKey, thumbnailKey, metadata, scheduledDate, channelId);

    await updateVideo(videoId, { status: 'uploaded', pipeline: 'complete', youtubeVideoId: ytId, youtubeUrl: url });

    logger.info(`✅ [UploadWorker] Live: ${url}`);
    return { videoId, ytId, url };
  }, { ...workerOpts, concurrency: 1, limiter: { max: 2, duration: 60_000 } });
}

// ── Error handlers ────────────────────────────────────────
export function attachErrorHandlers(workers: ReturnType<typeof Worker>[]) {
  for (const w of workers) {
    w.on('failed', async (job, err) => {
      logger.error(`[${w.name}] Job failed`, { jobId: job?.id, error: err.message });
      if (job?.data?.videoId) {
        await Video.findOneAndUpdate(
          { _id: job.data.videoId },
          { status: 'failed', $push: { errorLog: `${w.name}: ${err.message}` }, $inc: { retryCount: 1 } }
        );
      }
    });
  }
}
