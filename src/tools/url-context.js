import { clampInteger, extractTitle, htmlToText, isAllowedFetchProtocol } from '../tool-utils.js';

const handler = async ({ urls = [], url = '', max_chars = 12000 } = {}) => {
  const requestedUrls = (Array.isArray(urls) ? urls : [urls])
    .concat(url ? [url] : [])
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 5);

  if (!requestedUrls.length) {
    throw new Error('urlContext 至少需要提供一个 URL');
  }

  const maxChars = clampInteger(max_chars, 12000, 1000, 50000);
  const results = [];

  for (const requestedUrl of requestedUrls) {
    if (!isAllowedFetchProtocol(requestedUrl)) {
      results.push({ url: requestedUrl, error: '仅支持 http 和 https URL' });
      continue;
    }

    try {
      const response = await fetch(requestedUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'gemini-audio-worker/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*;q=0.8',
        },
      });
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      const isHtml = /\bhtml\b/i.test(contentType) || /<html[\s>]/i.test(rawText);
      const text = isHtml ? htmlToText(rawText) : rawText.replace(/\s+/g, ' ').trim();

      results.push({
        url: response.url || requestedUrl,
        requested_url: requestedUrl,
        status: response.status,
        ok: response.ok,
        content_type: contentType,
        title: isHtml ? extractTitle(rawText) : '',
        text: text.slice(0, maxChars),
        truncated: text.length > maxChars,
        length: text.length,
      });
    } catch (error) {
      results.push({ url: requestedUrl, error: error.message || String(error) });
    }
  }

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
      url: {
        type: 'string',
        description: '单个要读取的 URL。当 urls 未提供时使用。',
      },
      max_chars: {
        type: 'number',
        description: '每个 URL 返回的正文最大字符数，默认 12000，最大 50000。',
      },
    },
  },
  handler,
};
