import dotenv from 'dotenv';
dotenv.config();

const opt = (key: string, def = '') => process.env[key] ?? def;
const num = (key: string, def: number) => parseInt(process.env[key] ?? String(def), 10);

export const config = {
  server: {
    port: num('PORT', 3000),
    env: opt('NODE_ENV', 'development'),
  },
  mongodb: {
    uri: opt('MONGODB_URI', 'mongodb://localhost:27017/ytai'),
  },
  redis: {
    url: opt('REDIS_URL', 'redis://localhost:6379'),
  },
  groq: {
    apiKey: opt('GROQ_API_KEY'),
    modelScript: opt('GROQ_MODEL_SCRIPT', 'llama3-8b-8192'),
    modelSeo: opt('GROQ_MODEL_SEO', 'mixtral-8x7b-32768'),
  },
  huggingface: {
    apiKey: opt('HUGGINGFACE_API_KEY'),
  },
  apis: {
    pexels: opt('PEXELS_API_KEY'),
    pixabay: opt('PIXABAY_API_KEY'),
  },
  storage: {
    provider: opt('STORAGE_PROVIDER', 'local') as 'r2' | 'b2' | 'local',
    localDir: opt('LOCAL_OUTPUT_DIR', '/tmp/ytai-output'),
    r2: {
      accountId: opt('CLOUDFLARE_ACCOUNT_ID'),
      accessKey: opt('CLOUDFLARE_R2_ACCESS_KEY'),
      secretKey: opt('CLOUDFLARE_R2_SECRET_KEY'),
      bucket: opt('CLOUDFLARE_R2_BUCKET', 'ytai-videos'),
      publicUrl: opt('CLOUDFLARE_R2_PUBLIC_URL'),
    },
    b2: {
      keyId: opt('B2_APPLICATION_KEY_ID'),
      appKey: opt('B2_APPLICATION_KEY'),
      bucket: opt('B2_BUCKET_NAME'),
      bucketId: opt('B2_BUCKET_ID'),
    },
  },
  youtube: {
    clientId: opt('YOUTUBE_CLIENT_ID'),
    clientSecret: opt('YOUTUBE_CLIENT_SECRET'),
    redirectUri: opt('YOUTUBE_REDIRECT_URI', 'http://localhost:3000/api/auth/callback'),
    refreshToken: opt('YOUTUBE_REFRESH_TOKEN'),
  },
  pipeline: {
    maxVideosPerDay: num('MAX_VIDEOS_PER_DAY', 2),
    scriptWordCount: num('SCRIPT_WORD_COUNT', 1200),
    topicsPerRun: num('TOPICS_PER_RUN', 5),
  },
  cron: {
    topicFetch: opt('CRON_TOPIC_FETCH', '0 6 * * *'),
    videoGen:   opt('CRON_VIDEO_GEN',   '0 7 * * *'),
    upload:     opt('CRON_UPLOAD',      '0 10 * * *'),
  },
  retry: { maxRetries: 3, delayMs: 5000 },
};
