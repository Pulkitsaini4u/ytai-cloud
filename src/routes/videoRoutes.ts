import { Router } from 'express';
import {
  triggerPipeline, createVideo,
  listVideos, getVideo, getVideoStatus, retryVideo,
  getDashboard, getYouTubeAuthUrl, handleOAuthCallback, listTopics,
} from '../controllers/videoController';

const router = Router();

router.post('/pipeline/trigger', triggerPipeline);
router.post('/pipeline/video', createVideo);

router.get('/videos', listVideos);
router.get('/videos/:id', getVideo);
router.get('/videos/:id/status', getVideoStatus);
router.post('/videos/:id/retry', retryVideo);

router.get('/topics', listTopics);
router.get('/dashboard', getDashboard);

router.get('/auth/youtube', getYouTubeAuthUrl);
router.get('/auth/callback', handleOAuthCallback);

export default router;
