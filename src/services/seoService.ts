import { groqGenerateJSON } from '../ai/groqClient';
import { uploadBuffer, videoKey } from './storageService';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  categoryId: number;
  language: string;
}

function detectCategoryId(topic: string): number {
  const t = topic.toLowerCase();
  if (/tech|ai|software|robot|cyber|digital/.test(t)) return 28;
  if (/science|physics|space|biology|chemistry/.test(t)) return 28;
  if (/health|medical|fitness|diet/.test(t)) return 26;
  if (/news|politics|government/.test(t)) return 25;
  if (/game|gaming/.test(t)) return 20;
  if (/money|finance|invest|crypto/.test(t)) return 27;
  return 27;
}

export async function generateSEOMetadata(
  topicTitle: string,
  scriptExcerpt: string,
  videoId: string
): Promise<VideoMetadata> {
  logger.info(`🔍 Generating SEO metadata for: "${topicTitle}"`);

  const prompt = `Generate YouTube SEO metadata for a video about: "${topicTitle}"

Script excerpt: "${scriptExcerpt.slice(0, 400)}"

Return ONLY this exact JSON structure, nothing else:
{
  "title": "compelling YouTube title with main keyword first, max 70 chars",
  "description": "YouTube description 300-400 words. Start with a 2-sentence summary. Then 5 bullet points starting with • showing what viewers learn. Then a subscribe CTA. Include 3-4 relevant keywords naturally. End with 'Watch next:' teaser.",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13", "tag14", "tag15"],
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]
}`;

  try {
    const result = await groqGenerateJSON<Omit<VideoMetadata, 'categoryId' | 'language'>>(
      prompt, { model: config.groq.modelSeo, temperature: 0.3 }
    );

    const metadata: VideoMetadata = {
      title: (result.title ?? topicTitle).slice(0, 100),
      description: result.description ?? `Learn about ${topicTitle}`,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 30) : [topicTitle],
      hashtags: Array.isArray(result.hashtags) ? result.hashtags.slice(0, 8) : [],
      categoryId: detectCategoryId(topicTitle),
      language: 'en',
    };

    const key = videoKey(videoId, 'metadata.json');
    await uploadBuffer(Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'), key, 'application/json');

    logger.info(`✅ SEO done: "${metadata.title}"`);
    return metadata;
  } catch (err: any) {
    logger.warn(`SEO generation failed, using defaults: ${err.message}`);
    const fallback: VideoMetadata = {
      title: topicTitle.slice(0, 100),
      description: `${topicTitle}\n\nDiscover everything about ${topicTitle} in this comprehensive video.\n\n👍 Like and Subscribe for more content!`,
      tags: topicTitle.toLowerCase().split(' ').filter(w => w.length > 3),
      hashtags: [`#${topicTitle.replace(/\s+/g, '')}`],
      categoryId: detectCategoryId(topicTitle),
      language: 'en',
    };
    return fallback;
  }
}
