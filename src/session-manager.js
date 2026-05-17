const GEMINI_LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const RECONNECT_DELAY_MS = 250;

export const parseGeminiJson = (data) => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const withSessionManagement = (message, sessionHandle = '') => {
  if (!message?.setup) return message;

  const setup = message.setup;
  setup.contextWindowCompression ||= { slidingWindow: {} };
  setup.contextWindowCompression.slidingWindow ||= {};
  setup.sessionResumption = sessionHandle ? { handle: sessionHandle } : {};

  return message;
};

export const createGeminiSessionManager = ({
  apiKey,
  server,
  sendClientStatus,
  onGeminiMessage,
}) => {
  let currentWs = null;
  let currentGeneration = 0;
  let setupMessage = null;
  let initialMessages = [];
  let initialMessagesSent = false;
  let sessionHandle = '';
  let reconnectTimer = null;
  let closedByClient = false;
  let everOpened = false;

  const isClientOpen = () => server.readyState === WebSocket.OPEN;
  const isGeminiOpen = () => currentWs?.readyState === WebSocket.OPEN;

  const buildUrl = () => `${GEMINI_LIVE_ENDPOINT}?key=${apiKey}`;

  const scheduleReconnect = (reason = 'scheduled') => {
    if (closedByClient || reconnectTimer || !setupMessage || !sessionHandle || !isClientOpen()) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect({ reason, resume: true });
    }, RECONNECT_DELAY_MS);
  };

  const sendSetup = (ws, reason) => {
    if (!setupMessage || ws.readyState !== WebSocket.OPEN) return;

    const message = withSessionManagement(structuredClone(setupMessage), sessionHandle);
    ws.send(JSON.stringify(message));
    sendClientStatus({
      type: 'session_resuming',
      message: sessionHandle ? '正在恢复 Gemini Live 会话...' : '正在初始化 Gemini Live 会话...',
      reason,
    });
  };

  const connect = ({ reason = 'initial', resume = false } = {}) => {
    const generation = ++currentGeneration;
    const previousWs = currentWs;
    const geminiWs = new WebSocket(buildUrl());
    currentWs = geminiWs;

    sendClientStatus({
      type: resume ? 'session_reconnect' : 'info',
      message: resume ? '正在重连 Gemini Live 会话...' : '开始连接...',
      reason,
    });

    geminiWs.addEventListener('open', () => {
      if (generation !== currentGeneration) return;

      everOpened = true;
      sendClientStatus({
        type: resume ? 'session_reconnected' : 'gemini_open',
        message: resume ? 'Gemini 连接已重建，正在恢复会话...' : 'Gemini 连接已建立，正在初始化...',
        resumed: resume,
        hasSessionHandle: Boolean(sessionHandle),
      });

      if (resume) sendSetup(geminiWs, reason);

      if (previousWs && previousWs !== geminiWs && previousWs.readyState === WebSocket.OPEN) {
        previousWs.close(1000, 'Replaced by resumed Gemini session');
      }
    });

    geminiWs.addEventListener('message', async (event) => {
      if (generation !== currentGeneration || !isClientOpen()) return;

      let rawData = event.data;
      if (rawData instanceof Blob) rawData = await rawData.text();

      const message = typeof rawData === 'string' ? parseGeminiJson(rawData) : null;
      const update = message?.sessionResumptionUpdate;
      if (update?.resumable && update?.newHandle) {
        sessionHandle = update.newHandle;
        sendClientStatus({
          type: 'session_handle',
          message: 'Gemini Live 会话恢复令牌已更新',
          resumable: true,
        });
      }

      if (message?.goAway) {
        console.log('-----------------^_^ nice to meet you ^_^-----------------');

        sendClientStatus({
          type: 'go_away',
          message: 'Gemini 当前连接即将结束，准备恢复会话',
          timeLeft: message.goAway.timeLeft,
        });
        scheduleReconnect('goAway');
      }

      if (message?.setupComplete && !initialMessagesSent && initialMessages.length && isGeminiOpen()) {
        initialMessagesSent = true;
        for (const turn of initialMessages) {
          if (!isGeminiOpen() || generation !== currentGeneration) break;
          currentWs.send(JSON.stringify({
            clientContent: {
              turns: [turn],
              turnComplete: true,
            },
          }));
        }
      }

      await onGeminiMessage(rawData, message);
    });

    geminiWs.addEventListener('error', (event) => {
      if (generation !== currentGeneration) return;
      sendClientStatus({ type: 'gemini_error', message: `Gemini 发生错误: ${event.error?.message || event.error?.stack || 'unknown error'}` });
    });

    geminiWs.addEventListener('close', (event) => {
      if (generation !== currentGeneration) return;

      if (!closedByClient && sessionHandle && setupMessage && event.code !== 1000) {
        sendClientStatus({
          type: 'session_reconnect',
          message: `Gemini 连接中断，正在恢复会话 code=${event.code || 'unknown'} reason=${event.reason || '无'}`,
          code: event.code,
          reason: event.reason,
        });
        scheduleReconnect('close');
        return;
      }

      sendClientStatus({
        type: everOpened ? 'gemini_close' : 'gemini_error',
        message: `Gemini 连接关闭 code=${event.code || 'unknown'} reason=${event.reason || '无'}`,
        code: event.code,
        reason: event.reason,
      });
    });
  };

  const start = () => connect();

  const send = (data) => {
    if (!isGeminiOpen()) return false;
    currentWs.send(data);
    return true;
  };

  const sendManagedSetup = (message, messages = []) => {
    setupMessage = structuredClone(message);
    initialMessages = Array.isArray(messages) ? structuredClone(messages) : [];
    initialMessagesSent = false;
    return send(JSON.stringify(withSessionManagement(structuredClone(message), sessionHandle)));
  };

  const close = (code = 1000, reason = 'Client disconnected') => {
    closedByClient = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (currentWs?.readyState === WebSocket.OPEN || currentWs?.readyState === WebSocket.CONNECTING) {
      currentWs.close(code, reason);
    }
  };

  return {
    close,
    send,
    sendManagedSetup,
    start,
    get readyState() {
      return currentWs?.readyState ?? WebSocket.CLOSED;
    },
    get sessionHandle() {
      return sessionHandle;
    },
  };
};
