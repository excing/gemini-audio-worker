import { isAllowedFetchProtocol, withBrowserUserAgent } from '../tool-utils.js';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const normalizeImages = (images) => {
  const values = Array.isArray(images) ? images : [];

  return values
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index);
};

const normalizeMimeType = (mimeType = 'image/png') => {
  const value = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return /^image\/[-.+a-z0-9]+$/i.test(value) ? value : 'image/png';
};

const normalizeBase64 = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/-/g, '+')
  .replace(/_/g, '/')
  .replace(/=+$/, '')
  .padEnd(Math.ceil(String(value || '').trim().replace(/\s+/g, '').replace(/=+$/, '').length / 4) * 4, '=');

const isLikelyBase64 = (value) => {
  const normalized = normalizeBase64(value);
  return normalized.length > 0
    && normalized.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
};

const toDataUrl = (base64, mimeType = 'image/png') => {
  const dataUrlMatch = String(base64 || '').trim().match(/^data:(image\/[-.+a-z0-9]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    const normalizedBase64 = normalizeBase64(dataUrlMatch[2]);
    if (!isLikelyBase64(normalizedBase64)) throw new Error('图片 data URL 中的 base64 无效');
    return `data:${normalizeMimeType(dataUrlMatch[1])};base64,${normalizedBase64}`;
  }

  const normalizedBase64 = normalizeBase64(base64);
  if (!isLikelyBase64(normalizedBase64)) {
    throw new Error('图片必须是 http(s) 链接、image data URL 或纯 base64');
  }
  return `data:${normalizeMimeType(mimeType)};base64,${normalizedBase64}`;
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const imageToDataUrl = async (image, fallbackMimeType = 'image/png') => {
  if (isAllowedFetchProtocol(image)) {
    const response = await fetch(image, {
      redirect: 'follow',
      headers: withBrowserUserAgent({
        Accept: 'image/*,*/*;q=0.8',
      }),
    });

    if (!response.ok) {
      throw new Error(`图片下载失败: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || fallbackMimeType;
    if (!/^image\//i.test(contentType)) {
      throw new Error(`图片下载结果不是图片类型: ${contentType}`);
    }

    return toDataUrl(arrayBufferToBase64(await response.arrayBuffer()), contentType);
  }

  return toDataUrl(image, fallbackMimeType);
};

const imagesToDataUrls = async (images, fallbackMimeType = 'image/png') => Promise.all(
  normalizeImages(images).map((item) => imageToDataUrl(item, fallbackMimeType)),
);

const collectImageResults = (content) => {
  const images = [];
  const texts = [];

  const collect = (item) => {
    if (!item) return;

    if (typeof item === 'string') {
      const dataUrls = item.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=_-]+/g)
                    || item.match(/https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi)
                    || [];
      if (dataUrls.length) {
        images.push(...dataUrls.map((url) => ({ url })));
      } else {
        texts.push(item);
      }
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }

    if (typeof item !== 'object') return;

    if (item.b64_json) {
      images.push({ b64_json: item.b64_json });
      return;
    }

    if (item.image_url?.url) {
      images.push({ url: item.image_url.url });
      return;
    }

    if (item.url && /^data:image\/[^;]+;base64,/i.test(item.url)) {
      images.push({ url: item.url });
      return;
    }

    if (item.text) texts.push(String(item.text));
  };

  collect(content);
  return { images, text: texts.join('\n').trim() };
};

const formatImageGenerationResponse = (result) => {
  const choices = Array.isArray(result?.choices) ? result.choices : [];
  const images = [];
  const texts = [];

  for (const choice of choices) {
    const extracted = collectImageResults(choice?.message?.content);
    images.push(...extracted.images);
    if (extracted.text) texts.push(extracted.text);
  }

  return {
    images,
    text: texts.join('\n').trim(),
  };
};

const handler = async (id, name, { prompt = '' } = {}, { server, geminiWs, env }) => {
  const textPrompt = String(prompt || '').trim();
  if (!textPrompt) {
    throw new Error('imageGeneration prompt 不能为空');
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('Worker 缺少 OPENAI_API_KEY secret');
  }

  const model = String(env.OPENAI_IMAGE_MODEL || '').trim();
  if (!model) {
    throw new Error('Worker 缺少 OPENAI_IMAGE_MODEL 配置');
  }

  const baseUrl = trimTrailingSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const content = [{ type: 'text', text: textPrompt }];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: withBrowserUserAgent({
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    }),
  });

  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`图片请求失败: ${response.status} ${response.statusText}: ${responseText}`);
  }

  const formatResult = formatImageGenerationResponse(result);
  if (formatResult.images?.length === 0 && !formatResult.text) {
    throw new Error(`图片生成失败: ${responseText}`);
  }
  return formatResult;
};

export default {
  name: 'imageGeneration',
  description: '图片生成工具，当用户需要从文本提示词生成新图片时调用此工具。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片生成提示词。',
      },
    },
    required: ['prompt'],
  },
  handler,
};
