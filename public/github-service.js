import { GITHUB_APP_SLUG, GITHUB_CLIENT_ID } from "./constant.js";

const MCP_OAUTH_TOKEN_KEY = 'geminiMcpOauthTokens';
const GITHUB_INSTALLATIONS_URL = 'https://api.github.com/user/installations';

export class GitHubService {
  constructor(options = {}) {
    this.tokens = this.loadMcpOauthTokens();
    this.mcpOauthPending = '';
    this.mcpOauthPopup = null;
    this.onTokensChanged = options.onTokensChanged || (() => {});
    this.refreshIntervals = {};
    
    // Set up auto refresh for existing tokens on initialization
    this.initAutoRefresh();
  }

  loadMcpOauthTokens() {
    try {
      const stored = JSON.parse(localStorage.getItem(MCP_OAUTH_TOKEN_KEY) || '{}');
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    } catch {
      return {};
    }
  }

  saveMcpOauthTokens(options = {}) {
    localStorage.setItem(MCP_OAUTH_TOKEN_KEY, JSON.stringify(this.tokens));
    this.onTokensChanged(this.tokens, options);
  }

  isMcpOauthServer(server) {
    return (server?.configType || 'none') === 'oauth';
  }

  hasMcpOauthToken(server) {
    const name = server?.name;
    const tokenData = name ? this.tokens[name] : null;
    return this.isTokenUsable(tokenData);
  }

  isTokenUsable(tokenData) {
    if (!tokenData?.access_token) return false;
    if (!tokenData.expires_in || !tokenData.received_at) return true;
    const expiresAt = tokenData.received_at + tokenData.expires_in * 1000;
    return Date.now() < expiresAt - 30000;
  }

  getTokenData(server) {
    const name = server?.name;
    return name ? this.tokens[name] || null : null;
  }

  hasGithubAppSlug() {
    return Boolean(GITHUB_APP_SLUG);
  }

  getGithubInstallations(server) {
    const installations = this.getTokenData(server)?.installations;
    return Array.isArray(installations) ? installations : [];
  }

  hasGithubInstallation(server) {
    return this.getGithubInstallations(server).length > 0;
  }

  getGithubInstallationSummary(server) {
    const installations = this.getGithubInstallations(server);
    if (!installations.length) return '';
    const logins = installations.map((item) => item.account_login).filter(Boolean);
    if (!logins.length) return `${installations.length} 个安装`;
    if (logins.length <= 2) return logins.join(', ');
    return `${logins.slice(0, 2).join(', ')} 等 ${logins.length} 个安装`;
  }

  getGithubInstallationUrl(server) {
    const installation = this.getGithubInstallations(server)[0];
    return installation?.html_url || '';
  }

  getGithubInstallUrl() {
    if (!GITHUB_APP_SLUG) return '';
    const state = this.createState();
    sessionStorage.setItem('gh_install_state', state);
    const installUrl = new URL(`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`);
    installUrl.searchParams.set('state', state);
    return installUrl.toString();
  }

  getGithubInstallError(server) {
    return this.getTokenData(server)?.installations_error || '';
  }

  applyMcpOauth(servers) {
    const result = [];
    for (const server of servers || []) {
      if (!this.isMcpOauthServer(server)) {
        result.push(server);
        continue;
      }
      const tokenData = this.tokens[server?.name];
      if (!this.isTokenUsable(tokenData)) continue;
      result.push({
        ...server,
        headers: { ...(server.headers || {}), Authorization: `Bearer ${tokenData.access_token}` },
      });
    }
    return result;
  }

  base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  randomBytes(length = 32) {
    const buffer = new Uint8Array(length);
    crypto.getRandomValues(buffer);
    return buffer;
  }

  createState() {
    return this.base64UrlEncode(this.randomBytes(24));
  }

  async connectMcpOauth(server) {
    if (!server?.name) return;
    this.mcpOauthPending = server.name;

    const sha256 = async (input) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return new Uint8Array(digest);
    };

    const state = this.createState();
    const codeVerifier = this.base64UrlEncode(this.randomBytes(32));
    const codeChallenge = this.base64UrlEncode(await sha256(codeVerifier));

    sessionStorage.setItem('gh_oauth_state', state);
    sessionStorage.setItem('gh_oauth_verifier', codeVerifier);

