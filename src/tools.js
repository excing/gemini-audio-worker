export const toolDeclarations = [
  {
    name: 'get_weather',
    description: '查询 wttr.in 提供的天气信息。',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: '要查询的地点，例如 Beijing、Shanghai、London。留空则查询当前 IP 所在位置。',
        },
        lang: {
          type: 'string',
          description: '可选语言代码，例如 zh-cn 或 en。',
        },
      },
    },
  },
  {
    name: 'webSearch',
    description: '使用 DuckDuckGo HTML 搜索网页信息，返回标题、链接、摘要和可用的结果时间。',
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
  },
  {
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
  },
  {
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
  },
];

const decodeHtmlEntities = (value = '') => {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  };

  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (match, entity) => {
    const normalizedEntity = entity.toLowerCase();
    if (normalizedEntity.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalizedEntity.slice(2), 16));
    }
    if (normalizedEntity.startsWith('#')) {
      return String.fromCodePoint(parseInt(normalizedEntity.slice(1), 10));
    }
    return entities[normalizedEntity] || match;
  });
};

const stripHtml = (value = '') => decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

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

const clampInteger = (value, defaultValue, min, max) => Math.min(Math.max(Number.parseInt(value, 10) || defaultValue, min), max);

const isAllowedFetchProtocol = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const extractTitle = (html) => {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
};

const htmlToText = (html) => stripHtml(
  String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:br|p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, '\n'),
);

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

export const toolHandlers = {
  get_weather: async ({ location = '', lang = 'zh-cn' } = {}) => {
    const queryLocation = String(location || '').trim();
    const queryLang = String(lang || '').trim();
    const encodedLocation = queryLocation
      ? `/${encodeURIComponent(queryLocation).replace(/%20/g, '+')}`
      : '';
    const searchParams = new URLSearchParams({ format: 'j1' });

    if (queryLang) {
      searchParams.set('lang', queryLang);
    }

    const response = await fetch(`https://wttr.in${encodedLocation}?${searchParams.toString()}`, {
      headers: {
        'User-Agent': 'gemini-audio-worker/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`wttr.in 请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const current = Array.isArray(data.current_condition) ? data.current_condition[0] : null;
    const nearestArea = Array.isArray(data.nearest_area) ? data.nearest_area[0] : null;
    const weather = Array.isArray(data.weather) ? data.weather[0] : null;

    return {
      location: nearestArea
        ? {
            name: nearestArea.areaName?.[0]?.value || nearestArea.region?.[0]?.value || queryLocation || '当前定位',
            country: nearestArea.country?.[0]?.value || '',
            latitude: nearestArea.latitude || '',
            longitude: nearestArea.longitude || '',
          }
        : { name: queryLocation || '当前定位' },
      current: current
        ? {
            temperature_c: current.temp_C,
            feels_like_c: current.FeelsLikeC,
            humidity: current.humidity,
            weather: current.weatherDesc?.[0]?.value || '',
            wind_kph: current.windspeedKmph,
            wind_dir: current.winddir16Point,
            visibility_km: current.visibility,
            pressure_mb: current.pressure,
            uv_index: current.uvIndex,
          }
        : null,
      forecast: weather
        ? {
            date: weather.date,
            avg_temp_c: weather.avgtempC,
            max_temp_c: weather.maxtempC,
            min_temp_c: weather.mintempC,
            total_snow_cm: weather.totalSnow_cm,
            hourly: Array.isArray(weather.hourly)
              ? weather.hourly.slice(0, 4).map((hour) => ({
                  time: hour.time,
                  temp_c: hour.tempC,
                  chance_of_rain: hour.chanceofrain,
                  chance_of_snow: hour.chanceofsnow,
                  weather: hour.weatherDesc?.[0]?.value || '',
                }))
              : [],
          }
        : null,
      raw: {
        observation_time: current?.observation_time || '',
        source: 'wttr.in',
      },
    };
  },
  webSearch: async ({ query, max_results = 5, region = 'wt-wt', safe_search = 'moderate', timeRange = '' } = {}) => {
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
      headers: {
        'User-Agent': 'gemini-audio-worker/1.0',
        Accept: 'text/html,application/xhtml+xml',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
  },
  urlContext: async ({ urls = [], url = '', max_chars = 12000 } = {}) => {
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
  },
  fetch: async ({ url = '', method = 'GET', headers = {}, body, redirect = 'follow', response_type = 'auto', max_chars = 50000 } = {}) => {
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
      headers: normalizeHeaders(headers),
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
  },
};
