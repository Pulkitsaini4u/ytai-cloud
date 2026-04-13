import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';
import {
  createTopicWorker,
  createScriptWorker,
  createVoiceWorker,
  createVisualWorker,
  createSubtitleWorker,
  createVideoWorker,
  createThumbnailWorker,
  createSEOWorker,
  createUploadWorker,
  attachErrorHandlers,
} from './allWorkers';

async function startWorkers() {
  logger.info('🚀 Starting all pipeline workers...');
  await connectDatabase();

  const workers = [
    createTopicWorker(),
    createScriptWorker(),
    createVoiceWorker(),
    createVisualWorker(),
    createSubtitleWorker(),
    createVideoWorker(),
    createThumbnailWorker(),
    createSEOWorker(),
    createUploadWorker(),
  ];

  attachErrorHandlers(workers as any);
  logger.info(`✅ ${workers.length} workers running`);

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all(workers.map(w => w.close()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorkers().catch(err => {
  logger.error('Workers failed to start', err);
  process.exit(1);
});
