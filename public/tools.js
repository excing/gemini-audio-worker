const codeExecutionDeclaration = {
  name: 'codeExecution',
  description: '在浏览器沙箱 Worker 中执行 JavaScript 代码，返回 console 输出、执行结果或错误。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的 JavaScript 代码。可使用 return 返回结果，也可使用 console.log 输出。',
      },
      timeout_ms: {
        type: 'number',
        description: '执行超时时间，默认 3000，最大 10000。',
      },
    },
    required: ['code'],
  },
};

const renderPageDeclaration = {
  name: 'renderPage',
  description: '在页面内创建沙箱 iframe，渲染传入的完整 HTML 文档。iframe 使用独立 opaque origin，并仅允许脚本执行。',
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: '要渲染的完整 HTML 文档，包含所需的 CSS 和 JavaScript。',
      },
    },
    required: ['html'],
  },
};

const serializeValue = (value) => {
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const codeExecution = ({ code = '', timeout_ms = 3000 } = {}) => new Promise((resolve) => {
  const timeout = Math.max(1, Math.min(Number(timeout_ms) || 3000, 10000));
  const workerSource = `
    const serializeValue = ${serializeValue.toString()};
    const logs = [];
    ['log', 'info', 'warn', 'error'].forEach((level) => {
      console[level] = (...args) => logs.push({ level, message: args.map(serializeValue).join(' ') });
    });
    self.onmessage = async (event) => {
      try {
        const fn = new Function('"use strict"; return (async () => {\\n' + event.data + '\\n})()');
        const result = await fn();
        self.postMessage({ ok: true, result: serializeValue(result), logs });
      } catch (error) {
        self.postMessage({ ok: false, error: error?.stack || error?.message || String(error), logs });
      }
    };
  `;
  const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(blobUrl);
  const cleanup = () => {
    worker.terminate();
    URL.revokeObjectURL(blobUrl);
  };
  const timer = setTimeout(() => {
    cleanup();
    resolve({ ok: false, error: `Execution timed out after ${timeout}ms`, logs: [] });
  }, timeout);

  worker.onmessage = (event) => {
    clearTimeout(timer);
    cleanup();
    resolve(event.data);
  };
  worker.onerror = (error) => {
    clearTimeout(timer);
    cleanup();
    resolve({ ok: false, error: error.message || String(error), logs: [] });
  };
  worker.postMessage(String(code));
});

const renderPage = ({ html = '' } = {}) => {
  const renderId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ok: true,
    render_id: renderId,
    message: '页面已渲染，并已加入消息列表。',
    sandbox: 'allow-scripts',
    origin: 'opaque',
  };
};

export const BROWSER_TOOLS = {
  declarations: [codeExecutionDeclaration, renderPageDeclaration],
  handlers: { codeExecution, renderPage },
};
