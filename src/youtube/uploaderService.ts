import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { VideoMetadata } from '../services/seoService';
import { downloadFile, tmpPath } from '../services/storageService';

function getOAuth2Client(channelId = 'default') {
  const client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );

  const tokenPath = path.join(process.cwd(), 'tokens', `${channelId}.json`);
  if (fs.existsSync(tokenPath)) {
    client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')));
  } else if (config.youtube.refreshToken) {
    client.setCredentials({ refresh_token: config.youtube.refreshToken });
  } else {
    throw new Error(`No YouTube tokens for channel: ${channelId}. Visit /api/auth/youtube`);
  }
  return client;
}

export function getAuthUrl(): string {
  const client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'],
  });
}

export async function exchangeCode(code: string, channelId = 'default'): Promise<void> {
  const client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  const { tokens } = await client.getToken(code);
  const dir = path.join(process.cwd(), 'tokens');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${channelId}.json`), JSON.stringify(tokens));
  logger.info(`✅ YouTube tokens saved for channel: ${channelId}`);
}

export async function uploadToYouTube(
  videoKey: string,
  thumbnailKey: string,
  metadata: VideoMetadata,
  scheduledPublishAt: Date | null = null,
  channelId = 'default'
): Promise<{ videoId: string; url: string }> {
  logger.info(`📤 Uploading to YouTube (channel: ${channelId})...`);

  // Download video + thumbnail from cloud to /tmp
  const videoPath = tmpPath(`upload_${Date.now()}.mp4`);
  const thumbPath = tmpPath(`upload_thumb_${Date.now()}.png`);

  await downloadFile(videoKey, videoPath);
  await downloadFile(thumbnailKey, thumbPath);

  const auth = getOAuth2Client(channelId);
  const youtube = google.youtube({ version: 'v3', auth });

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: `${metadata.description}\n\n${metadata.hashtags.join(' ')}`,
        tags: [...metadata.tags, ...metadata.hashtags.map(h => h.replace('#', ''))],
        categoryId: String(metadata.categoryId),
        defaultLanguage: metadata.language,
        defaultAudioLanguage: metadata.language,
      },
      status: {
        privacyStatus: scheduledPublishAt ? 'private' : 'public',
        publishAt: scheduledPublishAt?.toISOString(),
        selfDeclaredMadeForKids: false,
      },
    },
    media: { mimeType: 'video/mp4', body: fs.createReadStream(videoPath) },
  });

  const ytVideoId = response.data.id!;

  // Upload thumbnail
  try {
    await youtube.thumbnails.set({
      videoId: ytVideoId,
      media: { mimeType: 'image/png', body: fs.createReadStream(thumbPath) },
    });
  } catch (e: any) {
    logger.warn(`Thumbnail upload failed: ${e.message}`);
  }

  // Cleanup
  try { fs.unlinkSync(videoPath); } catch {}
  try { fs.unlinkSync(thumbPath); } catch {}

  const url = `https://www.youtube.com/watch?v=${ytVideoId}`;
  logger.info(`✅ Uploaded: ${url}`);
  return { videoId: ytVideoId, url };
}

export async function fetchVideoAnalytics(youtubeVideoId: string, channelId = 'default') {
  const auth = getOAuth2Client(channelId);
  const youtube = google.youtube({ version: 'v3', auth });
  const r = await youtube.videos.list({ part: ['statistics'], id: [youtubeVideoId] });
  const s = r.data.items?.[0]?.statistics;
  return {
    views: parseInt(s?.viewCount ?? '0', 10),
    likes: parseInt(s?.likeCount ?? '0', 10),
    comments: parseInt(s?.commentCount ?? '0', 10),
  };
}
