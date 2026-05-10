/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env) {
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

    sendClientStatus({ type: 'info', message: '开始连接...' });

    // 4. 当与 Gemini 的连接建立时，通知前端发送 Setup 初始化消息
    geminiWs.addEventListener('open', () => {
      console.log('Connected to Gemini');
      geminiReady = true;
      sendClientStatus({ type: 'gemini_open', message: 'Gemini 连接已建立，请发送 setup' });
    });

    // 5. 消息透传：前端 -> Worker -> Gemini
    server.addEventListener('message', (event) => {
      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(event.data);
      } else {
        sendClientStatus({
          type: 'warning',
          message: `Gemini 尚未就绪，当前状态: ${geminiWs.readyState}`,
        });
      }
    });

    // 6. 消息透传：Gemini -> Worker -> 前端
    geminiWs.addEventListener('message', async (event) => {
      if (server.readyState === WebSocket.OPEN) {
        try {
        let rawData = event.data;

        // Check if the data is a Blob
        if (rawData instanceof Blob) {
          rawData = await rawData.text(); // Convert Blob to string
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
