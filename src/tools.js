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
};
