import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Video, Topic } from '../config/database';
import {
  triggerTopicDiscovery,
  triggerScriptGen,
  getQueueStatuses,
} from '../queues/videoPipelineQueue';
import { getAuthUrl, exchangeCode } from '../youtube/uploaderService';
import { isGroqHealthy } from '../ai/groqClient';

export async function triggerPipeline(req: Request, res: Response) {
  try {
    const { channelId = 'default' } = req.body;
    await triggerTopicDiscovery(channelId);
    res.json({ success: true, message: 'Pipeline triggered', channelId });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function createVideo(req: Request, res: Response) {
  try {
    const { topicTitle, channelId = 'default', isShort = false } = req.body;
    if (!topicTitle) { res.status(400).json({ error: 'topicTitle is required' }); return; }

    const topic = await Topic.create({
      title: topicTitle, source: 'manual', score: 100,
      keywords: topicTitle.toLowerCase().split(' ').filter((w: string) => w.length > 3),
      channelId,
    });

    const videoId = uuidv4();
    await Video.create({ _id: videoId, topicId: topic._id, channelId, status: 'pending', pipeline: 'script', isShort });

    await triggerScriptGen({ videoId, topicId: topic.id, topicTitle, channelId, isShort });

    res.json({ success: true, videoId, message: `Pipeline started for: "${topicTitle}"` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function listVideos(req: Request, res: Response) {
  try {
    const { page = 1, limit = 20, status, channelId } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (channelId) filter.channelId = channelId;
    const [videos, total] = await Promise.all([
      Video.find(filter).sort({ createdAt: -1 }).skip((+page - 1) * +limit).limit(+limit).populate('topicId', 'title source'),
      Video.countDocuments(filter),
    ]);
    res.json({ videos, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function getVideo(req: Request, res: Response) {
  try {
    const video = await Video.findOne({ _id: req.params.id }).populate('topicId');
    if (!video) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(video);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function getVideoStatus(req: Request, res: Response) {
  try {
    const video = await Video.findOne({ _id: req.params.id }).select('status pipeline retryCount errorLog youtubeUrl');
    if (!video) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(video);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function retryVideo(req: Request, res: Response) {
  try {
    const video = await Video.findOne({ _id: req.params.id });
    if (!video) { res.status(404).json({ error: 'Not found' }); return; }
    const topic = await Topic.findById(video.topicId);
    if (!topic) { res.status(400).json({ error: 'Topic not found' }); return; }
    await Video.findOneAndUpdate({ _id: video._id }, { status: 'pending', errorLog: [] });
    await triggerScriptGen({ videoId: String(video._id), topicId: topic.id, topicTitle: topic.title, channelId: video.channelId });
    res.json({ success: true, message: 'Retry queued' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function getDashboard(req: Request, res: Response) {
  try {
    const [total, uploaded, failed, inProgress, queues, groqOk] = await Promise.all([
      Video.countDocuments(),
      Video.countDocuments({ status: 'uploaded' }),
      Video.countDocuments({ status: 'failed' }),
      Video.countDocuments({ status: { $nin: ['uploaded', 'failed', 'pending'] } }),
      getQueueStatuses(),
      isGroqHealthy(),
    ]);
    const top5 = await Video.find({ status: 'uploaded' }).sort({ 'analytics.views': -1 }).limit(5).select('title youtubeUrl analytics');
    res.json({
      videos: { total, uploaded, failed, inProgress, pending: total - uploaded - failed - inProgress },
      queues,
      services: { groq: groqOk ? 'up' : 'down' },
      topPerformers: top5,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function getYouTubeAuthUrl(_req: Request, res: Response) {
  try { res.json({ authUrl: getAuthUrl() }); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function handleOAuthCallback(req: Request, res: Response) {
  try {
    const { code, channelId = 'default' } = req.query as Record<string, string>;
    if (!code) { res.status(400).json({ error: 'Missing code' }); return; }
    await exchangeCode(code, channelId);
    res.send('<h2>✅ YouTube connected! You can close this tab.</h2>');
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}

export async function listTopics(req: Request, res: Response) {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    const [topics, total] = await Promise.all([
      Topic.find(filter).sort({ score: -1, createdAt: -1 }).skip((+page - 1) * +limit).limit(+limit),
      Topic.countDocuments(filter),
    ]);
    res.json({ topics, total });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
}
