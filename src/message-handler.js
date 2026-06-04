import { toolDeclarations, toolHandlers } from './tools.js';
import { parseGeminiJson } from './session-manager.js';
import { sendToolRunning, sendToolDone, sendToolError } from './tool-events.js';

const DEFAULT_MIME_TYPE = 'image/png';

const seeyouGemini = {
  name: 'see_you_later',
  description: '断开和用户的连接. 当用户有表示“再见, 拜拜, goodbye, see you, see you later"之类的想法时, 调用该工具, 主动断开和用户的连接.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: '结束语, 可选. 可以是带给用户的最后一句话, 也可以是其他断开连接的原因.',
      },
    },
  },
};

const runtimeTools = [{
  functionDeclarations: [seeyouGemini],
}];

const models = {
  default: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-3.1-flash-preview': 'models/gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-preview': 'models/gemini-2.5-flash-native-audio-preview-12-2025',
};

const getEnabledToolNames = (autoLoadTools) => {
  if (typeof autoLoadTools !== 'string') return [];

  const value = autoLoadTools.trim();
  if (!value) return [];
  if (value === '*') return toolDeclarations.map((tool) => tool.name);

  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name, index, names) => name && names.indexOf(name) === index);
};

const normalizeMimeType = (mimeType = DEFAULT_MIME_TYPE) => {
  const value = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return /^image\/[-.+a-z0-9]+$/i.test(value) ? value : DEFAULT_MIME_TYPE;
};

const base64ToBytes = (base64) => {
  const value = String(base64 || '');
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('realtimeInput.image.data 不是有效 base64');
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const extensionFromMimeType = (mimeType) => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
};

const buildPublicImageUrl = (env, key) => {
  const baseUrl = String(env.IMAGE_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Worker 缺少 IMAGE_PUBLIC_BASE_URL 配置');
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

const uploadRealtimeImageToR2 = async (env, image) => {
  const bucket = env.IMAGE_BUCKET || env.R2_BUCKET;
  if (!bucket?.put) throw new Error('Worker 缺少 IMAGE_BUCKET R2 binding');

  const rawData = image.data || image.base64;
  const mimeType = normalizeMimeType(image.mimeType || image.mime_type);
  const bytes = base64ToBytes(rawData);
  const key = `chat-images/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extensionFromMimeType(mimeType)}`;

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { source: 'realtimeInput.image' },
  });

  return { base64: rawData, mimeType, url: buildPublicImageUrl(env, key) };
};

const buildGeminiSetup = (localSetup = {}) => {
  const resolvedModel = models[localSetup.model] ?? models.default;
  const requestedNames = new Set(getEnabledToolNames(localSetup.autoLoadTools));
  const enabledDeclarations = toolDeclarations.filter((tool) => requestedNames.has(tool.name));
  const enabledToolNames = enabledDeclarations.map((tool) => tool.name);

  const generationConfig = { responseModalities: 'AUDIO' };
  if (localSetup.voiceName) {
    generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: localSetup.voiceName } },
    };
  }

  const geminiSetup = {
    model: resolvedModel,
    generationConfig,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };

  if (typeof localSetup.systemInstruction === 'string' && localSetup.systemInstruction.length) {
    geminiSetup.systemInstruction = { parts: [{ text: localSetup.systemInstruction }] };
  }

  const indexWebSearchAtBut2_5 = resolvedModel.includes('2.5') ? enabledDeclarations.findIndex(item => item.name === 'web_search') : -1;
  const enabledNativeTools = indexWebSearchAtBut2_5 !== -1 ? [{ googleSearch: {} }] : [];
  if (indexWebSearchAtBut2_5 !== -1) enabledDeclarations.splice(indexWebSearchAtBut2_5, 1);

  const browserDeclarations = Array.isArray(localSetup.browserTools) ? localSetup.browserTools : [];
  geminiSetup.tools = [
    ...runtimeTools,
    ...(browserDeclarations.length ? [{ functionDeclarations: browserDeclarations }] : []),
    ...enabledNativeTools,
    ...(enabledDeclarations.length ? [{ functionDeclarations: enabledDeclarations }] : []),
  ];

  return { message: { setup: geminiSetup }, enabledToolNames };
};

