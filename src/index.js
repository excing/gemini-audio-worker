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
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // 1. 创建 WebSocket 对 (client端返回给前端，server端在Worker内部处理)
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // 2. 接受前端的 WebSocket 连接
    server.accept();

    // 3. 连接到 Gemini Multimodal Live API
    // 注意：Gemini Live API 使用专门的 bidi (双向) 端点
    const geminiUrl = `wss://generativeai.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);

    // 4. 当与 Gemini 的连接建立时，发送 Setup 初始化消息
    geminiWs.addEventListener('open', () => {
      console.log('Connected to Gemini');
      const setupMessage = {
        setup: {
          // 使用 gemini 2.5 flash 模型
          model: "gemini-2.5-flash-native-audio-preview-12-2025", 
          generationConfig: {
            // 指定要求模型返回音频流 (AUDIO)
            responseModalities: ["AUDIO"] 
          }
        }
      };
      geminiWs.send(JSON.stringify(setupMessage));
    });

    // 5. 消息透传：前端 -> Worker -> Gemini
    server.addEventListener('message', (event) => {
      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(event.data);
      }
    });

    // 6. 消息透传：Gemini -> Worker -> 前端
    geminiWs.addEventListener('message', (event) => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });

    // 处理关闭事件
    server.addEventListener('close', () => geminiWs.close());
    geminiWs.addEventListener('close', () => server.close());

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