    const redirectUri = `${window.location.origin}/github/auth/callback.html`;

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    const features = 'popup=yes,width=768,height=820,left=120,top=80';
    const popup = window.open(authorizeUrl.toString(), 'github-oauth', features);
    if (!popup) {
      this.mcpOauthPending = '';
      throw new Error('无法打开授权窗口, 请允许弹窗');
    }
    this.mcpOauthPopup = popup;
  }

  disconnectMcpOauth(server) {
    if (!server?.name) return;
    if (server.name in this.tokens) {
      delete this.tokens[server.name];
      this.saveMcpOauthTokens();
      this.stopAutoRefresh(server.name);
    }
  }

  async handleOauthMessage(event) {
    if (event.origin !== window.location.origin) return null;
    const data = event.data;
    if (!data || data.type !== 'github-oauth') return null;
    
    const payload = data.payload || {};
    const serverName = this.mcpOauthPending || '';
    this.mcpOauthPending = '';

    if (!payload.ok) {
      throw new Error(payload.error || '未知错误');
    }

    if (!serverName) {
      throw new Error('没有匹配的 MCP 服务器接收授权');
    }

    this.tokens = { ...this.tokens, [serverName]: payload };
    this.saveMcpOauthTokens();
    this.startAutoRefresh(serverName, payload);
    await this.refreshGithubInstallations({ name: serverName });

    return serverName;
  }

  async refreshGithubInstallations(server) {
    if (!server?.name) return [];
    const tokenData = this.tokens[server.name];
    if (!this.isTokenUsable(tokenData)) return [];
    if (!GITHUB_APP_SLUG) {
      this.tokens = {
        ...this.tokens,
        [server.name]: {
          ...tokenData,
          installations: [],
          installations_error: '未配置 GitHub App slug',
          installations_checked_at: Date.now(),
        }
      };
      this.saveMcpOauthTokens({ refreshRegistry: false });
      return [];
    }

    try {
      const response = await fetch(GITHUB_INSTALLATIONS_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${tokenData.access_token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const installations = (data.installations || [])
        .filter((item) => item?.app_slug === GITHUB_APP_SLUG)
        .map((item) => ({
          id: item.id,
          account_id: item.account?.id ?? null,
          account_login: item.account?.login || '',
          account_type: item.account?.type || '',
          app_slug: item.app_slug || '',
          html_url: item.html_url || '',
          repository_selection: item.repository_selection || '',
          permissions: item.permissions || {},
          suspended: Boolean(item.suspended_at),
        }));

      this.tokens = {
        ...this.tokens,
        [server.name]: {
          ...tokenData,
          installations,
          installations_error: '',
          installations_checked_at: Date.now(),
        }
      };
      this.saveMcpOauthTokens({ refreshRegistry: false });
      return installations;
    } catch (error) {
      this.tokens = {
        ...this.tokens,
        [server.name]: {
          ...tokenData,
          installations: [],
          installations_error: error.message || '检查安装状态失败',
          installations_checked_at: Date.now(),
        }
      };
      this.saveMcpOauthTokens({ refreshRegistry: false });
      return [];
    }
  }

  openGithubInstallation(server) {
    const manageUrl = this.getGithubInstallationUrl(server);
    const url = manageUrl || this.getGithubInstallUrl();
    if (!url) {
      throw new Error('未配置 GitHub App slug');
    }
    if (!manageUrl && this.mcpOauthPopup && !this.mcpOauthPopup.closed) {
      this.mcpOauthPopup.location.href = url;
      this.mcpOauthPopup.focus();
      return;
    }
    const popup = window.open(url, 'github-installation', 'popup=yes,width=980,height=860,left=120,top=60');
    if (!popup) throw new Error('无法打开安装窗口, 请允许弹窗');
  }

  // Implementation of Token Refresh
  async refreshToken(serverName) {
    const tokenData = this.tokens[serverName];
    if (!tokenData || !tokenData.refresh_token) {
      console.warn(`No refresh token available for ${serverName}`);
      return false;
    }

    try {
      console.log(`Refreshing token for ${serverName}...`);
      const response = await fetch('/api/github/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: tokenData.refresh_token,
        }),
      });

      if (!response.ok) {
        throw new Error(`Refresh request failed: HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error || 'Token refresh failed');
      }

      // Update the tokens
      this.tokens = {
        ...this.tokens,
        [serverName]: {
          ...tokenData,
          access_token: payload.access_token,
          refresh_token: payload.refresh_token || tokenData.refresh_token,
          expires_in: payload.expires_in ?? tokenData.expires_in,
          refresh_token_expires_in: payload.refresh_token_expires_in ?? tokenData.refresh_token_expires_in,
          received_at: Date.now(),
        }
      };
      
      this.saveMcpOauthTokens();
      console.log(`Token refreshed successfully for ${serverName}`);
      
      // Reschedule auto-refresh with new token data
      this.startAutoRefresh(serverName, this.tokens[serverName]);
      return true;
    } catch (error) {
      console.error(`Failed to refresh token for ${serverName}:`, error);
      return false;
    }
  }

  initAutoRefresh() {
    for (const [serverName, tokenData] of Object.entries(this.tokens)) {
      if (tokenData.refresh_token) {
        this.startAutoRefresh(serverName, tokenData);
      }
    }
  }

  startAutoRefresh(serverName, tokenData) {
    this.stopAutoRefresh(serverName);

    if (!tokenData.refresh_token || !tokenData.expires_in || !tokenData.received_at) {
      return;
    }

    const expiresAt = tokenData.received_at + tokenData.expires_in * 1000;
    // Refresh 5 minutes (300000ms) before it expires, or immediately if it's already near expiration
    const refreshDelay = Math.max(0, expiresAt - Date.now() - 300000);

    console.log(`Scheduling refresh for ${serverName} in ${Math.round(refreshDelay / 1000)} seconds`);

    this.refreshIntervals[serverName] = setTimeout(() => {
      this.refreshToken(serverName);
    }, refreshDelay);
  }

  stopAutoRefresh(serverName) {
    if (this.refreshIntervals[serverName]) {
      clearTimeout(this.refreshIntervals[serverName]);
      delete this.refreshIntervals[serverName];
    }
  }

  destroy() {
    for (const serverName of Object.keys(this.refreshIntervals)) {
      this.stopAutoRefresh(serverName);
    }
  }
}
