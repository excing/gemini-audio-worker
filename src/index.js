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
import { createMcpToolRegistry, getMcpServersConfig } from './mcp-client.js';

const getAvailableToolDeclarations = (mcpToolDeclarations = []) => [
  ...toolDeclarations,
  ...mcpToolDeclarations,
];

const parseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const getEnabledToolNames = (autoLoadTools, mcpToolDeclarations = []) => {
  if (typeof autoLoadTools !== 'string') return [];

  const value = autoLoadTools.trim();
  if (!value) return [];
  if (value === '*') return getAvailableToolDeclarations(mcpToolDeclarations).map((tool) => tool.name);

  const requestedNames = value
    .split(',')
    .map((name) => name.trim())
    .filter((name, index, names) => name && names.indexOf(name) === index);

  return requestedNames.flatMap((name) => {
    const mcpServerPrefix = `${name}__`;
    const matchedMcpTools = mcpToolDeclarations
      .filter((tool) => tool.name.startsWith(mcpServerPrefix))
      .map((tool) => tool.name);

    return matchedMcpTools.length ? matchedMcpTools : [name];
  });
};

const injectTools = (message, mcpToolDeclarations = []) => {
  if (!message?.setup) return message;

  const enabledToolNames = getEnabledToolNames(message.setup.autoLoadTools, mcpToolDeclarations);
  delete message.setup.autoLoadTools;
  delete message.setup.mcpServers;

  if (!enabledToolNames.length) return message;

  const allFunctionDeclarations = [...toolDeclarations, ...mcpToolDeclarations];
  const enabledDeclarations = allFunctionDeclarations.filter((tool) => enabledToolNames.includes(tool.name));
  // 受支持的工具概览
  // 仅支持 google search 和函数调用, 且 google search 仅 2.5 模型可用
  // https://ai.google.dev/gemini-api/docs/live-api/tools?hl=zh-CN#tools-overview
  const indexWebSearchAtBut2_5 = String(message.setup.model || '').includes('2.5') ? enabledDeclarations.findIndex(item => item.name === 'webSearch') : -1;
  const enabledNativeTools = indexWebSearchAtBut2_5 !== -1 ? [{ googleSearch: {} }] : [];
  if (indexWebSearchAtBut2_5 !== -1) enabledDeclarations.splice(indexWebSearchAtBut2_5, 1);

  if (!enabledDeclarations.length && !enabledNativeTools.length) return message;

  const existingTools = Array.isArray(message.setup.tools) ? message.setup.tools : [];
  message.setup.tools = [
    ...existingTools,
    ...enabledNativeTools,
    ...(enabledDeclarations.length ? [{ functionDeclarations: enabledDeclarations }] : []),
  ];

  console.log('-----------------------');
  console.log('-----------------------');
  console.log(JSON.stringify(message, null, 2));

  return message;
};

const executeToolCalls = async (functionCalls, enabledToolNames, mcpToolHandlers = {}) => {
  console.log('-----------------------');
  console.log('-----------------------');
  console.log(JSON.stringify(functionCalls, null, 2));

  const functionResponses = [];
  const enabledToolSet = new Set(enabledToolNames);
  const allToolHandlers = { ...toolHandlers, ...mcpToolHandlers };

  for (const call of functionCalls) {
    const handler = allToolHandlers[call.name];
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

    console.log('-----------------------');
    console.log('-----------------------');

    console.log(JSON.stringify(response, null, 2));

    functionResponses.push({
      id: call.id,
      name: call.name,
      response,
    });
  }

  return { toolResponse: { functionResponses } };
};

// 利用 cf workers 的 Isolate 为 availableToolDeclarations 提供一级缓存
const availableToolDeclarations = [];

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (url.pathname === '/api/tools') {
      try {
        if (availableToolDeclarations.length == 0) {
          const mcpRegistry = await createMcpToolRegistry(getMcpServersConfig(env.MCP_SERVERS));
          availableToolDeclarations.push(
            ...getAvailableToolDeclarations(mcpRegistry.declarations).map(({ name, description }) => { return { name, description } }),
          );
        }
        return Response.json(
          { tools: availableToolDeclarations },
          { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } },
        );
      } catch (error) {
        return Response.json(
          {
            tools: getAvailableToolDeclarations([]),
            error: error.message || String(error),
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
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

    // 3. 连接到 Gemini Live API
    // 注意：Gemini Live API 使用专门的 bidi (双向) 端点
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);
    let geminiReady = false;
    let enabledToolNames = [];
    let mcpToolDeclarations = [];
    let mcpToolHandlers = {};

    sendClientStatus({ type: 'info', message: '开始连接...' });

    // 4. 当与 Gemini 的连接建立时，通知前端发送 Setup 初始化消息
    geminiWs.addEventListener('open', () => {
      geminiReady = true;
      sendClientStatus({ type: 'gemini_open', message: 'Gemini 连接已建立，正在初始化...' });
    });

    // 5. 消息转发：前端 -> Worker -> Gemini，并在 setup 中注入 tools
    server.addEventListener('message', async (event) => {
      if (geminiWs.readyState === WebSocket.OPEN) {
        const message = typeof event.data === 'string' ? parseJson(event.data) : null;
        if (message?.setup) {
          try {
            const mcpServers = getMcpServersConfig(message.setup?.mcpServers, env.MCP_SERVERS);
            const mcpRegistry = await createMcpToolRegistry(mcpServers);
            mcpToolDeclarations = mcpRegistry.declarations;
            mcpToolHandlers = mcpRegistry.handlers;
            enabledToolNames = getEnabledToolNames(message.setup.autoLoadTools, mcpToolDeclarations);
            geminiWs.send(JSON.stringify(injectTools(message, mcpToolDeclarations)));
          } catch (error) {
            sendClientStatus({
              type: 'warning',
              message: `MCP 初始化失败: ${error.message || error}`,
            });
            enabledToolNames = getEnabledToolNames(message.setup.autoLoadTools, []);
            geminiWs.send(JSON.stringify(injectTools(message, [])));
          }
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
            const allToolHandlers = { ...toolHandlers, ...mcpToolHandlers };
            const workerFunctionCalls = functionCalls.filter((call) => allToolHandlers[call.name]);

            if (workerFunctionCalls.length) {
              const toolResponse = await executeToolCalls(workerFunctionCalls, enabledToolNames, mcpToolHandlers);
              if (geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify(toolResponse));
              }
            }

            const browserFunctionCalls = functionCalls.filter((call) => !allToolHandlers[call.name]);
            if (browserFunctionCalls.length) {
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
    });

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
