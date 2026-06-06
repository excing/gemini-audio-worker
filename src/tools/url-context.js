import { clampInteger, extractTitle, htmlToText, isAllowedFetchProtocol, REAL_BROWSER_USER_AGENT, withBrowserUserAgent } from '../tool-utils.js';

const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';
const DYNAMIC_PAGE_MIN_TEXT_LENGTH = 100;

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const fetchPrimary = async (requestedUrl, maxChars) => {
  try {
    const response = await fetch(requestedUrl, {
      redirect: 'follow',
      headers: withBrowserUserAgent({
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*;q=0.8',
      }, REAL_BROWSER_USER_AGENT),
    });
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const isHtml = /\bhtml\b/i.test(contentType) || /<html[\s>]/i.test(rawText);
    const text = isHtml ? htmlToText(rawText) : rawText.replace(/\s+/g, ' ').trim();

    let fallbackReason = null;
    if (response.status >= 400 && response.status < 500) fallbackReason = `http_${response.status}`;
    else if (isHtml && text.length < DYNAMIC_PAGE_MIN_TEXT_LENGTH) fallbackReason = 'dynamic_or_empty';

    return {
      fallbackReason,
      payload: {
        url: response.url || requestedUrl,
        requested_url: requestedUrl,
        status: response.status,
        ok: response.ok,
        content_type: contentType,
        title: isHtml ? extractTitle(rawText) : '',
        text: text.slice(0, maxChars),
        truncated: text.length > maxChars,
        length: text.length,
      },
    };
  } catch (error) {
    const message = error.message || String(error);
    return {
      fallbackReason: `fetch_failed: ${message}`,
      payload: { url: requestedUrl, error: message },
    };
  }
};

const extractWithTavily = async (env, urls) => {
  const apiKey = String(env?.TAVILY_API_KEY || '').trim();
  if (!apiKey) throw new Error('Worker 缺少 TAVILY_API_KEY secret');

  const baseUrl = trimTrailingSlash(env?.TAVILY_BASE_URL || TAVILY_DEFAULT_BASE_URL);
  const response = await fetch(`${baseUrl}/extract`, {
    method: 'POST',
    headers: withBrowserUserAgent({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ urls, extract_depth: 'basic', format: 'text' }),
  });
  if (!response.ok) {
    throw new Error(`Tavily extract 请求失败: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const byUrl = new Map();
  for (const item of payload?.results || []) {
    if (item?.url) byUrl.set(item.url, String(item.raw_content || '').trim());
  }
  return byUrl;
};

const handler = async (id, name, { urls = [], max_chars = 12000 } = {}, ctx = {}) => {
  const requestedUrls = (Array.isArray(urls) ? urls : [urls])
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 5);

  if (!requestedUrls.length) throw new Error('urlContext 至少需要提供一个 URL');

  const maxChars = clampInteger(max_chars, 12000, 1000, 50000);

  const items = await Promise.all(requestedUrls.map(async (url) => {
    if (!isAllowedFetchProtocol(url)) {
      return { url, fallbackReason: null, payload: { url, error: '仅支持 http 和 https URL' } };
    }
    return { url, ...(await fetchPrimary(url, maxChars)) };
  }));

  const fallbackUrls = items.filter((item) => item.fallbackReason).map((item) => item.url);
  let tavilyByUrl = new Map();
  let tavilyError = null;
  if (fallbackUrls.length) {
    try {
      tavilyByUrl = await extractWithTavily(ctx?.env || {}, fallbackUrls);
    } catch (error) {
      tavilyError = error.message || String(error);
    }
  }

  const results = items.map(({ url, fallbackReason, payload }) => {
    if (!fallbackReason) return payload;
    const text = tavilyByUrl.get(url);
    if (text) {
      return {
        url,
        requested_url: url,
        source: 'tavily',
        fallback_reason: fallbackReason,
        text: text.slice(0, maxChars),
        truncated: text.length > maxChars,
        length: text.length,
      };
    }
    return {
      ...payload,
      fallback_reason: fallbackReason,
      fallback_error: tavilyError || 'Tavily 未返回该 URL 的内容',
    };
  });

  return { results };
};

export default {
  name: 'urlContext',
  description: '抓取一个或多个 URL 的页面内容，返回状态、标题、正文摘要和内容类型。',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        description: '要读取的 URL 列表，最多 5 个。',
        items: { type: 'string' },
      },
      max_chars: {
        type: 'number',
        description: '每个 URL 返回的正文最大字符数，默认 12000，最大 50000。',
      },
    },
  },
  handler,
};