const executeToolCalls = async (ctx, functionCalls, enabledToolNames) => {
  const functionResponses = [];
  const enabledToolSet = new Set(enabledToolNames);

  for (const call of functionCalls) {
    const { id, name, args } = call;
    const handler = toolHandlers[name];
    const startedAt = Date.now();
    let response;

    if (!enabledToolSet.has(name)) {
      response = { error: `Tool is not enabled: ${name}` };
      sendToolError(ctx.server, { id, name, kind: 'worker', args, error: response.error, startedAt });
    } else if (!handler) {
      response = { error: `Unknown tool: ${name}` };
      sendToolError(ctx.server, { id, name, kind: 'worker', args, error: response.error, startedAt });
    } else {
      sendToolRunning(ctx.server, { id, name, kind: 'worker', args });
      try {
        response = await handler(id, name, args || {}, ctx);
        sendToolDone(ctx.server, { id, name, kind: 'worker', args, response, startedAt });
      } catch (error) {
        response = { error: error.message || String(error) };
        sendToolError(ctx.server, { id, name, kind: 'worker', args, error: response.error, response, startedAt });
      }
    }

    functionResponses.push({ id, name, response });
  }

  return { toolResponse: { functionResponses } };
};

export const createMessageHandler = ({ env, server, geminiSession, sendClientStatus }) => {
  let enabledToolNames = [];

  const getGeminiSession = () => geminiSession();
  const sendToGemini = (payload) => getGeminiSession().send(typeof payload === 'string' ? payload : JSON.stringify(payload));

  const handleRealtimeImage = async (message) => {
    const image = message.realtimeInput.image;
    const uploaded = await uploadRealtimeImageToR2(env, image);
    const prompt = `This media URL is "${uploaded.url}"`;

    console.log(prompt);
    
    sendToGemini({
      realtimeInput: {
        video: { data: uploaded.base64, mimeType: uploaded.mimeType },
      },
    });

    sendToGemini({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: prompt }] }],
        // turnComplete: true,
      },
    });

    sendClientStatus({
      type: 'image_uploaded',
      message: '图片已上传并发送给 Gemini',
      url: uploaded.url,
      mimeType: uploaded.mimeType,
    });
  };

  const handleClientMessage = async (message, rawData) => {
    if (message?.setup) {
      const localSetup = message.setup;
      const initialMessages = Array.isArray(localSetup.initialMessages) ? localSetup.initialMessages : [];
      const built = buildGeminiSetup(localSetup);
      enabledToolNames = built.enabledToolNames;
      getGeminiSession().sendManagedSetup(built.message, initialMessages);
      return;
    }

    if (message?.realtimeInput?.image) {
      await handleRealtimeImage(message);
      return;
    }

    getGeminiSession().send(rawData);
  };

  const handleClientEvent = async (event) => {
    const message = typeof event.data === 'string' ? parseGeminiJson(event.data) : null;
    try {
      await handleClientMessage(message, event.data);
    } catch (error) {
      sendClientStatus({ type: 'error', message: `客户端消息处理失败: ${error.message || error}` });
    }
  };

  const handleInitialMessage = async (message) => handleClientMessage(message, JSON.stringify(message));

  const handleGeminiMessage = async (rawData, message) => {
    if (server.readyState !== WebSocket.OPEN) return;

    try {
      const functionCalls = message?.toolCall?.functionCalls;
      if (Array.isArray(functionCalls) && functionCalls.length) {
        const seeyoulaterAt = functionCalls.findIndex(call => call.name === seeyouGemini.name);
        if (seeyoulaterAt !== -1 && getGeminiSession().readyState === WebSocket.OPEN) {
          getGeminiSession().send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                id: functionCalls[seeyoulaterAt].id,
                name: functionCalls[seeyoulaterAt].name,
                response: 'Done',
              }],
            },
          }));
          getGeminiSession().close(1000, 'see_you_later');
          sendClientStatus({
            type: 'gemini_close',
            message: '再见',
            code: 1000,
            reason: functionCalls[seeyoulaterAt].args,
          });
          functionCalls.splice(seeyoulaterAt, 1);
        }

        const workerFunctionCalls = functionCalls.filter((call) => toolHandlers[call.name]);
        if (workerFunctionCalls.length) {
          const ctx = { server, geminiWs: getGeminiSession(), env };
          const toolResponse = await executeToolCalls(ctx, workerFunctionCalls, enabledToolNames);
          if (getGeminiSession().readyState === WebSocket.OPEN) {
            getGeminiSession().send(JSON.stringify(toolResponse));
          }
        }

        const browserFunctionCalls = functionCalls.filter((call) => !toolHandlers[call.name]);
        if (browserFunctionCalls.length) {
          for (const call of browserFunctionCalls) {
            sendToolRunning(server, { id: call.id, name: call.name, kind: 'browser', args: call.args ?? null });
          }
          server.send(JSON.stringify({ toolCall: { functionCalls: browserFunctionCalls } }));
        }
        return;
      }

      server.send(rawData);
    } catch (error) {
      sendClientStatus({ type: 'warning', message: `Gemini message: ${error.message || error}` });
    }
  };

  return {
    handleClientEvent,
    handleInitialMessage,
    handleGeminiMessage,
  };
};

export const availableToolDeclarations = () => toolDeclarations.map(({ name, description }) => ({ name, description }));
