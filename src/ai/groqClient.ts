/**
 * Groq API Client
 * FREE tier: 14,400 req/day, 6,000 tokens/min
 * No RAM usage - runs in the cloud
 * Models: llama3-8b-8192, mixtral-8x7b-32768, gemma-7b-it, llama3-70b-8192
 * Sign up: https://console.groq.com
 */
import Groq from 'groq-sdk';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let groqClient: Groq | null = null;

function getClient(): Groq {
  if (!groqClient) {
    if (!config.groq.apiKey) throw new Error('GROQ_API_KEY not set. Get a free key at https://console.groq.com');
    groqClient = new Groq({ apiKey: config.groq.apiKey });
  }
  return groqClient;
}

// ── Core text generation ──────────────────────────────────
export async function groqGenerate(
  prompt: string,
  options: {
    model?: string;
    system?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const {
    model = config.groq.modelScript,
    system = 'You are a helpful assistant.',
    temperature = 0.7,
    maxTokens = 4096,
  } = options;

  const client = getClient();

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return completion.choices[0]?.message?.content?.trim() ?? '';
  } catch (err: any) {
    // Rate limit handling
    if (err?.status === 429) {
      logger.warn('Groq rate limit hit, waiting 60s...');
      await new Promise(r => setTimeout(r, 60_000));
      return groqGenerate(prompt, options); // retry once
    }
    logger.error('Groq generate error', { model, error: err.message });
    throw new Error(`Groq API failed: ${err.message}`);
  }
}

// ── JSON generation ───────────────────────────────────────
export async function groqGenerateJSON<T>(
  prompt: string,
  options: Parameters<typeof groqGenerate>[1] = {}
): Promise<T> {
  const system = 'You are a JSON generator. Respond ONLY with valid JSON. No markdown, no code blocks, no explanation, no preamble.';

  const response = await groqGenerate(prompt, {
    ...options,
    system,
    model: options.model ?? config.groq.modelSeo,
    temperature: 0.2,
  });

  const cleaned = response.replace(/```json\n?|```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Failed to parse JSON from Groq response: ${cleaned.slice(0, 300)}`);
  }
}

// ── Health check ──────────────────────────────────────────
export async function isGroqHealthy(): Promise<boolean> {
  try {
    await groqGenerate('Say "ok"', { maxTokens: 5 });
    return true;
  } catch {
    return false;
  }
}
