export const decodeHtmlEntities = (value = '') => {
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

export const stripHtml = (value = '') => decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export const clampInteger = (value, defaultValue, min, max) => Math.min(Math.max(Number.parseInt(value, 10) || defaultValue, min), max);

export const isAllowedFetchProtocol = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export const DEFAULT_FETCH_USER_AGENT = 'gemini-audio-worker/1.0';
export const REAL_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

export const buildBrowserUserAgent = (currentUserAgent = DEFAULT_FETCH_USER_AGENT) => {
  const normalizedUserAgent = String(currentUserAgent || '').trim();
  if (!normalizedUserAgent) return REAL_BROWSER_USER_AGENT;
  if (normalizedUserAgent.includes(REAL_BROWSER_USER_AGENT)) return normalizedUserAgent;
  return `${REAL_BROWSER_USER_AGENT} ${normalizedUserAgent}`;
};

export const withBrowserUserAgent = (headers = {}, fallbackUserAgent = DEFAULT_FETCH_USER_AGENT) => {
  const result = headers && typeof headers === 'object' && !Array.isArray(headers) ? { ...headers } : {};
  const userAgentKey = Object.keys(result).find((key) => key.toLowerCase() === 'user-agent');
  const currentUserAgent = userAgentKey ? result[userAgentKey] : fallbackUserAgent;

  if (userAgentKey && userAgentKey !== 'User-Agent') {
    delete result[userAgentKey];
  }

  result['User-Agent'] = buildBrowserUserAgent(currentUserAgent);
  return result;
};

export const extractTitle = (html) => {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
};

export const htmlToText = (html) => stripHtml(
  String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:br|p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, '\n'),
);

const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const IMAGE_DATA_URL_RE = /^data:(image\/[-.+a-z0-9]+);base64,([\s\S]+)$/i;
const IMAGE_RESPONSE_TOOL_NAMES = new Set(['imageGeneration', 'imageEditing']);

export const normalizeImageMimeType = (mimeType = DEFAULT_IMAGE_MIME_TYPE) => {
  const value = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return /^image\/[-.+a-z0-9]+$/i.test(value) ? value : DEFAULT_IMAGE_MIME_TYPE;
};

const normalizeImageBase64 = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '');

  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
};

const isLikelyImageBase64 = (value) => {
  const normalized = normalizeImageBase64(value);
  return normalized.length > 0
    && normalized.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
};

export const imageBase64ToBytes = (base64, errorMessage = '图片 base64 无效') => {
  const normalized = normalizeImageBase64(base64);
  if (!isLikelyImageBase64(normalized)) {
    throw new Error(errorMessage);
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, base64: normalized };
};

const extensionFromImageMimeType = (mimeType) => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
};

const safeKeySegment = (value, fallback) => (
  String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || fallback
);

const getImageBucket = (env) => {
  const bucket = env?.IMAGE_BUCKET || env?.R2_BUCKET;
  if (!bucket?.put) throw new Error('Worker 缺少 IMAGE_BUCKET R2 binding');
  return bucket;
};

export const buildPublicImageUrl = (env, key) => {
  const baseUrl = String(env?.IMAGE_PUBLIC_BASE_URL || env?.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Worker 缺少 IMAGE_PUBLIC_BASE_URL 或 R2_PUBLIC_BASE_URL 配置');
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

export const uploadImageBase64ToR2 = async (
  env,
  {
    base64,
    mimeType = DEFAULT_IMAGE_MIME_TYPE,
    keyPrefix = 'tool-images',
    source = 'tool-response',
  } = {},
) => {
  const normalizedMimeType = normalizeImageMimeType(mimeType);
  const { bytes, base64: normalizedBase64 } = imageBase64ToBytes(base64);
  const bucket = getImageBucket(env);
  const date = new Date().toISOString().slice(0, 10);
  const key = `media/${safeKeySegment(keyPrefix, 'tool-images')}/${date}/${crypto.randomUUID()}.${extensionFromImageMimeType(normalizedMimeType)}`;

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: normalizedMimeType },
    customMetadata: { source },
  });

  return {
    base64: normalizedBase64,
    key,
    mimeType: normalizedMimeType,
    url: buildPublicImageUrl(env, key),
  };
};

