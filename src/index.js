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

const nativeToolDeclarations = [
  {
    name: 'googleSearch',
    description: '启用 Gemini 原生 Google 搜索工具。',
    tool: { googleSearch: {} },
  },
  {
    name: 'codeExecution',
    description: '启用 Gemini 原生代码执行工具。',
    tool: { codeExecution: {} },
  },
  {
    name: 'urlContext',
    description: '启用 Gemini 原生 URL 上下文工具。',
    tool: { urlContext: {} },
  },
  {
    name: 'googleMaps',
    description: '启用 Gemini 原生 Google Maps 工具。',
    tool: { googleMaps: {} },
  },
];

const availableToolDeclarations = [
  ...toolDeclarations,
  ...nativeToolDeclarations.map(({ name, description }) => ({ name, description })),
];

const parseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const getEnabledToolNames = (autoLoadTools) => {
  if (typeof autoLoadTools !== 'string') return [];

  const value = autoLoadTools.trim();
  if (!value) return [];
  if (value === '*') return availableToolDeclarations.map((tool) => tool.name);

  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name, index, names) => name && names.indexOf(name) === index);
};

const injectTools = (message) => {
  if (!message?.setup) return message;

  const enabledToolNames = getEnabledToolNames(message.setup.autoLoadTools);
  delete message.setup.autoLoadTools;

  if (!enabledToolNames.length) return message;

  const enabledDeclarations = toolDeclarations.filter((tool) => enabledToolNames.includes(tool.name));
  const enabledNativeTools = nativeToolDeclarations
    .filter((tool) => enabledToolNames.includes(tool.name))
    .map(({ tool }) => tool);

  if (!enabledDeclarations.length && !enabledNativeTools.length) return message;

  const existingTools = Array.isArray(message.setup.tools) ? message.setup.tools : [];
  message.setup.tools = [
    ...existingTools,
    ...enabledNativeTools,
    ...(enabledDeclarations.length ? [{ functionDeclarations: enabledDeclarations }] : []),
  ];

  return message;
};

const executeToolCalls = async (functionCalls, enabledToolNames) => {
  console.log('exec tool call');
  console.log(functionCalls);
  
  
  const functionResponses = [];
  const enabledToolSet = new Set(enabledToolNames);

  for (const call of functionCalls) {
    const handler = toolHandlers[call.name];
    let response;

    if (!enabledToolSet.has(call.name)) {
      response = { error: `Tool is not enabled: ${call.name}` };
    } else if (!handler) {
      response = { error: `Unknown tool: ${call.name}` };
    } else {
      try {
        response = await handler(call.args || {});
      } catch (error) {
        response = { error: error.message || String(error) };
      }
    }

    functionResponses.push({
      id: call.id,
      name: call.name,
      response,
    });
  }

  return { toolResponse: { functionResponses } };
};

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
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

    // 3. 连接到 Gemini Live API
    // 注意：Gemini Live API 使用专门的 bidi (双向) 端点
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);
    let geminiReady = false;
    let enabledToolNames = [];

    sendClientStatus({ type: 'info', message: '开始连接...' });

    // 4. 当与 Gemini 的连接建立时，通知前端发送 Setup 初始化消息
    geminiWs.addEventListener('open', () => {
      geminiReady = true;
      sendClientStatus({ type: 'gemini_open', message: 'Gemini 连接已建立，正在初始化...' });
    });

    // 5. 消息转发：前端 -> Worker -> Gemini，并在 setup 中注入 tools
    server.addEventListener('message', (event) => {
      if (geminiWs.readyState === WebSocket.OPEN) {
        const message = typeof event.data === 'string' ? parseJson(event.data) : null;
        if (message?.setup) {
          enabledToolNames = getEnabledToolNames(message.setup.autoLoadTools);
          geminiWs.send(JSON.stringify(injectTools(message)));
        } else {
          geminiWs.send(event.data);
        }
      } else {
        sendClientStatus({
          type: 'warning',
          message: `Gemini 尚未就绪，当前状态: ${geminiWs.readyState}`,
        });
      }
    });

    // 6. 消息转发：Gemini -> Worker -> 前端，并处理 toolCall
    geminiWs.addEventListener('message', async (event) => {
      if (server.readyState === WebSocket.OPEN) {
        try {
          let rawData = event.data;

          // Check if the data is a Blob
          if (rawData instanceof Blob) {
            rawData = await rawData.text(); // Convert Blob to string
          }

          const message = typeof rawData === 'string' ? parseJson(rawData) : null;
          const functionCalls = message?.toolCall?.functionCalls;
          if (Array.isArray(functionCalls) && functionCalls.length) {
            const toolResponse = await executeToolCalls(functionCalls, enabledToolNames);
            if (geminiWs.readyState === WebSocket.OPEN) {
              geminiWs.send(JSON.stringify(toolResponse));
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
    });

    geminiWs.addEventListener('error', (event) => {
      sendClientStatus({ type: 'gemini_error', message: `Gemini 发生错误: ${event.error?.message || event.error?.stack}` });
    });

    // 处理关闭事件
    server.addEventListener('close', () => { if (geminiReady) geminiWs.close(); });
    geminiWs.addEventListener('close', (event) => {
      sendClientStatus({
        type: geminiReady ? 'gemini_close' : 'gemini_error',
        message: `Gemini 连接关闭 code=${event.code || 'unknown'} reason=${event.reason || '无'}`,
        code: event.code,
        reason: event.reason,
      });
      geminiReady = false;
      server.close(event.code, event.reason);
    });

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
