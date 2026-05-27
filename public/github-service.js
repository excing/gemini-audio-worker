import { GITHUB_CLIENT_ID } from "./constant.js";

const MCP_OAUTH_TOKEN_KEY = 'geminiMcpOauthTokens';

export class GitHubService {
  constructor(options = {}) {
    this.tokens = this.loadMcpOauthTokens();
    this.mcpOauthPending = '';
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

  saveMcpOauthTokens() {
    localStorage.setItem(MCP_OAUTH_TOKEN_KEY, JSON.stringify(this.tokens));
    this.onTokensChanged(this.tokens);
  }

  isMcpOauthServer(server) {
    return (server?.configType || 'none') === 'oauth';
  }

  hasMcpOauthToken(server) {
    const name = server?.name;
    const tokenData = name ? this.tokens[name] : null;
    if (!tokenData?.access_token) return false;
    
    // Check if token is expired (or close to expiring in 30 seconds)
    if (tokenData.expires_in && tokenData.received_at) {
      const expiresAt = tokenData.received_at + tokenData.expires_in * 1000;
      if (Date.now() >= expiresAt - 30000) {
        return false;
      }
    }
    return true;
  }

  applyMcpOauth(servers) {
    const result = [];
    for (const server of servers || []) {
      if (!this.isMcpOauthServer(server)) {
        result.push(server);
        continue;
      }
      const token = this.tokens[server?.name]?.access_token;
      if (!token) continue;
      result.push({
        ...server,
        headers: { ...(server.headers || {}), Authorization: `Bearer ${token}` },
      });
    }
    return result;
  }

  async connectMcpOauth(server) {
    if (!server?.name) return;
    this.mcpOauthPending = server.name;

    const base64UrlEncode = (bytes) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const randomBytes = (length = 32) => {
      const buffer = new Uint8Array(length);
      crypto.getRandomValues(buffer);
      return buffer;
    };
    const sha256 = async (input) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return new Uint8Array(digest);
    };

    const state = base64UrlEncode(randomBytes(24));
    const codeVerifier = base64UrlEncode(randomBytes(32));
    const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

    sessionStorage.setItem('gh_oauth_state', state);
    sessionStorage.setItem('gh_oauth_verifier', codeVerifier);

    const redirectUri = `${window.location.origin}/github/auth/callback.html`;

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    const features = 'popup=yes,width=720,height=820,left=120,top=80';
    const popup = window.open(authorizeUrl.toString(), 'github-oauth', features);
    if (!popup) {
      this.mcpOauthPending = '';
      throw new Error('无法打开授权窗口, 请允许弹窗');
    }
  }

  disconnectMcpOauth(server) {
    if (!server?.name) return;
    if (server.name in this.tokens) {
      delete this.tokens[server.name];
      this.saveMcpOauthTokens();
      this.stopAutoRefresh(server.name);
    }
  }

  handleOauthMessage(event) {
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

    return serverName;
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
