/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const toolDeclarations = [
  {
    name: 'get_current_time',
    description: '获取当前服务器时间。',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA 时区名称，例如 Asia/Shanghai 或 America/New_York。',
        },
      },
    },
  },
];

const toolHandlers = {
  get_current_time: async ({ timezone = 'Asia/Shanghai' } = {}) => {
    const now = new Date();

    return {
      iso: now.toISOString(),
      timezone,
      formatted: new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(now),
    };
  },
};

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
  if (value === '*') return Object.keys(toolHandlers);

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
  if (!enabledDeclarations.length) return message;

  const existingTools = Array.isArray(message.setup.tools) ? message.setup.tools : [];
  message.setup.tools = [...existingTools, { functionDeclarations: enabledDeclarations }];

  return message;
};

const executeToolCalls = async (functionCalls, enabledToolNames) => {
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

const handleApiRequest = (request, env, ctx, pathname) => {
  if (pathname === '/api/tool-declarations') {
    return Response.json(toolDeclarations);
  }

  return Response.json({ error: "Not Found" }, { status: 404 });
};

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      const url = new URL(request.url);
      // 关键判断：所有 /api 开头的请求都交给 handleApiRouter
      if (url.pathname.startsWith("/api")) {
        return handleApiRequest(request, env, ctx, url.pathname);
      }

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
      console.log('Connected to Gemini');
      geminiReady = true;
      sendClientStatus({ type: 'gemini_open', message: 'Gemini 连接已建立，请发送 setup' });
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
      console.log('Gemini WebSocket error', event);
      sendClientStatus({ type: 'error', message: `Gemini WebSocket 发生错误: ${event}` });
    });

    // 处理关闭事件
    server.addEventListener('close', () => geminiWs.close());
    geminiWs.addEventListener('close', (event) => {
      const message = `Gemini 连接关闭 code=${event.code || 'unknown'} reason=${event.reason || '无'}`;
      console.log(message);
      sendClientStatus({
        type: geminiReady ? 'gemini_close' : 'error',
        message,
        code: event.code,
        reason: event.reason,
      });
      server.close(1011, message.slice(0, 120));
    });

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
