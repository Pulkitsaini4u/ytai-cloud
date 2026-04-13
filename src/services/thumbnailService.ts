import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { hfGenerateImage } from '../ai/huggingfaceClient';
import { downloadFile, uploadBuffer, uploadFile, videoKey, tmpPath } from './storageService';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

function buildSDPrompt(title: string): string {
  const lower = title.toLowerCase();
  if (/tech|ai|robot|digital|cyber/.test(lower)) return `futuristic technology background, glowing circuits, 4k cinematic, ${title}`;
  if (/space|science|physics/.test(lower)) return `dramatic space nebula, cosmos, scientific wonder, ${title}`;
  if (/health|medical|fitness/.test(lower)) return `clean medical professional setting, modern health, ${title}`;
  if (/money|finance|invest/.test(lower)) return `financial district skyscrapers, wealth success, ${title}`;
  return `dramatic cinematic background, professional, high quality, ${title}`;
}

async function addTextOverlay(
  inputPath: string,
  title: string,
  outputPath: string
): Promise<void> {
  const display = title.length > 45 ? title.slice(0, 42) + '...' : title;
  // Escape for FFmpeg drawtext
  const escaped = display.replace(/'/g, "\u2019").replace(/[\\:]/g, '\\$&');

  await execAsync(
    `ffmpeg -y -i "${inputPath}" \
      -vf "scale=1280:720,drawbox=x=0:y=560:w=1280:h=160:color=black@0.7:t=fill,\
      drawtext=text='${escaped}':fontcolor=white:fontsize=44:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=(w-text_w)/2:y=590:shadowcolor=black:shadowx=2:shadowy=2" \
      -frames:v 1 "${outputPath}"`,
    { timeout: 30_000 }
  );
}

async function addTextFFmpeg(inputPath: string, title: string, outputPath: string): Promise<void> {
  // Fallback using simpler drawtext without font file
  const display = (title.length > 40 ? title.slice(0, 37) + '...' : title).replace(/'/g, ' ');
  await execAsync(
    `ffmpeg -y -i "${inputPath}" \
      -vf "scale=1280:720,drawbox=x=0:y=580:w=1280:h=140:color=0x000000@0.75:t=fill,\
      drawtext=text='${display}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=610" \
      -frames:v 1 "${outputPath}"`,
    { timeout: 30_000 }
  );
}

export async function generateThumbnail(
  title: string,
  videoId: string,
  coverKey?: string
): Promise<{ key: string; url: string }> {
  logger.info(`🖼️  Generating thumbnail for: "${title}"`);

  const basePath = tmpPath(`${videoId}_thumb_base.jpg`);
  const finalPath = tmpPath(`${videoId}_thumbnail.png`);

  let hasBase = false;

  // Try HuggingFace Stable Diffusion first
  try {
    const imgBuffer = await hfGenerateImage(buildSDPrompt(title));
    if (imgBuffer) {
      fs.writeFileSync(basePath, imgBuffer);
      hasBase = true;
      logger.info('🎨 Thumbnail base from Stable Diffusion');
    }
  } catch (err: any) {
    logger.warn(`SD failed: ${err.message}`);
  }

  // Fall back to cover image from Pexels
  if (!hasBase && coverKey) {
    try {
      await downloadFile(coverKey, basePath);
      hasBase = fs.existsSync(basePath);
    } catch {}
  }

  // Fall back to gradient placeholder
  if (!hasBase) {
    await execAsync(
      `ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:size=1280x720" -frames:v 1 "${basePath}"`,
      { timeout: 10_000 }
    );
    hasBase = true;
  }

  // Add text overlay
  try {
    await addTextOverlay(basePath, title, finalPath);
  } catch {
    try {
      await addTextFFmpeg(basePath, title, finalPath);
    } catch {
      fs.copyFileSync(basePath, finalPath);
    }
  }

  const key = videoKey(videoId, 'thumbnail.png');
  const url = await uploadFile(finalPath, key, 'image/png');

  try { fs.unlinkSync(basePath); } catch {}
  try { fs.unlinkSync(finalPath); } catch {}

  logger.info(`✅ Thumbnail uploaded: ${url}`);
  return { key, url };
}
