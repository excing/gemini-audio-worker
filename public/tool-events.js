const DISPLAY_NAMES = {
  imageGeneration: '图片生成',
  imageEditing: '图片编辑',
  get_weather: '天气查询',
  web_search: '网页搜索',
  duckduckgo_search: 'DuckDuckGo 搜索',
  fetch: '网络请求',
  urlContext: '网页内容',
  jinaReader: 'Jina阅读器',
  musicPlaylist: '音乐播放列表',
  codeExecution: '代码执行',
  renderPage: '页面渲染',
  checkDomainAvailability: '域名检查',
};

const MCP_SEPARATOR = '__';
const MCP_SERVER_LABELS = {
  github: 'GitHub',
};

const parseMcpToolName = (name) => {
  const idx = String(name || '').indexOf(MCP_SEPARATOR);
  if (idx <= 0) return null;
  return {
    server: name.slice(0, idx),
    tool: name.slice(idx + MCP_SEPARATOR.length),
  };
};

const extractMcpResponseText = (response) => {
  const contentList = Array.isArray(response?.content) ? response.content : [];
  return contentList
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n');
};

const formatMcpText = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return '```json\n' + JSON.stringify(JSON.parse(trimmed), null, 2) + '\n```';
    } catch {
      // not JSON, fall through
    }
  }
  return trimmed;
};

const formatMcpArgs = (args) => {
  if (!args || typeof args !== 'object') return '';
  const lines = [];
  for (const [key, value] of Object.entries(args)) {
    if (value == null || value === '') continue;
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    lines.push(valueStr.length > 200 ? `${key}: ${valueStr.slice(0, 200)}…` : `${key}: ${valueStr}`);
  }
  return lines.join('\n');
};

const IMAGE_DATA_URL_RE = /^data:(image\/[-.+a-z0-9]+);base64,([\s\S]+)$/i;
const imageBlobUrlCache = new Map();

const normalizeBase64Payload = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
};

const normalizeImageMimeType = (value = 'image/png') => {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  return /^image\/[-.+a-z0-9]+$/i.test(mimeType) ? mimeType : 'image/png';
};

const imageDataUrlToObjectUrl = (dataUrl) => {
  const sourceUrl = String(dataUrl || '').trim();
  const match = sourceUrl.match(IMAGE_DATA_URL_RE);
  if (!match) return sourceUrl;
  if (imageBlobUrlCache.has(sourceUrl)) return imageBlobUrlCache.get(sourceUrl);

  try {
    const mimeType = normalizeImageMimeType(match[1]);
    if (mimeType === 'image/svg+xml') return sourceUrl;
    const binary = atob(normalizeBase64Payload(match[2]));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    imageBlobUrlCache.set(sourceUrl, objectUrl);
    return objectUrl;
  } catch {
    return sourceUrl;
  }
};

const normalizeImageUrl = (url, mimeType = 'image/png') => {
  const value = String(url || '').trim();
  if (!value) return '';
  if (IMAGE_DATA_URL_RE.test(value)) return imageDataUrlToObjectUrl(value);
  if (/^[A-Za-z0-9+/=_-\s]+$/.test(value) && value.length > 128) {
    return imageDataUrlToObjectUrl(`data:${normalizeImageMimeType(mimeType)};base64,${value}`);
  }
  return value;
};

const normalizeImageBase64 = (base64, mimeType = 'image/png') => (
  imageDataUrlToObjectUrl(`data:${normalizeImageMimeType(mimeType)};base64,${base64}`)
);

const normalizeImage = (image) => {
  if (!image) return null;
  if (typeof image === 'string') return { url: normalizeImageUrl(image) };
  if (image.url) return { url: normalizeImageUrl(image.url, image.mime_type || image.mimeType) };
  if (image.b64_json) return { url: normalizeImageBase64(image.b64_json, image.mime_type || image.mimeType) };
  return null;
};

const getDomainAvailabilityPayload = (response) => {
  const contentList = Array.isArray(response?.content) ? response.content : [];
  const jsonEntry = contentList.find((item) => item?.type === 'json' && item?.data);
  return jsonEntry?.data && typeof jsonEntry.data === 'object' ? jsonEntry.data : null;
};

const formatUrlTitle = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.replace(/\/+$/, '');
    return path && path !== '/' ? `${hostname}${path}` : hostname;
  } catch {
    return url;
  }
};

const normalizeResultItem = (item) => {
  const url = String(item?.url || '').trim();
  const title = String(item?.title || item?.name || item?.source || '').trim();
  return {
    title: title || (url ? formatUrlTitle(url) : ''),
    url,
  };
};

