import { clampInteger, isAllowedFetchProtocol, withBrowserUserAgent } from '../tool-utils.js';

const normalizeHeaders = (headers = {}) => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => key && value !== undefined && value !== null)
      .map(([key, value]) => [String(key), String(value)]),
  );
};

const collectResponseHeaders = (headers) => {
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const getFetchResponseBody = async (response, responseType, maxChars) => {
  const contentType = response.headers.get('content-type') || '';
  const normalizedType = String(responseType || 'auto').trim().toLowerCase();
  const type = ['auto', 'text', 'json', 'base64', 'none'].includes(normalizedType) ? normalizedType : 'auto';

  if (type === 'none' || response.status === 204 || response.status === 304) {
    return { body: null, body_type: 'none', truncated: false, length: 0 };
  }

  if (type === 'base64') {
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    return {
      body: base64.slice(0, maxChars),
      body_type: 'base64',
      truncated: base64.length > maxChars,
      length: base64.length,
    };
  }

  const text = await response.text();
  if (type === 'json' || (type === 'auto' && /\bjson\b/i.test(contentType))) {
    try {
      return { body: JSON.parse(text), body_type: 'json', truncated: false, length: text.length };
    } catch {
      return {
        body: text.slice(0, maxChars),
        body_type: 'text',
        parse_error: 'JSON 解析失败，已按文本返回',
        truncated: text.length > maxChars,
        length: text.length,
      };
    }
  }

  return {
    body: text.slice(0, maxChars),
    body_type: 'text',
    truncated: text.length > maxChars,
    length: text.length,
  };
};

const handler = async (id, name, { url = '', method = 'GET', headers = {}, body, redirect = 'follow', response_type = 'auto', max_chars = 50000 } = {}) => {
  const requestedUrl = String(url || '').trim();
  if (!requestedUrl) {
    throw new Error('fetch URL 不能为空');
  }
  if (!isAllowedFetchProtocol(requestedUrl)) {
    throw new Error('fetch 仅支持 http 和 https URL');
  }

  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  if (!allowedMethods.includes(normalizedMethod)) {
    throw new Error(`不支持的 HTTP 方法: ${normalizedMethod}`);
  }

  const normalizedRedirect = String(redirect || 'follow').trim().toLowerCase();
  const redirectMode = ['follow', 'manual', 'error'].includes(normalizedRedirect) ? normalizedRedirect : 'follow';
  const requestInit = {
    method: normalizedMethod,
    headers: withBrowserUserAgent(normalizeHeaders(headers)),
    redirect: redirectMode,
  };

  if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(normalizedMethod)) {
    requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(requestedUrl, requestInit);
  const maxChars = clampInteger(max_chars, 50000, 0, 200000);
  const bodyResult = normalizedMethod === 'HEAD'
    ? { body: null, body_type: 'none', truncated: false, length: 0 }
    : await getFetchResponseBody(response, response_type, maxChars);

  return {
    url: response.url || requestedUrl,
    requested_url: requestedUrl,
    status: response.status,
    status_text: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
    headers: collectResponseHeaders(response.headers),
    ...bodyResult,
  };
};

export default {
  name: 'fetch',
  description: '执行通用 HTTP(S) fetch 请求，支持方法、请求头、请求体、重定向模式和响应格式选择。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要请求的 http 或 https URL。',
      },
      method: {
        type: 'string',
        description: 'HTTP 方法，例如 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS。默认 GET。',
      },
      headers: {
        type: 'object',
        description: '请求头键值对象。',
      },
      body: {
        type: 'string',
        description: '请求体字符串。对象请先 JSON.stringify，并设置 Content-Type。GET/HEAD 不应提供 body。',
      },
      redirect: {
        type: 'string',
        description: '重定向策略：follow、manual 或 error。默认 follow。',
      },
      response_type: {
        type: 'string',
        description: '响应解析方式：auto、text、json、base64、none。默认 auto。',
      },
      max_chars: {
        type: 'number',
        description: '文本或 base64 响应最大返回字符数，默认 50000，最大 200000。',
      },
    },
    required: ['url'],
  },
  handler,
};
