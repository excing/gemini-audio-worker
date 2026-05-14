const handler = async ({ location = '', lang = 'zh-cn' } = {}) => {
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
};

export default {
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
  handler,
};
