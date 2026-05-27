// 入口: 把 /api/github/* 路由分派给具体模块.
import { handleGithubOauthCallback, handleGithubOauthRefresh } from './oauth.js';

export async function handleGithubRequest(request, env, url) {
  switch (url.pathname) {
    case '/api/github/auth/callback':
      return handleGithubOauthCallback(request, env, url);
    case '/api/github/auth/refresh':
      return handleGithubOauthRefresh(request, env, url);
    default:
      return null;
  }
}
