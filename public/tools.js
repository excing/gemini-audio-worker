(function () {
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

  window.BROWSER_TOOLS = {
    declarations: [codeExecutionDeclaration],
    handlers: { codeExecution },
  };
})();
