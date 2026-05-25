const DISPLAY_NAMES = {
  imageGeneration: '图片生成',
  get_weather: '天气查询',
  webSearch: '网页搜索',
  fetch: '网络请求',
  urlContext: '网页内容',
  codeExecution: '代码执行',
  renderPage: '页面渲染',
  checkDomainAvailability: '域名检查',
};

const normalizeImage = (image) => {
  if (!image) return null;
  if (typeof image === 'string') return { url: image };
  if (image.url) return { url: image.url };
  if (image.b64_json) return { url: `data:image/png;base64,${image.b64_json}` };
  return null;
};

const getDomainAvailabilityPayload = (response) => {
  const contentList = Array.isArray(response?.content) ? response.content : [];
  const jsonEntry = contentList.find((item) => item?.type === 'json' && item?.data);
  return jsonEntry?.data && typeof jsonEntry.data === 'object' ? jsonEntry.data : null;
};

// 从 args / response 派生 UI 展示字段，不保留旧 prompt/result 字段
const deriveDisplay = (name, args, response) => {
  const display = {};

  // prompt 文本：各工具入参里的主要描述字段
  if (name === 'urlContext') {
    const urlList = (Array.isArray(args?.urls) ? args.urls : []).filter(Boolean);
    if (urlList.length) display.prompt = urlList.join('\n');
  } else if (name === 'fetch') {
    const method = String(args?.method || 'GET').toUpperCase();
    const fetchUrl = String(args?.url || '').trim();
    if (fetchUrl) display.prompt = `${method} ${fetchUrl}`;
  } else if (name === 'checkDomainAvailability') {
    const domains = Array.isArray(args?.domains)
      ? args.domains
      : Array.isArray(response?.domains) ? response.domains : [];
    if (domains.length) display.prompt = domains.join('\n');
  } else {
    const promptValue = args?.prompt || args?.query || args?.url || args?.code || '';
    if (promptValue) display.prompt = String(promptValue).trim();
  }

  // imageGeneration 专属：图片列表
  if (name === 'imageGeneration') {
    const images = Array.isArray(response?.images) ? response.images : [];
    display.images = images.map(normalizeImage).filter(Boolean);
    if (response?.text) display.text = String(response.text).trim();
  }

  // 通用：带 title/url 的结果列表（如 webSearch），任何工具只要在 response.results
  // 里返回 [{ title, url }] 即可自动渲染为可折叠的标题列表
  const resultList = Array.isArray(response?.results) ? response.results : [];
  if (resultList.length) {
    display.results = resultList
      .map((item) => ({
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
      }))
      .filter((item) => item.title || item.url);
  }

  // checkDomainAvailability 专属：域名检查结果
  if (name === 'checkDomainAvailability') {
    const data = getDomainAvailabilityPayload(response);
    const results = Array.isArray(data?.results) ? data.results : [];

    if (results.length) {
      const availableCount = results.filter((item) => item?.isRegistered === false).length;
      const registeredCount = results.filter((item) => item?.isRegistered === true).length;
      const totalCount = Number.isFinite(data?.count) ? data.count : results.length;

      display.text = `已检查 ${totalCount} 个域名，可注册 ${availableCount} 个，已注册 ${registeredCount} 个。`;
      display.results = results.map((item) => {
        const domain = [item?.label, item?.tld].filter(Boolean).join('.');
        const status = item?.isRegistered === false ? '可注册' : item?.isRegistered === true ? '已注册' : '状态未知';
        return {
          title: domain ? `${domain} · ${status}` : status,
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

export const displayName = (name) => DISPLAY_NAMES[name] || name || '工具调用';

export const statusText = (status) => {
  if (status === 'done') return '完成';
  if (status === 'error') return '失败';
  return '进行中';
};
