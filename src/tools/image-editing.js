import { withBrowserUserAgent } from '../tool-utils.js';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const normalizeImages = (images) => {
  const values = Array.isArray(images) ? images : [];

  return values
    .map((item) => String(item || '').trim())
    .filter((item, index, items) => item && items.indexOf(item) === index);
};

const formatImageEditingResponse = (result) => {
  const data = Array.isArray(result?.data) ? result.data : [];
  const images = [];
  const texts = [];

  for (const item of data) {
    if (!item) continue;

    if (item.b64_json) {
      images.push({ b64_json: item.b64_json });
    } else if (item.url) {
      images.push({ url: item.url });
    }

    if (item.revised_prompt) {
      texts.push(String(item.revised_prompt));
    }
  }

  return {
    images,
    text: texts.join('\n').trim(),
  };
};

const handler = async (
  id,
  name,
  {
    prompt = '',
    images = [],
    mask,
    level = 'standard',
    n,
    size,
    quality,
    background,
  } = {},
  { server, geminiWs, env },
) => {
  const textPrompt = String(prompt || '').trim();
  if (!textPrompt) {
    throw new Error('imageEditing prompt 不能为空');
  }

  const inputImages = normalizeImages(images);
  if (inputImages.length === 0) {
    throw new Error('imageEditing images 不能为空');
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('Worker 缺少 OPENAI_API_KEY secret');
  }

  const baseModel = String(env.OPENAI_IMAGE_EDIT_MODEL || '').trim();
  if (!baseModel) {
    throw new Error('Worker 缺少 OPENAI_IMAGE_MODEL 配置');
  }

  const modelLevel = String(level || 'default').trim() || 'default';
  const model = `${baseModel}-${modelLevel}`;

  const baseUrl = trimTrailingSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const body = {
    model,
    prompt: textPrompt,
    image: inputImages.length === 1 ? inputImages[0] : inputImages,
  };
  if (mask) body.mask = String(mask).trim();
  if (Number.isFinite(n)) body.n = n;
  if (size) body.size = String(size).trim();
  if (quality) body.quality = String(quality).trim();
  if (background) body.background = String(background).trim();

  const response = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: withBrowserUserAgent({
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try { result = JSON.parse(responseText); } catch { /* keep null */ }
  }

  if (!response.ok) {
    throw new Error(`图片请求失败: ${response.status} ${response.statusText}: ${responseText}`);
  }

  const formatResult = formatImageEditingResponse(result);
  if (formatResult.images?.length === 0 && !formatResult.text) {
    throw new Error(`图片编辑失败: ${responseText}`);
  }
  return formatResult;
};

export default {
  name: 'imageEditing',
  description: '调用 OpenAI 兼容的 /v1/images/edits 接口，基于已有图片进行修改、重绘、扩图或多图合成。当用户需要在输入图片基础上做局部改动、风格转换、元素替换或将多张图融合为一张时调用此工具。可通过 size/quality/background 等参数控制输出；部分参数仅对特定模型生效（background 仅 gpt-image-1），未设置时由后端使用默认值。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片编辑提示词：详细描述希望对输入图片做出的修改或目标画面效果。越具体效果越好。',
      },
      images: {
        type: 'array',
        description: '输入图片列表，每项可以是图片链接(http(s))、纯 base64 或 image data URL，原样透传给上游。dall-e-2 仅支持 1 张，gpt-image-1 可传多张做合成。',
        items: { type: 'string' },
      },
      mask: {
        type: 'string',
        description: '蒙版图片（可选），透明区域 = 要被重绘的区域，其他区域保持原样。可以是图片链接、纯 base64 或 image data URL。仅作用于 images 中的第一张。',
      },
      level: {
        type: 'string',
        default: 'standard',
        description: '模型等级，控制最终请求模型。当用户明确要求使用某等级模型时，使用该参数。默认为 standard.',
        enum: ['lite', 'flash', 'standard', 'pro', 'spicy'],
      },
      n: {
        type: 'integer',
        description: '一次生成的图片数量, 默认为空, 由模型决定.',
        minimum: 1,
        maximum: 10,
      },
      size: {
        type: 'string',
        description: '图片尺寸, 默认为空, 由模型决定.',
      },
      quality: {
        type: 'string',
        description: '图片质量。值有: standard / low / medium / high, 默认为空, 由模型决定.',
      },
      background: {
        type: 'string',
        description: '背景类型, 默认为空, 由模型决定。',
        enum: ['transparent', 'opaque', 'auto'],
      },
    },
    required: ['prompt', 'images'],
  },
  handler,
};
