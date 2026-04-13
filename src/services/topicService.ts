import axios from 'axios';
import RSSParser from 'rss-parser';
import { Topic, ITopic } from '../config/database';
import { logger } from '../utils/logger';
import { config } from '../config/env';

const rss = new RSSParser({ timeout: 15_000 });

async function fetchGoogleTrends(): Promise<Array<{ title: string; score: number; source: string }>> {
  try {
    const feed = await rss.parseURL('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US');
    return (feed.items ?? []).slice(0, 8).map((item, i) => ({
      title: item.title ?? '',
      score: 100 - i * 5,
      source: 'google_trends',
    }));
  } catch { return []; }
}

async function fetchReddit(): Promise<Array<{ title: string; score: number; source: string }>> {
  const subs = ['technology', 'science', 'worldnews', 'todayilearned', 'explainlikeimfive'];
  const results: Array<{ title: string; score: number; source: string }> = [];

  for (const sub of subs) {
    try {
      const r = await axios.get(`https://www.reddit.com/r/${sub}/hot.json?limit=3`, {
        headers: { 'User-Agent': 'YTAIBot/2.0' },
        timeout: 8_000,
      });
      for (const post of r.data?.data?.children ?? []) {
        if (post.data.score > 500 && !post.data.stickied) {
          results.push({ title: post.data.title, score: Math.min(90, Math.floor(post.data.score / 200)), source: `reddit_${sub}` });
        }
      }
    } catch { continue; }
  }
  return results.slice(0, 8);
}

async function fetchHackerNews(): Promise<Array<{ title: string; score: number; source: string }>> {
  try {
    const ids = (await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8_000 })).data.slice(0, 5);
    const results = await Promise.allSettled(
      ids.map((id: number) => axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5_000 }))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.data?.title)
      .map(r => ({ title: r.value.data.title, score: 70, source: 'hackernews' }));
  } catch { return []; }
}

async function fetchRSS(): Promise<Array<{ title: string; score: number; source: string }>> {
  const feeds = [
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://www.theguardian.com/technology/rss',
  ];
  const results: Array<{ title: string; score: number; source: string }> = [];
  for (const url of feeds) {
    try {
      const feed = await rss.parseURL(url);
      const item = feed.items?.[0];
      if (item?.title) results.push({ title: item.title, score: 60, source: 'rss' });
    } catch { continue; }
  }
  return results;
}

export async function fetchTrendingTopics(channelId = 'default'): Promise<ITopic[]> {
  logger.info('🔍 Fetching trending topics...');

  const [g, r, hn, rssItems] = await Promise.allSettled([
    fetchGoogleTrends(), fetchReddit(), fetchHackerNews(), fetchRSS(),
  ]);

  const all = [
    ...(g.status === 'fulfilled' ? g.value : []),
    ...(r.status === 'fulfilled' ? r.value : []),
    ...(hn.status === 'fulfilled' ? hn.value : []),
    ...(rssItems.status === 'fulfilled' ? rssItems.value : []),
  ];

  const seen = new Set<string>();
  const unique = all
    .filter(t => { const k = t.title.toLowerCase().slice(0, 40); if (seen.has(k) || t.title.length < 15) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, config.pipeline.topicsPerRun);

  const saved: ITopic[] = [];
  for (const t of unique) {
    const exists = await Topic.findOne({ title: t.title });
    if (!exists) {
      const doc = await Topic.create({
        ...t,
        keywords: t.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 4),
        channelId,
      });
      saved.push(doc);
    }
  }

  logger.info(`✅ Saved ${saved.length} new topics`);
  return saved;
}

export async function getPendingTopics(channelId = 'default', limit = 2): Promise<ITopic[]> {
  return Topic.find({ status: 'pending', channelId }).sort({ score: -1 }).limit(limit);
}
