/**
 * Video Assembly Service
 * Downloads voice + visuals from cloud storage to /tmp,
 * assembles with FFmpeg, uploads final video back to cloud.
 * /tmp on Railway: ~512MB available, cleaned after each run.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { downloadFile, uploadFile, videoKey, tmpPath, cleanupTmp } from './storageService';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// ── Download all assets to /tmp ───────────────────────────
async function downloadAssets(
  videoId: string,
  voiceKey: string,
  visualKeys: string[],
  subtitleKey?: string
): Promise<{ voicePath: string; imagePaths: string[]; subtitlePath?: string }> {
  const voicePath = tmpPath(`${videoId}_voice.wav`);
  await downloadFile(voiceKey, voicePath);

  const imagePaths: string[] = [];
  for (let i = 0; i < visualKeys.length; i++) {
    const imgPath = tmpPath(`${videoId}_img_${i}.jpg`);
    try {
      await downloadFile(visualKeys[i], imgPath);
      if (fs.existsSync(imgPath)) imagePaths.push(imgPath);
    } catch { continue; }
  }

  let subtitlePath: string | undefined;
  if (subtitleKey) {
    subtitlePath = tmpPath(`${videoId}_subs.srt`);
    try { await downloadFile(subtitleKey, subtitlePath); } catch { subtitlePath = undefined; }
  }

  return { voicePath, imagePaths, subtitlePath };
}

// ── Get audio duration ────────────────────────────────────
async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim()) || 480;
}

// ── Create slideshow from images ──────────────────────────
async function createSlideshow(
  imagePaths: string[],
  audioDuration: number,
  outputPath: string,
  resolution = '1920x1080'
): Promise<void> {
  const secondsPerSlide = audioDuration / imagePaths.length;
  const listFile = outputPath + '_list.txt';

  const lines = imagePaths.map(p => `file '${path.resolve(p)}'\nduration ${secondsPerSlide.toFixed(3)}`).join('\n');
  fs.writeFileSync(listFile, lines);

  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -c:v libx264 -pix_fmt yuv420p "${outputPath}"`,
    { timeout: 300_000 }
  );

  try { fs.unlinkSync(listFile); } catch {}
}

// ── Assemble final video ──────────────────────────────────
export async function assembleVideo(
  videoId: string,
  voiceKey_: string,
  visualKeys: string[],
  subtitleKey?: string,
  isShort = false
): Promise<{ key: string; url: string; duration: number }> {
  logger.info(`🎬 Assembling video ${videoId}...`);

  const { voicePath, imagePaths, subtitlePath } = await downloadAssets(
    videoId, voiceKey_, visualKeys, subtitleKey
  );

  if (imagePaths.length === 0) throw new Error('No visual assets available for assembly');

  const resolution = isShort ? '1080x1920' : '1920x1080';
  const slideshowPath = tmpPath(`${videoId}_slideshow.mp4`);
  const withAudioPath = tmpPath(`${videoId}_with_audio.mp4`);
  const finalPath = tmpPath(`${videoId}_final.mp4`);

  const duration = await getAudioDuration(voicePath);
  logger.info(`Audio duration: ${duration.toFixed(1)}s`);

  // Step 1: Slideshow
  await createSlideshow(imagePaths, duration, slideshowPath, resolution);

  // Step 2: Merge audio
  await execAsync(
    `ffmpeg -y -i "${slideshowPath}" -i "${voicePath}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${withAudioPath}"`,
    { timeout: 120_000 }
  );

  // Step 3: Burn subtitles
  if (subtitlePath && fs.existsSync(subtitlePath)) {
    const srtAbs = path.resolve(subtitlePath).replace(/\\/g, '/');
    await execAsync(
      `ffmpeg -y -i "${withAudioPath}" -vf "subtitles='${srtAbs}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'" -c:a copy "${finalPath}"`,
      { timeout: 120_000 }
    );
  } else {
    fs.renameSync(withAudioPath, finalPath);
  }

  // Upload final video to cloud
  const key = videoKey(videoId, 'final-video.mp4');
  const url = await uploadFile(finalPath, key, 'video/mp4');

  logger.info(`✅ Video assembled and uploaded: ${url}`);

  // Cleanup all tmp files
  [slideshowPath, withAudioPath, finalPath, voicePath, subtitlePath ?? ''].forEach(p => {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  });
  imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  cleanupTmp(videoId);

  return { key, url, duration };
}
