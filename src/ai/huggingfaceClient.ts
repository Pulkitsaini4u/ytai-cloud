/**
 * HuggingFace Inference API Client
 * FREE tier: 30,000 inference calls/month
 * Used for: TTS (voice), Whisper (subtitles), Image generation (thumbnails)
 * Sign up: https://huggingface.co → Settings → Access Tokens
 */
import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const HF_API = 'https://api-inference.huggingface.co/models';

function authHeader() {
  return { Authorization: `Bearer ${config.huggingface.apiKey}` };
}

// ── Text-to-Speech ────────────────────────────────────────
// Model: facebook/mms-tts-eng (free, no GPU needed, good quality)
export async function hfTextToSpeech(text: string): Promise<Buffer> {
  const model = 'facebook/mms-tts-eng';

  // Split into chunks of 500 chars max
  const chunks = splitText(text, 450);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    try {
      const response = await axios.post(
        `${HF_API}/${model}`,
        { inputs: chunk },
        {
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 60_000,
        }
      );
      audioBuffers.push(Buffer.from(response.data));
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      if (err?.response?.status === 503) {
        // Model loading - wait and retry
        logger.info('HF TTS model loading, waiting 20s...');
        await new Promise(r => setTimeout(r, 20_000));
        const retry = await axios.post(
          `${HF_API}/${model}`,
          { inputs: chunk },
          { headers: { ...authHeader() }, responseType: 'arraybuffer', timeout: 60_000 }
        );
        audioBuffers.push(Buffer.from(retry.data));
      } else {
        throw new Error(`HF TTS failed: ${err.message}`);
      }
    }
  }

  // Concatenate all WAV buffers
  return Buffer.concat(audioBuffers);
}

// ── Speech-to-Text (Whisper) ──────────────────────────────
// Model: openai/whisper-base (free)
export async function hfSpeechToText(audioBuffer: Buffer): Promise<{
  text: string;
  chunks?: Array<{ timestamp: [number, number]; text: string }>;
}> {
  const model = 'openai/whisper-base';

  try {
    const response = await axios.post(
      `${HF_API}/${model}`,
      audioBuffer,
      {
        headers: {
          ...authHeader(),
          'Content-Type': 'audio/wav',
        },
        params: { return_timestamps: true },
        timeout: 120_000,
      }
    );
    return response.data;
  } catch (err: any) {
    logger.warn(`HF Whisper failed: ${err.message}`);
    return { text: '', chunks: [] };
  }
}

// ── Image generation ──────────────────────────────────────
// Model: stabilityai/stable-diffusion-xl-base-1.0 (free on HF)
export async function hfGenerateImage(prompt: string): Promise<Buffer | null> {
  const models = [
    'stabilityai/stable-diffusion-xl-base-1.0',
    'runwayml/stable-diffusion-v1-5',
    'CompVis/stable-diffusion-v1-4',
  ];

  for (const model of models) {
    try {
      const response = await axios.post(
        `${HF_API}/${model}`,
        {
          inputs: prompt,
          parameters: { width: 1280, height: 720, num_inference_steps: 20 },
        },
        {
          headers: authHeader(),
          responseType: 'arraybuffer',
          timeout: 120_000,
        }
      );
      logger.info(`🎨 Image generated with ${model}`);
      return Buffer.from(response.data);
    } catch (err: any) {
      logger.warn(`HF image gen failed with ${model}: ${err.message}`);
      continue;
    }
  }
  return null;
}

// ── Text split helper ─────────────────────────────────────
function splitText(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += ' ' + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}
