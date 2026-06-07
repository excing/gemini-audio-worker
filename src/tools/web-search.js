import { withBrowserUserAgent } from '../tool-utils.js';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const SEARCH_EFFORT_VALUES = new Set(['low', 'medium', 'high']);

const SEARCH_PROMPT = `You are an expert web research assistant with access to real-time web search.

Search the web thoroughly before answering. Prefer authoritative, primary, and recent sources when recency matters.
Cross-check important claims across multiple sources. Include concise citations as URLs in a final Sources section.
Answer in the user's language unless the user asks otherwise.`;

const getLocalTimeInfo = () => {
  const now = new Date();
  return [
    `Current date: ${now.toISOString().slice(0, 10)}`,
    `Current time: ${now.toISOString()}`,
  ].join('\n');
};

const buildUserPrompt = (query, platform) => {
  const parts = [
    getLocalTimeInfo(),
    '',
    `Search query: ${query}`,
  ];

  const platformText = String(platform || '').trim();
  if (platformText) {
    parts.push('', `Focus on these platforms or source types when relevant: ${platformText}`);
  }

  return parts.join('\n');
};

const parseJsonOrRaw = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return { raw: value };
  }
};

const extractUrls = (text) => {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const seen = new Set();
  const urls = [];

  for (const match of String(text || '').matchAll(urlRegex)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
};

const splitAnswerAndSources = (text) => {
  const value = String(text || '').trim();
  const sourcesHeading = value.match(/\n(?:#{1,6}\s*)?(?:sources|references|citations|信源|来源|参考资料)[:：]?\s*\n/i);

  if (!sourcesHeading) {
    const urls = extractUrls(value);
    return {
      answer: value,
      sources: urls.map((url) => ({ url })),
    };
  }

  const answer = value.slice(0, sourcesHeading.index).trim();
  const sourcesText = value.slice(sourcesHeading.index + sourcesHeading[0].length).trim();
  const urls = extractUrls(sourcesText);

  return {
    answer: answer || value,
    sources: urls.map((url) => ({ url })),
  };
};

const handler = async (id, name, { query = '', platform = '', effort = 'medium' } = {}, { env }) => {
  const searchQuery = String(query || '').trim();
  if (!searchQuery) {
    throw new Error('web_search 搜索关键词不能为空');
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('Worker 缺少 OPENAI_API_KEY secret');
  }

  const model = String(env.OPENAI_SEARCH_MODEL || '').trim();
  if (!model) {
    throw new Error('Worker 缺少 OPENAI_SEARCH_MODEL 配置');
  }

  const searchEffort = SEARCH_EFFORT_VALUES.has(effort) ? effort : 'medium';
  const baseUrl = trimTrailingSlash(env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: withBrowserUserAgent({
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      model: `${model}-${searchEffort}`,
      messages: [
        { role: 'system', content: SEARCH_PROMPT },
        { role: 'user', content: buildUserPrompt(searchQuery, platform) },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`web_search 请求失败: ${response.status} ${response.statusText}: ${errorText}`);
  }

  const raw = parseJsonOrRaw(await response.text());
  const answerText = raw?.choices?.[0]?.message?.content || '';

  if (!answerText.trim()) {
    throw new Error('web_search 未返回有效内容');
  }

  const { answer, sources } = splitAnswerAndSources(answerText);

  return {
    query: searchQuery,
    answer,
    sources,
    sources_count: sources.length,
  };
};

export default {
  name: 'web_search',
  description: '联网搜索网页信息，返回标题、链接、摘要和可用的结果时间。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词或需要调研的问题。',
      },
      platform: {
        type: 'string',
        description: '可选，聚焦的平台或来源类型，例如 GitHub、Reddit、官方文档、新闻网站。',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh'],
        default: 'medium',
        description: '可选，控制搜索模型的思考程度。当用户要求简单搜索时，使用 low，用户要求深度搜索时使用 high 或 xhigh。默认 medium。',
      },
    },
    required: ['query'],
  },
  handler,
};
