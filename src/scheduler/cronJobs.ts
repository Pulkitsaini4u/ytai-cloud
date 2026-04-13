import cron from 'node-cron';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { triggerTopicDiscovery } from '../queues/videoPipelineQueue';
import { Video } from '../config/database';
import { fetchVideoAnalytics } from '../youtube/uploaderService';
import { connectDatabase } from '../config/database';

export async function startScheduler() {
  await connectDatabase();
  logger.info('⏰ Starting scheduler...');

  // Daily topic discovery + pipeline kick-off
  cron.schedule(config.cron.topicFetch, async () => {
    logger.info('⏰ CRON: Daily topic fetch + pipeline start');
    try {
      await triggerTopicDiscovery('default');
    } catch (err: any) {
      logger.error('CRON topic fetch failed', { error: err.message });
    }
  }, { timezone: 'UTC' });

  // Hourly: retry failed videos (up to 3 retries)
  cron.schedule('0 * * * *', async () => {
    try {
      const failed = await Video.find({ status: 'failed', retryCount: { $lt: 3 } }).limit(3);
      for (const v of failed) {
        await Video.findOneAndUpdate({ _id: v._id }, { status: 'pending', errorLog: [], $inc: { retryCount: 1 } });
        await triggerTopicDiscovery(v.channelId);
        logger.info(`🔄 Retrying video ${v._id}`);
      }
    } catch (err: any) {
      logger.error('CRON retry failed', { error: err.message });
    }
  });

  // Analytics collection at 3 AM UTC
  cron.schedule('0 3 * * *', async () => {
    logger.info('📊 CRON: Collecting analytics...');
    try {
      const uploaded = await Video.find({
        status: 'uploaded',
        youtubeVideoId: { $exists: true },
        'analytics.lastFetched': { $lt: new Date(Date.now() - 86400000) },
      }).limit(10);

      for (const v of uploaded) {
        try {
          const stats = await fetchVideoAnalytics(v.youtubeVideoId, v.channelId);
          await Video.findOneAndUpdate({ _id: v._id }, {
            'analytics.views': stats.views,
            'analytics.likes': stats.likes,
            'analytics.comments': stats.comments,
            'analytics.lastFetched': new Date(),
          });
        } catch { continue; }
      }
      logger.info(`✅ Analytics updated for ${uploaded.length} videos`);
    } catch (err: any) {
      logger.error('CRON analytics failed', { error: err.message });
    }
  }, { timezone: 'UTC' });

  logger.info('✅ Cron jobs scheduled');
}

if (require.main === module) {
  startScheduler().catch(err => { logger.error(err); process.exit(1); });
}
