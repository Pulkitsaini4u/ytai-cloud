import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { config } from './config/env';
import { connectDatabase } from './config/database';
import { logger } from './utils/logger';
import videoRoutes from './routes/videoRoutes';
import { isGroqHealthy } from './ai/groqClient';
import { startScheduler } from './scheduler/cronJobs';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, _res, next) => { logger.debug(`${req.method} ${req.path}`); next(); });

app.use('/api', videoRoutes);

app.get('/health', async (_req, res) => {
  const groq = await isGroqHealthy();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), services: { groq: groq ? 'up' : 'down' } });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: err.message });
});

async function bootstrap() {
  // Ensure /tmp/ytai exists for local file processing
  fs.mkdirSync('/tmp/ytai', { recursive: true });
  fs.mkdirSync('tokens', { recursive: true });

  await connectDatabase();

  // Start scheduler in the same process (saves Railway dyno hours)
  await startScheduler();

  app.listen(config.server.port, () => {
    logger.info(`🚀 Server on port ${config.server.port}`);
    logger.info(`📊 Dashboard: /api/dashboard`);
    logger.info(`🔑 YouTube auth: /api/auth/youtube`);
  });
}

bootstrap().catch(err => { logger.error('Bootstrap failed', err); process.exit(1); });

export default app;
