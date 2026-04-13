import { groqGenerate } from '../ai/groqClient';
import { uploadBuffer, videoKey } from './storageService';
import { ITopic } from '../config/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export interface ScriptSection {
  type: 'hook' | 'intro' | 'body' | 'story' | 'conclusion' | 'cta';
  content: string;
  estimatedSeconds: number;
}

export interface GeneratedScript {
  sections: ScriptSection[];
  fullText: string;
  wordCount: number;
  estimatedDuration: number;
}

export async function generateScript(topic: ITopic, videoId: string): Promise<GeneratedScript> {
  logger.info(`📝 Generating script via Groq for: "${topic.title}"`);

  const words = config.pipeline.scriptWordCount;

  const prompt = `Write a YouTube video script about: "${topic.title}"

Target length: ${words} words (about ${Math.floor(words / 150)} minutes when spoken).

Use these exact section markers:

[HOOK]
Start with a shocking fact, provocative question, or bold statement. First 15 seconds must be irresistible.

[INTRO]  
Briefly tell viewers what they'll learn. Build anticipation.

[MAIN CONTENT]
3-5 informative subsections with smooth transitions. Use real examples, data, anecdotes. Write conversationally — like speaking to a friend, not reading an essay. Use "you" and contractions.

[STORY]
One compelling real-world story or case study that proves your main point.

[CONCLUSION]
Summarize 3 key takeaways in plain language.

[CALL TO ACTION]
Ask viewers to like, subscribe, and comment with their thoughts. Tease next video.

Rules: No bullet points. No stage directions. No camera cues. Just natural flowing speech. Include (pause) where natural breaks occur. Total must be approximately ${words} words.

Write the full script now:`;

  const raw = await groqGenerate(prompt, {
    model: config.groq.modelScript,
    temperature: 0.75,
    maxTokens: 6000,
  });

  const sections = parseScript(raw);
  const fullText = sections.map(s => s.content).join('\n\n');
  const wordCount = fullText.split(/\s+/).length;
  const estimatedDuration = sections.reduce((sum, s) => sum + s.estimatedSeconds, 0);

  // Upload script to cloud storage
  const key = videoKey(videoId, 'script.txt');
  const formatted = sections.map(s => `[${s.type.toUpperCase()}]\n${s.content}`).join('\n\n---\n\n');
  await uploadBuffer(Buffer.from(formatted, 'utf-8'), key, 'text/plain');

  logger.info(`✅ Script: ${wordCount} words, ~${Math.floor(estimatedDuration / 60)} min`);
  return { sections, fullText, wordCount, estimatedDuration };
}

function parseScript(raw: string): ScriptSection[] {
  const tagMap: Record<string, ScriptSection['type']> = {
    HOOK: 'hook', INTRO: 'intro',
    'MAIN CONTENT': 'body', STORY: 'story',
    CONCLUSION: 'conclusion', 'CALL TO ACTION': 'cta',
  };

  const sections: ScriptSection[] = [];
  const pattern = /\[(HOOK|INTRO|MAIN CONTENT|STORY|CONCLUSION|CALL TO ACTION)\]/g;
  const matches = [...raw.matchAll(pattern)];

  for (let i = 0; i < matches.length; i++) {
    const tag = matches[i][1];
    const start = raw.indexOf('\n', matches[i].index!) + 1;
    const end = matches[i + 1]?.index ?? raw.length;
    const content = raw.slice(start, end).trim();
    if (content.length > 20) {
      const wc = content.split(/\s+/).length;
      sections.push({
        type: tagMap[tag] ?? 'body',
        content,
        estimatedSeconds: Math.ceil((wc / 150) * 60),
      });
    }
  }

  if (sections.length === 0) {
    const wc = raw.split(/\s+/).length;
    sections.push({ type: 'body', content: raw, estimatedSeconds: Math.ceil((wc / 150) * 60) });
  }

  return sections;
}

export async function generateShortsScript(topic: ITopic): Promise<string> {
  return groqGenerate(
    `Write a 60-second YouTube Shorts script about: "${topic.title}"\n\nMax 150 words. Hook in first 3 seconds. One punchy insight. End with "Follow for more!" Write as flowing speech, no labels or headers.`,
    { temperature: 0.8, maxTokens: 400 }
  );
}
