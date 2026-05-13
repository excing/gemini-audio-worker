const MCP_TOOL_NAME_SEPARATOR = '__';

const parseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const normalizeMcpServers = (servers = []) => {
  if (!Array.isArray(servers)) return [];

  return servers
    .map((server, index) => {
      if (typeof server === 'string') {
        return { name: `mcp${index + 1}`, url: server };
      }

      if (!server || typeof server !== 'object') return null;

      const name = String(server.name || server.id || `mcp${index + 1}`).trim();
      const url = String(server.url || server.endpoint || server.streamableHttpTransport?.url || '').trim();
      const headers = server.headers && typeof server.headers === 'object' ? server.headers : undefined;

      return name && url ? { name: sanitizeToolName(name), url, headers } : null;
    })
    .filter(Boolean);
};

const sanitizeToolName = (name) => {
  const sanitized = String(name || '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'tool';
};

const createRpcBody = (method, params) => ({
  jsonrpc: '2.0',
  id: crypto.randomUUID(),
  method,
  ...(params === undefined ? {} : { params }),
});

const createNotificationBody = (method, params) => ({
  jsonrpc: '2.0',
  method,
  ...(params === undefined ? {} : { params }),
});

const createHeaders = (server) => ({
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
  ...(server.sessionId ? { 'Mcp-Session-Id': server.sessionId } : {}),
  ...(server.headers || {}),
});

const parseRpcResponse = async (response) => {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error(`MCP 请求失败: ${response.status} ${response.statusText}`);
  }

  if (contentType.includes('text/event-stream')) {
    return parseServerSentEvent(text);
  }

  return parseJson(text) || {};
};

const parseServerSentEvent = (text) => {
  const events = text.split(/\n\n+/);

  for (const event of events) {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();

    if (!data || data === '[DONE]') continue;

    const parsed = parseJson(data);
    if (parsed) return parsed;
  }

  return {};
};

const callMcpRpc = async (server, method, params) => {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: createHeaders(server),
    body: JSON.stringify(createRpcBody(method, params)),
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) server.sessionId = sessionId;

  const payload = await parseRpcResponse(response);

  if (payload?.error) {
    throw new Error(payload.error.message || JSON.stringify(payload.error));
  }

  return payload?.result ?? payload;
};

const sendMcpNotification = async (server, method, params) => {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: createHeaders(server),
    body: JSON.stringify(createNotificationBody(method, params)),
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) server.sessionId = sessionId;
};

const initializeMcpServer = async (server) => {
  try {
    await callMcpRpc(server, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'gemini-audio-worker',
        version: '1.0.0',
      },
    });
    await sendMcpNotification(server, 'notifications/initialized');
  } catch (error) {
    server.initializeError = error;
  }
};

const normalizeSchemaType = (type) => {
  const normalizedType = Array.isArray(type) ? type.find((item) => item !== 'null') : type;

  if (typeof normalizedType !== 'string') return undefined;

  const lowerType = normalizedType.toLowerCase();
  return ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(lowerType) ? lowerType : undefined;
};

const normalizeSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return undefined;

  const normalized = {};
  const type = normalizeSchemaType(schema.type) || (schema.properties ? 'object' : undefined);

  if (type) normalized.type = type;
  if (typeof schema.description === 'string') normalized.description = schema.description;
  if (typeof schema.title === 'string' && !normalized.description) normalized.description = schema.title;
  if (Array.isArray(schema.enum)) normalized.enum = schema.enum.map((value) => String(value));

  if (Array.isArray(schema.required) && type === 'object') normalized.required = schema.required.map(String);

  if (schema.properties && typeof schema.properties === 'object') {
    const properties = Object.entries(schema.properties).reduce((result, [name, propertySchema]) => {
      const normalizedProperty = normalizeSchema(propertySchema);
      if (normalizedProperty) result[name] = normalizedProperty;
      return result;
    }, {});

    if (Object.keys(properties).length) normalized.properties = properties;
  }

  if (schema.items && type === 'array') {
    normalized.items = normalizeSchema(schema.items) || { type: 'string' };
  }

  return Object.keys(normalized).length ? normalized : undefined;
};

const normalizeParameters = (inputSchema) => {
  const parameters = normalizeSchema(inputSchema) || { type: 'object' };

  return {
    ...parameters,
    type: 'object',
    properties: parameters.properties || {},
  };
};

const toGeminiFunctionDeclaration = (server, tool) => ({
  name: `${server.name}${MCP_TOOL_NAME_SEPARATOR}${sanitizeToolName(tool.name)}`,
  description: tool.description || `MCP tool ${tool.name} from ${server.name}`,
  parameters: normalizeParameters(tool.inputSchema || tool.parameters),
});

export const createMcpToolRegistry = async (serversConfig = []) => {
  const servers = normalizeMcpServers(serversConfig);
  const declarations = [];
  const handlers = {};

  for (const server of servers) {
    await initializeMcpServer(server);
    const listResult = await callMcpRpc(server, 'tools/list');
    const tools = Array.isArray(listResult?.tools) ? listResult.tools : [];

    for (const tool of tools) {
      if (!tool?.name) continue;

      const declaration = toGeminiFunctionDeclaration(server, tool);
      declarations.push(declaration);
      handlers[declaration.name] = async (args = {}) => {
        const result = await callMcpRpc(server, 'tools/call', {
          name: tool.name,
          arguments: args,
        });

        return result;
      };
    }
  }

  return { declarations, handlers };
};
