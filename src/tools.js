const DOMAIN_CHECK_MCP_URL = 'https://api.instantdomainsearch.com/mcp';

const callDomainCheckMcp = async (name, args) => {
  const response = await fetch(DOMAIN_CHECK_MCP_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Domain Check MCP 请求失败: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  if (payload?.error) {
    throw new Error(payload.error.message || JSON.stringify(payload.error));
  }

  return normalizeMcpToolResult(payload?.result ?? payload);
};

const normalizeMcpToolResult = (result) => {
  if (!Array.isArray(result?.content)) return result;

  const textItems = result.content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);
  const jsonText = textItems.find((text) => text.startsWith('{'));

  if (!jsonText) return result;

  const parsedJson = parseLeadingJson(jsonText);
  if (!parsedJson) return result;

  return {
    ...parsedJson,
    mcp_text: textItems.join('\n\n'),
  };
};

const parseLeadingJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const endIndex = text.lastIndexOf('}');
    if (endIndex === -1) return null;

    try {
      return JSON.parse(text.slice(0, endIndex + 1));
    } catch {
      return null;
    }
  }
};

const normalizeLimit = (limit, fallback = 32) => {
  const parsedLimit = Number.parseInt(limit, 10);
  if (Number.isNaN(parsedLimit)) return fallback;
  return Math.min(Math.max(parsedLimit, 1), 100);
};

const normalizeStringArray = (values) => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter(Boolean);
};

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
    name: 'search_domains',
    description: 'Search for domain availability and suggestions.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The domain name to search for (without TLD).',
        },
        tlds: {
          type: 'array',
          description: "List of TLDs to check (e.g., ['com', 'net', 'org']). Optional, defaults to popular TLDs.",
          items: { type: 'string' },
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Optional, defaults to 32.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'generate_domain_variations',
    description: 'Generate domain name variations with prefixes and suffixes.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The base domain name.',
        },
        sort: {
          type: 'string',
          description: "Sort method for results. Optional, defaults to 'rank'.",
          enum: ['rank', 'distance'],
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Optional, defaults to 32.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_domain_availability',
    description: 'Check availability of specific domains via DNS.',
    parameters: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          description: "List of full domain names to check (e.g., ['example.com', 'test.net']).",
          items: { type: 'string' },
        },
      },
      required: ['domains'],
    },
  },
];

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
  search_domains: async ({ name, tlds, limit = 32 } = {}) => {
    const domainName = String(name || '').trim();
    const normalizedTlds = normalizeStringArray(tlds);
    if (!domainName) throw new Error('name is required');

    return callDomainCheckMcp('search_domains', {
      name: domainName,
      ...(normalizedTlds.length ? { tlds: normalizedTlds } : {}),
      limit: normalizeLimit(limit),
    });
  },
  generate_domain_variations: async ({ name, sort = 'rank', limit = 32 } = {}) => {
    const domainName = String(name || '').trim();
    const sortMethod = String(sort || 'rank').trim();
    if (!domainName) throw new Error('name is required');
    if (!['rank', 'distance'].includes(sortMethod)) throw new Error('sort must be rank or distance');

    return callDomainCheckMcp('generate_domain_variations', {
      name: domainName,
      sort: sortMethod,
      limit: normalizeLimit(limit),
    });
  },
  check_domain_availability: async ({ domains } = {}) => {
    const normalizedDomains = normalizeStringArray(domains);
    if (!normalizedDomains.length) throw new Error('domains is required');

    return callDomainCheckMcp('check_domain_availability', {
      domains: normalizedDomains,
    });
  },
};
