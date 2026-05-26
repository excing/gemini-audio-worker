// GitHub App OAuth (user-to-server) 授权码 + PKCE 流程
// 需要的 Worker 环境变量:
//   GITHUB_CLIENT_ID      GitHub App 的 Client ID  (vars 或 secret)
//   GITHUB_CLIENT_SECRET  GitHub App 的 Client Secret (建议用 wrangler secret put)
// GitHub App 需把 ${origin}/api/github/auth/callback 注册为 Callback URL.

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const STATE_COOKIE = 'gh_oauth_state';
const COOKIE_PATH = '/api/github/auth';

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

const parseCookies = (header) => {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
};

const buildCookie = (value, { maxAge, secure }) => {
  const parts = [`${STATE_COOKIE}=${value}`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

const isSecureRequest = (url) => url.protocol === 'https:';

const callbackUrlFor = (url) => `${url.origin}/api/github/auth/callback`;

const renderCallbackHtml = (payload) => {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>GitHub 授权</title>
<style>body{font:14px/1.6 system-ui,-apple-system,sans-serif;color:#111827;background:#f9fafb;padding:40px;text-align:center}</style>
</head>
<body>
<p id="msg">正在完成 GitHub 授权…</p>
<script>
(function () {
  var payload = ${json};
  var msg = document.getElementById('msg');
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'github-oauth', payload: payload }, window.location.origin);
      msg.textContent = payload.ok ? '授权成功，窗口将自动关闭…' : ('授权失败: ' + (payload.error || ''));
      setTimeout(function () { window.close(); }, 600);
    } else {
      msg.textContent = payload.ok ? '授权成功，请回到原窗口。' : ('授权失败: ' + (payload.error || ''));
    }
  } catch (error) {
    msg.textContent = '回调处理失败: ' + (error && error.message || error);
  }
})();
</script>
</body>
</html>`;
};

const htmlResponse = (payload, extraHeaders = {}, status = 200) => new Response(renderCallbackHtml(payload), {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
});

const ensureConfigured = (env) => Boolean(env?.GITHUB_CLIENT_ID && env?.GITHUB_CLIENT_SECRET);

export async function handleGithubOauthStart(request, env, url) {
  if (!ensureConfigured(env)) {
    return new Response('GitHub OAuth 未在 Worker 中配置 (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)', { status: 500 });
  }

  const state = base64UrlEncode(randomBytes(24));
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrlFor(url));
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const cookie = buildCookie(`${state}.${codeVerifier}`, { maxAge: 600, secure: isSecureRequest(url) });

  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl.toString(), 'Set-Cookie': cookie },
  });
}

export async function handleGithubOauthCallback(request, env, url) {
  const clearCookie = buildCookie('', { maxAge: 0, secure: isSecureRequest(url) });

  if (!ensureConfigured(env)) {
    return htmlResponse({ ok: false, error: 'Worker 未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET' }, { 'Set-Cookie': clearCookie });
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const [storedState = '', codeVerifier = ''] = (cookies[STATE_COOKIE] || '').split('.');

  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    const description = url.searchParams.get('error_description') || oauthError;
    return htmlResponse({ ok: false, error: description }, { 'Set-Cookie': clearCookie });
  }

  if (!state || !storedState || state !== storedState || !codeVerifier || !code) {
    return htmlResponse({ ok: false, error: '无效或过期的 OAuth state' }, { 'Set-Cookie': clearCookie }, 400);
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrlFor(url),
        code_verifier: codeVerifier,
      }),
    });
  } catch (error) {
    return htmlResponse({ ok: false, error: `Token 请求失败: ${error.message || error}` }, { 'Set-Cookie': clearCookie });
  }

  if (!tokenResponse.ok) {
    return htmlResponse({ ok: false, error: `Token 交换失败: HTTP ${tokenResponse.status}` }, { 'Set-Cookie': clearCookie });
  }

  let data;
  try { data = await tokenResponse.json(); }
  catch { return htmlResponse({ ok: false, error: '解析 token 响应失败' }, { 'Set-Cookie': clearCookie }); }

  if (data?.error) {
    return htmlResponse({ ok: false, error: data.error_description || data.error }, { 'Set-Cookie': clearCookie });
  }

  if (!data?.access_token) {
    return htmlResponse({ ok: false, error: '未收到 access_token' }, { 'Set-Cookie': clearCookie });
  }

  return htmlResponse({
    ok: true,
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    expires_in: data.expires_in ?? null,
    refresh_token: data.refresh_token ?? null,
    refresh_token_expires_in: data.refresh_token_expires_in ?? null,
    scope: data.scope ?? '',
    received_at: Date.now(),
  }, { 'Set-Cookie': clearCookie });
}
