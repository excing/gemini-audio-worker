// GitHub App OAuth (user-to-server) 授权码 + PKCE 流程
// 需要的 Worker 环境变量:
//   GITHUB_CLIENT_ID      GitHub App 的 Client ID  (vars 或 secret)
//   GITHUB_CLIENT_SECRET  GitHub App 的 Client Secret (建议用 wrangler secret put)

import { withBrowserUserAgent } from '../tool-utils.js';

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const ensureConfigured = (env) => Boolean(env?.GITHUB_CLIENT_ID && env?.GITHUB_CLIENT_SECRET);

export async function handleGithubOauthCallback(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!ensureConfigured(env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Worker 未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '无效的 JSON 请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { code, code_verifier, redirect_uri } = body;

  if (!code || !code_verifier || !redirect_uri) {
    return new Response(JSON.stringify({ ok: false, error: '缺少必需的参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let tokenResponse;
  try {
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri,
      code_verifier,
    });    
    
    tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: withBrowserUserAgent({ Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: params,
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: `Token 请求失败: ${error.message || error}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let data;
  try { data = await tokenResponse.json(); }
  catch {
    return new Response(JSON.stringify({ ok: false, error: `解析 token 响应失败: HTTP ${tokenResponse.status}` }), {
      status: tokenResponse.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!tokenResponse.ok) {
    return new Response(JSON.stringify({ ok: false, error: `Token 交换失败: HTTP ${tokenResponse.status}, ${JSON.stringify(data)}` }), {
      status: tokenResponse.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (data?.error) {
    return new Response(JSON.stringify({ ok: false, error: data.error_description || data.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!data?.access_token) {
    return new Response(JSON.stringify({ ok: false, error: '未收到 access_token' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    expires_in: data.expires_in ?? null,
    refresh_token: data.refresh_token ?? null,
    refresh_token_expires_in: data.refresh_token_expires_in ?? null,
    scope: data.scope ?? '',
    received_at: Date.now(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGithubOauthRefresh(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!ensureConfigured(env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Worker 未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '无效的 JSON 请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { refresh_token } = body;

  if (!refresh_token) {
    return new Response(JSON.stringify({ ok: false, error: '缺少 refresh_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: withBrowserUserAgent({ Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token,
      }),
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: `Token 刷新请求失败: ${error.message || error}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!tokenResponse.ok) {
    return new Response(JSON.stringify({ ok: false, error: `Token 刷新失败: HTTP ${tokenResponse.status}` }), {
      status: tokenResponse.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let data;
  try { data = await tokenResponse.json(); }
  catch { 
    return new Response(JSON.stringify({ ok: false, error: '解析 token 响应失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (data?.error) {
    return new Response(JSON.stringify({ ok: false, error: data.error_description || data.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!data?.access_token) {
    return new Response(JSON.stringify({ ok: false, error: '未收到 access_token' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    expires_in: data.expires_in ?? null,
    refresh_token: data.refresh_token ?? null,
    refresh_token_expires_in: data.refresh_token_expires_in ?? null,
    scope: data.scope ?? '',
    received_at: Date.now(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGithubOauthHook(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response({
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
