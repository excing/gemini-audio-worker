/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { toolDeclarations, toolHandlers } from './tools.js';
import { createGeminiSessionManager, parseGeminiJson } from './session-manager.js';
import { sendToolRunning, sendToolDone, sendToolError } from './tool-events.js';
import { handleGithubRequest } from './github/index.js';

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
}

const runtimeTools = [{
  functionDeclarations: [seeyouGemini]
}];

const parseJson = parseGeminiJson;

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

// 将前端的本地 setup 协议转换为 Gemini Live setup 消息.
// 本地协议字段:
//   model              别名, 由 models 表解析为真实 Gemini 模型 ID
//   voiceName          可选, 包装为 generationConfig.speechConfig
//   systemInstruction  原始文本, 包装为 { parts: [{ text }] }
//   autoLoadTools      启用的 worker 工具名 (逗号分隔; '*' 表示全部); 与 worker toolDeclarations 求交后注入 Gemini
//   initialMessages    setupComplete 后下发的 realtimeInput 序列 (仅消费, 不下发给 Gemini)
//   browserTools       浏览器侧 functionDeclarations (扁平数组), 含 MCP 工具声明; Worker 不区分来源, 一律转给 Gemini
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

  // 受支持的工具概览
  // 仅支持 google search 和函数调用, 且 google search 仅 2.5 模型可用
  // https://ai.google.dev/gemini-api/docs/live-api/tools?hl=zh-CN#tools-overview
  const indexWebSearchAtBut2_5 = resolvedModel.includes('2.5') ? enabledDeclarations.findIndex(item => item.name === 'webSearch') : -1;
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

// 利用 cf workers 的 Isolate 为 availableToolDeclarations 提供一级缓存
const availableToolDeclarations = [];

const models = {
  default: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
  "gemini-3.1-flash-preview": "models/gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-preview": "models/gemini-2.5-flash-native-audio-preview-12-2025",
}

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (url.pathname === '/api/tools') {
      if (availableToolDeclarations.length == 0) {
        availableToolDeclarations.push(
          ...toolDeclarations.map(({ name, description }) => ({ name, description })),
        );
      }
      return Response.json(
        { tools: availableToolDeclarations },
        { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } },
      );
    }

    if (url.pathname.startsWith('/api/github/')) {
      const response = await handleGithubRequest(request, env, url);
      if (response) return response;
    }

    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return env.ASSETS.fetch(request);
    }

    // 1. 创建 WebSocket 对 (client端返回给前端，server端在Worker内部处理)
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // 2. 接受前端的 WebSocket 连接
    server.accept();

    const sendClientStatus = (payload) => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(JSON.stringify({ workerStatus: payload }));
      }
    };

    if (!env.GEMINI_API_KEY) {
      sendClientStatus({ type: 'error', message: 'Worker 缺少 GEMINI_API_KEY secret' });
      server.close(1011, 'Missing GEMINI_API_KEY');
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    let enabledToolNames = [];

    let geminiSession;

    // 4. 消息转发：前端 -> Worker -> Gemini，并在 setup 中注入 tools/session 管理
    server.addEventListener('message', async (event) => {
      if (geminiSession.readyState === WebSocket.OPEN) {
        const message = typeof event.data === 'string' ? parseJson(event.data) : null;
        if (message?.setup) {
          const localSetup = message.setup;
          const initialMessages = Array.isArray(localSetup.initialMessages) ? localSetup.initialMessages : [];
          const built = buildGeminiSetup(localSetup);
          enabledToolNames = built.enabledToolNames;
          geminiSession.sendManagedSetup(built.message, initialMessages);
        } else {
          geminiSession.send(event.data);
        }
      } else {
        sendClientStatus({
          type: 'warning',
          message: `Gemini 尚未就绪，当前状态: ${geminiSession.readyState}`,
        });
      }
    });

    // 5. 消息转发：Gemini -> Worker -> 前端，并处理 toolCall
    geminiSession = createGeminiSessionManager({
      apiKey: env.GEMINI_API_KEY,
      server,
      sendClientStatus,
      onGeminiMessage: async (rawData, message) => {
        if (server.readyState === WebSocket.OPEN) {
          try {
            const functionCalls = message?.toolCall?.functionCalls;
            if (Array.isArray(functionCalls) && functionCalls.length) {
              const seeyoulaterAt = functionCalls.findIndex(call => call.name === seeyouGemini.name);
              if (seeyoulaterAt !== -1 && geminiSession.readyState === WebSocket.OPEN) {
                console.log('-----------------^_^ see you later ^_^-----------------');

                geminiSession.send(JSON.stringify({
                  toolResponse: {
                    functionResponses: [{
                      id: functionCalls[seeyoulaterAt].id,
                      name: functionCalls[seeyoulaterAt].name,
                      response: "Done",
                    }]
                  }
                }));
                geminiSession.close(1000, 'see_you_later');
                sendClientStatus({
                  type: 'gemini_close',
                  message: `再见`,
                  code: 1000,
                  reason: functionCalls[seeyoulaterAt].args,
                });
                functionCalls.splice(seeyoulaterAt, 1);
              }

              const workerFunctionCalls = functionCalls.filter((call) => toolHandlers[call.name]);

              if (workerFunctionCalls.length) {
                const ctx = { server, geminiWs: geminiSession, env }
                const toolResponse = await executeToolCalls(ctx, workerFunctionCalls, enabledToolNames);
                if (geminiSession.readyState === WebSocket.OPEN) {
                  geminiSession.send(JSON.stringify(toolResponse));
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
            sendClientStatus({
              type: 'warning',
              message: `Gemini message: ${error.message || error}`,
            });
          }
        }
      },
    });

    // 处理关闭事件
    server.addEventListener('close', () => geminiSession.close());
    geminiSession.start();

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
