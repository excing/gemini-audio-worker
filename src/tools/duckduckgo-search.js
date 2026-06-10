import { decodeHtmlEntities, stripHtml, withBrowserUserAgent } from '../tool-utils.js';

const normalizeDuckDuckGoUrl = (value = '') => {
  const decodedValue = decodeHtmlEntities(value).trim();

  try {
    const url = new URL(decodedValue, 'https://duckduckgo.com');
    const redirectedUrl = url.searchParams.get('uddg');
    return redirectedUrl ? decodeURIComponent(redirectedUrl) : url.href;
  } catch {
    return decodedValue;
  }
};

const extractDuckDuckGoResultDate = (block) => {
  const extrasMatch = block.match(/<div[^>]+class="[^"]*result__extras[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (!extrasMatch) return '';

  const extrasText = stripHtml(extrasMatch[1]);
  const dateMatch = extrasText.match(/\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?\b/);
  return dateMatch ? dateMatch[0] : '';
};

const parseDuckDuckGoResults = (html, maxResults) => {
  const results = [];
  const titleRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seenUrls = new Set();
  const titleMatches = [...html.matchAll(titleRegex)];

  for (let index = 0; index < titleMatches.length && results.length < maxResults; index += 1) {
    const titleMatch = titleMatches[index];
    const nextTitleMatch = titleMatches[index + 1];
    const block = html.slice(titleMatch.index, nextTitleMatch?.index || html.length);

    const url = normalizeDuckDuckGoUrl(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    const date = extractDuckDuckGoResultDate(block);

    if (!title || !url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({ title, url, snippet, date });
  }

  return results;
};

const handler = async (id, name, { query, max_results = 5, region = 'wt-wt', safe_search = 'moderate', timeRange = '' } = {}) => {
  const searchQuery = String(query || '').trim();
  if (!searchQuery) {
    throw new Error('DuckDuckGo 搜索关键词不能为空');
  }

  const maxResults = Math.min(Math.max(Number.parseInt(max_results, 10) || 5, 1), 10);
  const safeSearchMap = {
    strict: '1',
    moderate: '-1',
    off: '-2',
  };
  const searchParams = new URLSearchParams({
    q: searchQuery,
    kl: String(region || '').trim() || '',
    kp: safeSearchMap[String(safe_search || 'moderate').trim().toLowerCase()] || '-1',
  });
  const _timeRange = String(timeRange || '').trim().toLowerCase();

  if (['d', 'w', 'm', 'y'].includes(_timeRange)) {
    searchParams.set('df', _timeRange);
  }

  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: withBrowserUserAgent({
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: searchParams.toString(),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo 请求失败: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  return {
    query: searchQuery,
    results: parseDuckDuckGoResults(html, maxResults),
    raw: {
      source: 'DuckDuckGo HTML',
      endpoint: 'https://html.duckduckgo.com/html/',
    },
  };
};

export default {
  name: 'duckduckgo_search',
  description: '使用 DuckDuckGo 搜索引擎联网搜索网页信息，返回标题、链接、摘要和可用的结果时间。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。',
      },
      max_results: {
        type: 'number',
        description: '最多返回结果数量，默认 5，最大 10。',
      },
      region: {
        type: 'string',
        description: '可选地区代码，例如 wt-wt、us-en、cn-zh。默认 wt-wt。',
      },
      safe_search: {
        type: 'string',
        description: '安全搜索级别：strict、moderate 或 off。默认 moderate。',
      },
      timeRange: {
        type: 'string',
        description: '可选时间范围：d(最近一天)、w(最近一周)、m(最近一月)、y(最近一年)，不填表示所有时间。',
      },
    },
    required: ['query'],
  },
  handler,
};
