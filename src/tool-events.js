// 统一的工具调用可视化协议：所有工具(worker / mcp / browser) 都通过
// systemContent.toolCall 把原始 args、response、status 透传给前端，
// 由前端按 name 自行派生 UI。

const send = (server, payload) => {
  if (server?.readyState !== 1) return; // WebSocket.OPEN === 1
  try {
    server.send(JSON.stringify({ systemContent: { toolCall: payload } }));
  } catch {
    // 忽略发送失败：客户端断开时无需中断工具执行
  }
};

export const sendToolRunning = (server, { id, name, kind, args }) => {
  send(server, {
    id,
    name,
    kind,
    status: 'running',
    args: args ?? null,
    startedAt: Date.now(),
  });
};

export const sendToolDone = (server, { id, name, kind, args, response, startedAt }) => {
  send(server, {
    id,
    name,
    kind,
    status: 'done',
    args: args ?? null,
    response: response ?? null,
    startedAt: startedAt ?? null,
    endedAt: Date.now(),
  });
};

export const sendToolError = (server, { id, name, kind, args, error, response, startedAt }) => {
  send(server, {
    id,
    name,
    kind,
    status: 'error',
    args: args ?? null,
    response: response ?? null,
    error: error ? String(error) : '',
    startedAt: startedAt ?? null,
    endedAt: Date.now(),
  });
};
