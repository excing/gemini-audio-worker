const serializeValue = (value) => {
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const codeExecutionHandler = ({ code = '', timeout_ms = 3000 } = {}) => new Promise((resolve) => {
  const timeout = Math.max(1, Math.min(Number(timeout_ms) || 3000, 10000));
  const workerSource = `
    const serializeValue = ${serializeValue.toString()};
    const logs = [];
    ['log', 'info', 'warn', 'error'].forEach((level) => {
      console[level] = (...args) => logs.push({ level, message: args.map(serializeValue).join(' ') });
    });
    self.onmessage = async (event) => {
      try {
        const fn = new Function('"use strict"; return (async () => {\\n' + event.data + '\\n})()');
        const result = await fn();
        self.postMessage({ ok: true, result: serializeValue(result), logs });
      } catch (error) {
        self.postMessage({ ok: false, error: error?.stack || error?.message || String(error), logs });
      }
    };
  `;
  const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(blobUrl);
  const cleanup = () => {
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  };
  const timer = setTimeout(() => {
    cleanup();
    resolve({ ok: false, error: `Execution timed out after ${timeout}ms`, logs: [] });
  }, timeout);

  worker.onmessage = (event) => {
    clearTimeout(timer);
    cleanup();
    resolve(event.data);
  };
  worker.onerror = (error) => {
    clearTimeout(timer);
    cleanup();
    resolve({ ok: false, error: error.message || String(error), logs: [] });
  };
  worker.postMessage(String(code));
});

const renderPageHandler = ({ html = '' } = {}) => {
  const renderId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ok: true,
    render_id: renderId,
    message: '页面已渲染，并已加入消息列表。',
    sandbox: 'allow-scripts',
    origin: 'opaque',
  };
};

const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
};

const parseBooleanSelect = (value) => {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'false') return false;
  if (text === 'true') return true;
  return text;
};

const compactStringArray = (value) => Array.isArray(value)
  ? value.map((item) => String(item || '').trim()).filter(Boolean)
  : [];

const isReadableUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const jinaReaderHandler = async ({
  urls = [],
  max_chars = 12000,
  timeout_seconds = 30,
} = {}) => {
  const targetUrls = (Array.isArray(urls) ? urls : [urls])
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 5);
  if (!targetUrls.length) throw new Error('jinaReader 需要提供 URLs');

  const maxChars = clampNumber(max_chars, 12000, 1000, 50000);
  const timeoutSeconds = clampNumber(timeout_seconds, 30, 5, 120);

  const readUrl = async (targetUrl) => {
    if (!isReadableUrl(targetUrl)) {
      return { ok: false, requested_url: targetUrl, error: 'jinaReader 仅支持 http 和 https URL' };
    }

    const readerUrl = `https://r.jina.ai/${targetUrl}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(readerUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = { content: responseText };
      }
      if (!response.ok) {
        const message = data?.message || data?.error || response.statusText || 'Jina Reader request failed';
        throw new Error(`Jina Reader 请求失败 (${response.status}): ${serializeValue(message)}`);
      }

      const content = String(data?.data?.content ?? data?.content ?? responseText ?? '').trim();
      return {
        ok: true,
        requested_url: targetUrl,
        reader_url: readerUrl,
        url: data?.data?.url || data?.url || targetUrl,
        title: data?.data?.title || data?.title || '',
        content: content.slice(0, maxChars),
        truncated: content.length > maxChars,
        length: content.length,
        usage: data?.data?.usage || data?.usage || null,
      };
    } catch (error) {
      return {
        ok: false,
        requested_url: targetUrl,
        reader_url: readerUrl,
        error: error?.name === 'AbortError'
          ? `Jina Reader 请求超时 (${timeoutSeconds}s)`
          : (error?.message || String(error)),
      };
    } finally {
      window.clearTimeout(timer);
    }
  };

  const results = await Promise.all(targetUrls.map(readUrl));
  return { ok: true, source: 'jina-reader', results };
};

const tavilySearchHandler = async ({
  query = '',
  topic = 'general',
  search_depth = 'basic',
  max_results = 5,
  chunks_per_source,
  time_range = '',
  start_date = '',
  end_date = '',
  include_answer = 'false',
  include_raw_content = 'false',
  include_images = false,
  include_image_descriptions = false,
  include_domains = [],
  exclude_domains = [],
  auto_parameters = false,
} = {}, { apiKey = '', headers = {} } = {}) => {
  const searchQuery = String(query || '').trim();
  const tavilyApiKey = String(apiKey || '').trim();
  if (!searchQuery) throw new Error('Tavily search query 不能为空');
  if (!tavilyApiKey && !headers.Authorization && !headers.authorization) {
    throw new Error('Tavily API Key 未配置，请在系统配置的工具调用中为 tavilySearch 填写 API Key');
  }

  const body = {
    query: searchQuery,
    topic: ['general', 'news', 'finance'].includes(topic) ? topic : 'general',
    search_depth: search_depth === 'advanced' ? 'advanced' : 'basic',
    max_results: clampNumber(max_results, 5, 0, 20),
    include_answer: parseBooleanSelect(include_answer),
    include_raw_content: parseBooleanSelect(include_raw_content),
    include_images: Boolean(include_images),
    include_image_descriptions: Boolean(include_image_descriptions),
    auto_parameters: Boolean(auto_parameters),
  };

  if (body.search_depth === 'advanced' && chunks_per_source !== undefined) {
    body.chunks_per_source = clampNumber(chunks_per_source, 3, 1, 3);
  }
  if (time_range) body.time_range = String(time_range).trim();
  if (start_date) body.start_date = String(start_date).trim();
  if (end_date) body.end_date = String(end_date).trim();
  const includedDomains = compactStringArray(include_domains);
  const excludedDomains = compactStringArray(exclude_domains);
  if (includedDomains.length) body.include_domains = includedDomains;
  if (excludedDomains.length) body.exclude_domains = excludedDomains;

  const requestHeaders = {
    'Content-Type': 'application/json',
    ...(tavilyApiKey ? { Authorization: `Bearer ${tavilyApiKey}` } : {}),
    ...(headers && typeof headers === 'object' ? headers : {}),
  };

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = responseText;
  }
  if (!response.ok) {
    const message = data?.detail || data?.error || response.statusText || 'Tavily search failed';
    throw new Error(`Tavily search failed (${response.status}): ${serializeValue(message)}`);
  }
  return data;
};

const codeExecution = {
  name: 'codeExecution',
  configType: 'none',
  description: '在浏览器沙箱 Worker 中执行 JavaScript 代码，返回 console 输出、执行结果或错误。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的 JavaScript 代码。可使用 return 返回结果，也可使用 console.log 输出。',
      },
      timeout_ms: {
        type: 'number',
        description: '执行超时时间，默认 3000，最大 10000。',
      },
    },
    required: ['code'],
  },
  handler: codeExecutionHandler,
};

const renderPage = {
  name: 'renderPage',
  configType: 'none',
  description: '在页面内创建沙箱 iframe，渲染传入的完整 HTML 文档。iframe 使用独立 opaque origin，并仅允许脚本执行。',
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: '要渲染的完整 HTML 文档，包含所需的 CSS 和 JavaScript。',
      },
    },
    required: ['html'],
  },
  handler: renderPageHandler,
};

const jinaReader = {
  name: 'jinaReader',
  configType: 'none',
  description: '使用 r.jina.ai 服务获取网页内容工具, 当需要获取指定网页内容时, 调用此工具.',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        description: '要读取的网页或文档 URL 列表，最多 5 个。支持 http 和 https。',
        items: { type: 'string' },
      },
      max_chars: {
        type: 'number',
        description: '返回正文最大字符数，默认 12000，范围 1000-50000。',
      },
      timeout_seconds: {
        type: 'number',
        description: '请求超时时间，默认 30 秒，范围 5-120。',
      },
    },
    required: ['urls'],
  },
  handler: jinaReaderHandler,
};

const tavilySearch = {
  name: 'tavilySearch',
  configType: 'apiKey',
  description: '使用 Tavily Search API 执行联网搜索，返回答案、搜索结果、图片和响应时间等结构化数据。需要在工具配置中填写 Tavily API Key。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '要搜索的问题或关键词。',
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance'],
        description: '搜索主题分类。general 适合通用搜索，news 适合新闻，finance 适合财经。',
      },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: '搜索深度。basic 消耗较低，advanced 返回更相关的内容片段但成本更高。',
      },
      max_results: {
        type: 'number',
        description: '最大搜索结果数，范围 0-20，默认 5。',
      },
      chunks_per_source: {
        type: 'number',
        description: 'advanced 搜索下每个来源返回的内容片段数，范围 1-3。',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'],
        description: '按发布时间或更新时间过滤结果。',
      },
      start_date: {
        type: 'string',
        description: '开始日期，格式 YYYY-MM-DD。',
      },
      end_date: {
        type: 'string',
        description: '结束日期，格式 YYYY-MM-DD。',
      },
      include_answer: {
        type: 'string',
        enum: ['false', 'true', 'basic', 'advanced'],
        description: '是否返回 Tavily 生成的答案。basic/true 为简短答案，advanced 为更详细答案。',
      },
      include_raw_content: {
        type: 'string',
        enum: ['false', 'true', 'markdown', 'text'],
        description: '是否返回清洗后的页面正文。markdown/true 返回 Markdown，text 返回纯文本。',
      },
      include_images: {
        type: 'boolean',
        description: '是否包含图片结果。',
      },
      include_image_descriptions: {
        type: 'boolean',
        description: '图片结果是否包含描述。',
      },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '只包含这些域名的结果。',
      },
      exclude_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '排除这些域名的结果。',
      },
      auto_parameters: {
        type: 'boolean',
        description: '让 Tavily 根据查询自动配置部分搜索参数。可能增加 API credit 消耗。',
      },
    },
    required: ['query'],
  },
  handler: tavilySearchHandler,
};

export const tools = [
  codeExecution,
  renderPage,
  // jinaReader,
  tavilySearch,
];

export const toolDeclarations = tools.map(({ name, configType, description, parameters }) => ({
  name,
  configType,
  description,
  parameters,
}));

export const toolHandlers = Object.fromEntries(
  tools.map(({ name, handler }) => [name, handler]),
);

export const BROWSER_TOOLS = {
  declarations: toolDeclarations,
  handlers: toolHandlers,
};
