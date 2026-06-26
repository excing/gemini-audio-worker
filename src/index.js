/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { createGeminiSessionManager } from './session-manager.js';
import { handleGithubRequest } from './github/index.js';
import { availableToolDeclarations as getAvailableToolDeclarations, createMessageHandler } from './message-handler.js';

// 利用 cf workers 的 Isolate 为 availableToolDeclarations 提供一级缓存
const availableToolDeclarations = [];

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (url.pathname === '/api/config') {
      return Response.json({
        hasPasscode: !!env.ACTIVATION_CODE,
        wxAccountID: env.WX_ACCOUNT_ID || '',
        wxQrCodeUrl: env.WX_QR_CODE_URL || '',
      });
    }

    if (url.pathname === '/api/verify-passcode') {
      let passcode = '';
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          passcode = body.passcode || '';
        } catch (e) {}
      } else {
        passcode = url.searchParams.get('passcode') || '';
      }
      const isValid = !env.ACTIVATION_CODE || (passcode === env.ACTIVATION_CODE);
      return Response.json({
        valid: isValid,
        message: isValid ? '验证通过' : '激活码错误',
      });
    }

    if (url.pathname === '/api/tools') {
      if (availableToolDeclarations.length == 0) {
        availableToolDeclarations.push(
          ...getAvailableToolDeclarations(),
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

    if (env.ACTIVATION_CODE) {
      const passcode = url.searchParams.get('passcode') || '';
      if (passcode !== env.ACTIVATION_CODE) {
        return new Response('Unauthorized: Invalid passcode', { status: 403 });
      }
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

    let geminiSession;
    const messageHandler = createMessageHandler({
      env,
      server,
      sendClientStatus,
      geminiSession: () => geminiSession,
    });

    // 4. 消息转发：前端 -> Worker -> Gemini，并在 setup 中注入 tools/session 管理
    server.addEventListener('message', async (event) => {
      if (geminiSession.readyState === WebSocket.OPEN) {
        await messageHandler.handleClientEvent(event);
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
      sendInitialMessage: messageHandler.handleInitialMessage,
      onGeminiMessage: messageHandler.handleGeminiMessage,
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
