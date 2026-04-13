import { hfTextToSpeech } from '../ai/huggingfaceClient';
import { uploadBuffer, videoKey } from './storageService';
import { logger } from '../utils/logger';

function cleanForTTS(text: string): string {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\(pause\)/gi, '. ')
    .replace(/---/g, '')
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateVoice(scriptText: string, videoId: string): Promise<{ key: string; url: string }> {
  logger.info('🎙️ Generating voice via HuggingFace TTS...');

  const clean = cleanForTTS(scriptText);
  const audioBuffer = await hfTextToSpeech(clean);

  const key = videoKey(videoId, 'voice.wav');
  const url = await uploadBuffer(audioBuffer, key, 'audio/wav');

  logger.info(`✅ Voice generated and uploaded (${(audioBuffer.length / 1024).toFixed(0)} KB)`);
  return { key, url };
}
