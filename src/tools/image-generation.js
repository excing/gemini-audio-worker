import { isAllowedFetchProtocol } from '../tool-utils.js';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const normalizeImages = (images) => {
  const values = Array.isArray(images) ? images : [];

  return values
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index);
};

const toDataUrl = (base64, mimeType = 'image/png') => {
  if (/^data:image\/[^;]+;base64,/i.test(base64)) return base64;
  return `data:${mimeType};base64,${base64}`;
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
      headers: {
        'User-Agent': 'gemini-audio-worker/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
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
      const dataUrls = item.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=_-]+/g) || [];
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
    nextStep: '把图片用页面渲染给用户看',
  };
};

const handler = async ({ prompt = '', images = [], mime_type = 'image/png' } = {}, env = {}) => {
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
  const imageUrls = await imagesToDataUrls(images, mime_type);
  const content = [{ type: 'text', text: textPrompt }];

  for (const imageUrl of imageUrls) {
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
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

  return formatImageGenerationResponse(result);
};

export default {
  name: 'imageGeneration',
  description: '图片生成或编辑工具, 当用户需要生成或编辑图片时调用此工具.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片生成或编辑提示词。',
      },
      images: {
        type: 'array',
        description: '可选输入图片附件列表，编辑图片时使用，每项可以是图片链接、base64 或 image data URL。',
        items: { type: 'string' },
      },
      mime_type: {
        type: 'string',
        description: '当 images 传纯 base64 时使用的 MIME 类型，默认 image/png。',
      },
    },
    required: ['prompt'],
  },
  handler,
};