// 从 args / response 派生 UI 展示字段，不保留旧 prompt/result 字段
const deriveDisplay = (name, args, response) => {
  const display = {};

  // MCP 工具（如 github__get_me）：参数转为 prompt，content 数组中的 text 转为响应文本
  const mcp = parseMcpToolName(name);
  if (mcp) {
    const argsPrompt = formatMcpArgs(args);
    if (argsPrompt) display.prompt = argsPrompt;
    const text = formatMcpText(extractMcpResponseText(response));
    if (text) display.text = text;
    return display;
  }

  // prompt 文本：各工具入参里的主要描述字段
  if (name === 'urlContext' || name === 'jinaReader') {
    const urlList = (Array.isArray(args?.urls) ? args.urls : []).filter(Boolean);
    if (urlList.length) display.prompt = urlList.join('\n');
  } else if (name === 'fetch') {
    const method = String(args?.method || 'GET').toUpperCase();
    const fetchUrl = String(args?.url || '').trim();
    if (fetchUrl) display.prompt = `${method} ${fetchUrl}`;
  } else {
    const promptValue = args?.prompt || args?.query || args?.keyword || args?.url || args?.code || '';
    if (promptValue) display.prompt = String(promptValue).trim();
  }

  // imageGeneration 专属：图片列表
  if (name === 'imageGeneration' || name === 'imageEditing') {
    const images = Array.isArray(response?.images) ? response.images : [];
    display.images = images.map(normalizeImage).filter(Boolean);
    if (response?.text) display.text = String(response.text).trim();
  }

  // web_search 专属：后端返回 { answer, sources }，前端展示为摘要 + 可点击来源列表
  if (name === 'web_search') {
    const answer = String(response?.answer || '').trim();
    if (answer) display.text = answer;

    const sources = Array.isArray(response?.sources) ? response.sources : [];
    if (sources.length) {
      display.results = sources
        .map(normalizeResultItem)
        .filter((item) => item.title || item.url);
    }
  }

  // 通用：带 title/url 的结果列表（如 webSearch），任何工具只要在 response.results
  // 里返回 [{ title, url }] 即可自动渲染为可折叠的标题列表
  const resultList = Array.isArray(response?.results) ? response.results : [];
  if (resultList.length && !display.results?.length) {
    display.results = resultList
      .map(normalizeResultItem)
      .filter((item) => item.title || item.url);
  }

  if (name === 'musicPlaylist') {
    const playlist = Array.isArray(response?.playlist) ? response.playlist : [];
    if (playlist.length) {
      display.playlist = playlist;
    }
  }

  // checkDomainAvailability 专属：域名检查结果
  if (name === 'checkDomainAvailability') {
    const data = getDomainAvailabilityPayload(response);
    const results = Array.isArray(data?.results) ? data.results : [];

    if (results.length) {
      const availableCount = results.filter((item) => item?.isRegistered === false).length;
      const registeredCount = results.filter((item) => item?.isRegistered === true).length;
      const totalCount = Number.isFinite(data?.count) ? data.count : results.length;

      display.prompt = '';
      display.text = `已检查 ${totalCount} 个域名，可注册 ${availableCount} 个，已注册 ${registeredCount} 个。`;
      display.results = results.map((item) => {
        const domain = [item?.label, item?.tld].filter(Boolean).join('.');
        const status = item?.isRegistered === false ? '✅' : item?.isRegistered === true ? '❌' : '❌';
        return {
          title: domain ? `${status} ${domain}` : status,
          url: String(item?.buy_url || '').trim(),
        };
      }).filter((item) => item.title || item.url);
    } else if (typeof data?.message === 'string' && data.message.trim()) {
      display.text = data.message.trim();
    }
  }

  // renderPage 专属：保留 HTML 源码，供卡片内「渲染页面 / 原代码」切换
  if (name === 'renderPage') {
    const htmlSource = String(args?.html || '').trim();
    if (htmlSource) display.html = htmlSource;
  }

  return display;
};

// 从 systemContent.toolCall payload 构建 messageGroups 条目
export const buildToolMessage = (payload) => {
  const { id, name, kind, status, args, response, error, startedAt, endedAt } = payload;
  const display = deriveDisplay(name, args, response);
  return {
    id: id || `tool-${Date.now()}`,
    type: 'toolCall',
    name: name || 'tool',
    kind: kind || 'worker',
    status: status || 'running',
    args: args ?? null,
    response: response ?? null,
    error: error ? String(error) : '',
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    ...display,
  };
};

// 幂等更新 messageGroups（Vue 响应式数组）
export const upsertToolMessage = (messageGroups, payload) => {
  const next = buildToolMessage(payload);
  for (let i = messageGroups.length - 1; i >= 0; i--) {
    const item = messageGroups[i];
    if (item.role === 'system' && item.message?.type === 'toolCall' && item.message.id === next.id) {
      messageGroups.splice(i, 1, { role: 'system', message: { ...item.message, ...next } });
      return;
    }
  }
  messageGroups.push({ role: 'system', message: next });
};

export const displayName = (name) => {
  if (DISPLAY_NAMES[name]) return DISPLAY_NAMES[name];
  const mcp = parseMcpToolName(name);
  if (mcp) {
    const label = MCP_SERVER_LABELS[mcp.server] || mcp.server;
    return `${label} · ${mcp.tool}`;
  }
  return name || '工具调用';
};

export const statusText = (status) => {
  if (status === 'done') return '完成';
  if (status === 'error') return '失败';
  return '进行中';
};
