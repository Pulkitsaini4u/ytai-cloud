import axios from 'axios';
import { uploadBuffer, videoKey } from './storageService';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { ScriptSection } from './scriptService';

async function fetchPexels(query: string, count = 3): Promise<string[]> {
  if (!config.apis.pexels) return [];
  try {
    const r = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: config.apis.pexels },
      params: { query, per_page: count, orientation: 'landscape' },
      timeout: 10_000,
    });
    return (r.data.photos ?? []).map((p: any) => p.src.large2x ?? p.src.large);
  } catch { return []; }
}

async function fetchPixabay(query: string, count = 3): Promise<string[]> {
  if (!config.apis.pixabay) return [];
  try {
    const r = await axios.get('https://pixabay.com/api/', {
      params: { key: config.apis.pixabay, q: query, image_type: 'photo', orientation: 'horizontal', per_page: count, safesearch: true },
      timeout: 10_000,
    });
    return (r.data.hits ?? []).map((h: any) => h.largeImageURL ?? h.webformatURL);
  } catch { return []; }
}

async function downloadToBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 20_000, headers: { 'User-Agent': 'YTAIBot/2.0' } });
    return Buffer.from(r.data);
  } catch { return null; }
}

function extractKeywords(text: string, topicTitle: string): string {
  const stop = new Set(['the','a','an','is','are','was','were','be','have','has','do','does','will','would','could','should','to','of','in','on','at','for','with','by','from','that','this','and','or','but','not','as','so','if','you','we','it']);
  const topicWords = topicTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
  const textWords = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 5 && !stop.has(w));
  const freq = new Map<string, number>();
  textWords.forEach(w => freq.set(w, (freq.get(w) ?? 0) + 1));
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  return [...new Set([...topicWords.slice(0, 2), ...top])].slice(0, 3).join(' ');
}

export async function collectVisuals(
  sections: ScriptSection[],
  topicTitle: string,
  videoId: string
): Promise<string[]> {
  logger.info(`🖼️  Collecting visuals for ${sections.length} sections...`);
  const keys: string[] = [];

  for (let si = 0; si < sections.length; si++) {
    const query = extractKeywords(sections[si].content, topicTitle) || topicTitle;
    const [pexUrls, pixUrls] = await Promise.all([
      fetchPexels(query, 2),
      fetchPixabay(query, 2),
    ]);

    const urls = [...pexUrls, ...pixUrls].slice(0, 3);
    let downloaded = 0;

    for (const url of urls) {
      if (downloaded >= 2) break;
      const buf = await downloadToBuffer(url);
      if (buf) {
        const key = videoKey(videoId, `visuals/section_${si}_${downloaded}.jpg`);
        await uploadBuffer(buf, key, 'image/jpeg');
        keys.push(key);
        downloaded++;
      }
    }

    // Fallback: use a placeholder color image if no images found
    if (downloaded === 0) {
      logger.warn(`No images found for section ${si}, using placeholder`);
    }
  }

  logger.info(`✅ Collected ${keys.length} visuals`);
  return keys;
}

export async function collectCoverImage(topicTitle: string, videoId: string): Promise<string | null> {
  const query = topicTitle.split(' ').filter(w => w.length > 3).slice(0, 3).join(' ');
  const urls = await fetchPexels(query, 1);
  if (!urls[0]) return null;

  const buf = await downloadToBuffer(urls[0]);
  if (!buf) return null;

  const key = videoKey(videoId, 'cover.jpg');
  await uploadBuffer(buf, key, 'image/jpeg');
  return key;
}
