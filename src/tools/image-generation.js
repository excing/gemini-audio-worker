import { withBrowserUserAgent } from '../tool-utils.js';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const formatImageGenerationResponse = (result) => {
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
    level = 'default',
    n,
    size,
    quality,
    style,
    background,
  } = {},
  { server, geminiWs, env },
) => {
  const textPrompt = String(prompt || '').trim();
  if (!textPrompt) {
    throw new Error('imageGeneration prompt 不能为空');
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('Worker 缺少 OPENAI_API_KEY secret');
  }

  const baseModel = String(env.OPENAI_IMAGE_GEN_MODEL || '').trim();
  if (!baseModel) {
    throw new Error('Worker 缺少 OPENAI_IMAGE_MODEL 配置');
  }

  const modelLevel = String(level || 'default').trim() || 'default';
  const model = `${baseModel}-${modelLevel}`;

  const baseUrl = trimTrailingSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const body = { model, prompt: textPrompt };
  if (Number.isFinite(n)) body.n = n;
  if (size) body.size = String(size).trim();
  if (quality) body.quality = String(quality).trim();
  if (style) body.style = String(style).trim();
  if (background) body.background = String(background).trim();

  const response = await fetch(`${baseUrl}/images/generations`, {
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

  const formatResult = formatImageGenerationResponse(result);
  if (formatResult.images?.length === 0 && !formatResult.text) {
    throw new Error(`图片生成失败: ${responseText}`);
  }
  return formatResult;
};

export default {
  name: 'imageGeneration',
  description: '调用 OpenAI 兼容的 /v1/images/generations 接口，根据文本提示词生成图片。当用户需要凭空创作新图片（绘制、设计、插画、海报、概念图等）时调用此工具。可通过 size/quality/style/background 等参数控制输出；部分参数仅对特定模型生效（style 仅 dall-e-3，background 仅 gpt-image-1），未设置时由后端使用默认值。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片生成提示词：详细描述想要生成的画面内容、主体、风格、构图、光照、氛围等。越具体效果越好。',
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
        description: '图片质量。值有: standard / hd / low / medium / high, 默认为空, 由模型决定.',
      },
      style: {
        type: 'string',
        description: '图片风格, 默认为空, 由模型决定.',
        enum: ['vivid', 'natural'],
      },
      background: {
        type: 'string',
        description: '背景类型, 默认为空, 由模型决定。',
        enum: ['transparent', 'opaque', 'auto'],
      },
    },
    required: ['prompt'],
  },
  handler,
};
