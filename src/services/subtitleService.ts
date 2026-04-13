import { hfSpeechToText } from '../ai/huggingfaceClient';
import { uploadBuffer, downloadFile, videoKey, tmpPath } from './storageService';
import { logger } from '../utils/logger';
import fs from 'fs';

function toSRTTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function chunksToSRT(chunks: Array<{ timestamp: [number, number]; text: string }>): string {
  return chunks
    .filter(c => c.text?.trim())
    .map((c, i) => `${i + 1}\n${toSRTTime(c.timestamp[0])} --> ${toSRTTime(c.timestamp[1])}\n${c.text.trim()}\n`)
    .join('\n');
}

function scriptToSRT(scriptText: string, duration: number): string {
  const clean = scriptText.replace(/\[.*?\]/g, '').replace(/---/g, '').trim();
  const words = clean.split(/\s+/);
  const wordsPerChunk = 12;
  const chunks = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const slice = words.slice(i, i + wordsPerChunk).join(' ');
    const start = (i / words.length) * duration;
    const end = Math.min(((i + wordsPerChunk) / words.length) * duration, duration);
    chunks.push({ timestamp: [start, end] as [number, number], text: slice });
  }

  return chunksToSRT(chunks);
}

export async function generateSubtitles(
  voiceKey: string,
  scriptText: string,
  videoId: string,
  estimatedDuration: number
): Promise<string> {
  logger.info('📝 Generating subtitles via Whisper...');

  let srt = '';

  try {
    // Download voice from cloud to /tmp
    const tmpVoice = tmpPath(`voice_${videoId}.wav`);
    await downloadFile(voiceKey, tmpVoice);
    const audioBuffer = fs.readFileSync(tmpVoice);

    const result = await hfSpeechToText(audioBuffer);

    if (result.chunks && result.chunks.length > 0) {
      srt = chunksToSRT(result.chunks);
      logger.info(`✅ Whisper subtitles: ${result.chunks.length} segments`);
    } else {
      throw new Error('No chunks from Whisper');
    }

    // Clean up tmp
    try { fs.unlinkSync(tmpVoice); } catch {}
  } catch (err: any) {
    logger.warn(`Whisper failed (${err.message}), using script fallback`);
    srt = scriptToSRT(scriptText, estimatedDuration);
  }

  const key = videoKey(videoId, 'subtitles.srt');
  await uploadBuffer(Buffer.from(srt, 'utf-8'), key, 'text/plain');

  return key;
}