export const uploadRealtimeImageToR2 = async (env, image) => {
  const rawData = image?.data || image?.base64;
  const mimeType = normalizeImageMimeType(image?.mimeType || image?.mime_type);
  const uploaded = await uploadImageBase64ToR2(env, {
    base64: rawData,
    mimeType,
    keyPrefix: 'chat-images',
    source: 'realtimeInput.image',
  });

  return {
    base64: uploaded.base64,
    mimeType: uploaded.mimeType,
    url: uploaded.url,
  };
};

const getImagePayload = (value, fallbackMimeType = DEFAULT_IMAGE_MIME_TYPE) => {
  const text = String(value || '').trim();
  if (!text || isAllowedFetchProtocol(text)) return null;

  const dataUrlMatch = text.match(IMAGE_DATA_URL_RE);
  if (dataUrlMatch) {
    return {
      base64: dataUrlMatch[2],
      mimeType: normalizeImageMimeType(dataUrlMatch[1]),
    };
  }

  if (text.length > 128 && isLikelyImageBase64(text)) {
    return {
      base64: text,
      mimeType: normalizeImageMimeType(fallbackMimeType),
    };
  }

  return null;
};

const uploadToolImageValueToR2 = async (env, value, fallbackMimeType, toolName) => {
  const payload = getImagePayload(value, fallbackMimeType);
  if (!payload) return null;

  return uploadImageBase64ToR2(env, {
    ...payload,
    keyPrefix: `tool-images-${safeKeySegment(toolName, 'tool')}`,
    source: `tool-response:${toolName}`,
  });
};

const omitToolImageBase64Fields = (image) => {
  const result = { ...image };
  delete result.b64_json;
  delete result.base64;
  delete result.data;
  return result;
};

const formatUploadedToolImage = (image, uploaded) => ({
  ...omitToolImageBase64Fields(image),
  url: uploaded.url,
  mimeType: uploaded.mimeType,
});

const uploadToolImageResultItemToR2 = async (env, image, toolName) => {
  if (!image) return image;

  if (typeof image === 'string') {
    const uploaded = await uploadToolImageValueToR2(env, image, DEFAULT_IMAGE_MIME_TYPE, toolName);
    return uploaded ? { url: uploaded.url, mimeType: uploaded.mimeType } : image;
  }

  if (typeof image !== 'object') return image;

  const fallbackMimeType = normalizeImageMimeType(image.mimeType || image.mime_type);
  if (image.b64_json) {
    const uploaded = await uploadImageBase64ToR2(env, {
      base64: image.b64_json,
      mimeType: fallbackMimeType,
      keyPrefix: `tool-images-${safeKeySegment(toolName, 'tool')}`,
      source: `tool-response:${toolName}`,
    });
    return formatUploadedToolImage(image, uploaded);
  }

  if (image.url) {
    const uploaded = await uploadToolImageValueToR2(env, image.url, fallbackMimeType, toolName);
    if (uploaded) return formatUploadedToolImage(image, uploaded);
  }

  if (image.image_url?.url) {
    const uploaded = await uploadToolImageValueToR2(env, image.image_url.url, fallbackMimeType, toolName);
    if (uploaded) {
      return {
        ...omitToolImageBase64Fields(image),
        url: uploaded.url,
        image_url: {
          ...image.image_url,
          url: uploaded.url,
        },
        mimeType: uploaded.mimeType,
      };
    }
  }

  if (image.base64 || image.data) {
    const uploaded = await uploadToolImageValueToR2(env, image.base64 || image.data, fallbackMimeType, toolName);
    if (uploaded) {
      return formatUploadedToolImage(image, uploaded);
    }
  }

  return image;
};

export const uploadToolResponseMediaToR2 = async (name, response, env) => {
  if (!IMAGE_RESPONSE_TOOL_NAMES.has(name) || !response || typeof response !== 'object') {
    return response;
  }

  const images = Array.isArray(response.images) ? response.images : [];
  if (!images.length) return response;

  try {
    return {
      ...response,
      images: await Promise.all(images.map((image) => uploadToolImageResultItemToR2(env, image, name))),
    };
  } catch {
    return response;
  }
};
