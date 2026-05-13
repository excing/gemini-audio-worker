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

  const renderPageDeclaration = {
    name: 'renderPage',
    description: '在页面内创建沙箱 iframe，实时渲染 HTML/CSS/JavaScript。iframe 使用独立 opaque origin，并仅允许脚本执行。',
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: '完整 HTML 文档或 HTML 片段。',
        },
        css: {
          type: 'string',
          description: '可选 CSS，会注入到 head 中。',
        },
        js: {
          type: 'string',
          description: '可选 JavaScript，会注入到 body 末尾的 script 中。',
        },
        title: {
          type: 'string',
          description: '预览标题，默认“实时页面预览”。',
        },
        height: {
          type: 'number',
          description: 'iframe 高度像素值，默认 420，范围 160 到 900。',
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

  const escapeClosingScript = (value = '') => String(value).replace(/<\/script/gi, '<\\/script');

  const buildPreviewDocument = ({ html = '', css = '', js = '' } = {}) => {
    const source = String(html || '');
    if (/<!doctype html>|<html[\s>]/i.test(source)) {
      return source
        .replace(/<\/head>/i, `<style>${css || ''}</style></head>`)
        .replace(/<\/body>/i, `<script>${escapeClosingScript(js)}</script></body>`);
    }

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${css || ''}</style>
</head>
<body>
${source}
<script>${escapeClosingScript(js)}</script>
</body>
</html>`;
  };

  const ensurePreviewHost = () => {
    let host = document.getElementById('tool-preview-host');
    if (!host) {
      host = document.createElement('section');
      host.id = 'tool-preview-host';
      host.className = 'tool-preview-host';
      document.querySelector('main')?.appendChild(host);
    }
    return host;
  };

  const renderPage = ({ html = '', css = '', js = '', title = '实时页面预览', height = 420 } = {}) => {
    const host = ensurePreviewHost();
    const frameHeight = Math.max(160, Math.min(Number(height) || 420, 900));
    host.innerHTML = `
      <div class="tool-preview-head">
        <strong></strong>
        <button class="ghost tool-preview-close" type="button" title="关闭预览">×</button>
      </div>
      <iframe title="工具渲染页面预览" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
    `;
    host.querySelector('strong').textContent = title || '实时页面预览';
    host.querySelector('.tool-preview-close').addEventListener('click', () => host.remove());
    const iframe = host.querySelector('iframe');
    iframe.style.height = `${frameHeight}px`;
    iframe.srcdoc = buildPreviewDocument({ html, css, js });
    return {
      ok: true,
      message: '页面已在浏览器沙箱 iframe 中渲染。',
      sandbox: 'allow-scripts',
      origin: 'opaque',
      height: frameHeight,
    };
  };

  window.BROWSER_TOOLS = {
    declarations: [codeExecutionDeclaration, renderPageDeclaration],
    handlers: { codeExecution, renderPage },
  };
})();
