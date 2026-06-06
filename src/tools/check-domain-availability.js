import { withBrowserUserAgent } from '../tool-utils.js';

const API_URL = 'https://api.instantdomainsearch.com/mcp';
const MCP_METHOD = 'tools/call';
const TOOL_NAME = 'check_domain_availability';

const normalizeDomains = (domains) => {
  const values = Array.isArray(domains) ? domains : [domains];

  return values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 50);
};

const buildRequestBody = (domains) => ({
  jsonrpc: '2.0',
  id: crypto.randomUUID(),
  method: MCP_METHOD,
  params: {
    name: TOOL_NAME,
    arguments: { domains },
  },
});

const handler = async (id, name, { domains = [] } = {}) => {
  const normalizedDomains = normalizeDomains(domains);
  if (!normalizedDomains.length) {
    throw new Error('checkDomainAvailability 至少需要提供一个域名');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: withBrowserUserAgent({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify(buildRequestBody(normalizedDomains)),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`checkDomainAvailability 请求失败: ${response.status} ${response.statusText}`);
  }

  if (payload?.error) {
    throw new Error(payload.error.message || 'checkDomainAvailability 返回错误');
  }

  const mixedContent = payload?.result?.content;
  const result = [];
  mixedContent?.forEach(content => {
    if (content.type === 'json') {
      result.push(content);
    } else {
      try {
        // 匹配以 { 开头，中间包含任意字符，且以 } 结尾的最长连续部分
        const match = content.text.match(/\{[\s\S]*\}/);

        if (match) {
          const data = JSON.parse(match[0]);
          result.push({ data, type: 'json' });
        } else {
          result.push(content);
        }
      } catch (error) {
        result.push(content);
      }
    }
  });
  return {
    domains: normalizedDomains,
    content: result,
  };
};

export default {
  name: 'checkDomainAvailability',
  description: 'Check availability of specific domains via DNS.',
  parameters: {
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        description: 'List of full domain names to check (e.g., [\'example.com\', \'test.net\'])',
        items: {
          type: 'string',
        },
      },
    },
    required: ['domains'],
  },
  handler,
};
