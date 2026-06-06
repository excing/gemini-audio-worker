import { clampInteger, withBrowserUserAgent } from '../tool-utils.js';

const API_BASE_URL = 'https://api.chksz.top/api';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_LEVEL = 'lossless';
const ALLOWED_LEVELS = new Set(['standard', 'exhigh', 'lossless', 'hires', 'jymaster', 'sky', 'jyeffect']);

const buildUrl = (path, params) => {
  const url = new URL(`${API_BASE_URL}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: withBrowserUserAgent({
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    }),
  });

  if (!response.ok) {
    throw new Error(`音乐 API 请求失败: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.code && Number(payload.code) !== 200) {
    throw new Error(payload?.msg || '音乐 API 返回错误');
  }

  return payload;
};

const normalizeArtists = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.name || '').trim();
        return '';
      })
      .filter(Boolean)
      .join(' / ');
  }

  return String(value || '').trim();
};

const normalizeSearchSong = (song) => ({
  id: song?.id ?? null,
  name: String(song?.name || '').trim(),
  artists: normalizeArtists(song?.artists || song?.ar),
  album: String(song?.album || song?.al?.name || '').trim(),
  cover: String(song?.picUrl || song?.al?.picUrl || '').trim(),
  duration: Number(song?.duration || song?.dt || 0) || 0,
});

const normalizeDetail = (detail) => ({
  id: detail?.id ?? null,
  audio_url: String(detail?.url || '').trim(),
  bitrate: Number(detail?.br || 0) || 0,
  level: String(detail?.level || '').trim(),
  size: Number(detail?.size || 0) || 0,
  md5: String(detail?.md5 || '').trim(),
  name: String(detail?.name || '').trim(),
  artist: String(detail?.artist || '').trim(),
  album: String(detail?.album || '').trim(),
  cover: String(detail?.picUrl || '').trim(),
});

const normalizeLyrics = (lyricData) => ({
  lyric: String(lyricData?.lrc || '').trim(),
  translated_lyric: String(lyricData?.tlyric || '').trim(),
  roman_lyric: String(lyricData?.romalrc || '').trim(),
  karaoke_lyric: String(lyricData?.klyric || '').trim(),
});

const enrichSong = async (song, level) => {
  const baseSong = normalizeSearchSong(song);
  if (!baseSong.id) {
    return { ...baseSong, detail_error: '缺少歌曲 ID，无法补全播放信息' };
  }

  const detailUrl = buildUrl('163_music', { id: baseSong.id, level });
  const lyricUrl = buildUrl('163_lyric', { id: baseSong.id });

  const [detailResult, lyricResult] = await Promise.allSettled([
    fetchJson(detailUrl),
    fetchJson(lyricUrl),
  ]);

  const detailData = detailResult.status === 'fulfilled' ? normalizeDetail(detailResult.value?.data) : null;
  const lyricData = lyricResult.status === 'fulfilled' ? normalizeLyrics(lyricResult.value?.data) : null;

  return {
    ...baseSong,
    artist: detailData?.artist || baseSong.artists,
    album: detailData?.album || baseSong.album,
    cover: detailData?.cover || baseSong.cover,
    playback: {
      audio_url: detailData?.audio_url || '',
      bitrate: detailData?.bitrate || 0,
      level: detailData?.level || level,
      size: detailData?.size || 0,
      md5: detailData?.md5 || '',
    },
    lyric: lyricData?.lyric || '',
    translated_lyric: lyricData?.translated_lyric || '',
    roman_lyric: lyricData?.roman_lyric || '',
    karaoke_lyric: lyricData?.karaoke_lyric || '',
    errors: [
      ...(detailResult.status === 'rejected' ? [detailResult.reason?.message || '获取音频详情失败'] : []),
      ...(lyricResult.status === 'rejected' ? [lyricResult.reason?.message || '获取歌词失败'] : []),
    ],
  };
};

const handler = async (id, name, { keyword, limit = DEFAULT_LIMIT, offset = 0, level = DEFAULT_LEVEL } = {}) => {
  const searchKeyword = String(keyword || '').trim();
  if (!searchKeyword) {
    throw new Error('musicPlaylist keyword 不能为空');
  }

  const normalizedLimit = clampInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const normalizedOffset = clampInteger(offset, 0, 0, 1000);
  const normalizedLevel = String(level || DEFAULT_LEVEL).trim().toLowerCase();
  const selectedLevel = ALLOWED_LEVELS.has(normalizedLevel) ? normalizedLevel : DEFAULT_LEVEL;

  const searchUrl = buildUrl('163_search', {
    keyword: searchKeyword,
    limit: normalizedLimit,
    offset: normalizedOffset,
  });
  const searchPayload = await fetchJson(searchUrl);
  const songs = Array.isArray(searchPayload?.data?.songs)
    ? searchPayload.data.songs
    : Array.isArray(searchPayload?.data)
      ? searchPayload.data
      : [];

  const playlist = await Promise.all(
    songs.slice(0, normalizedLimit).map((song) => enrichSong(song, selectedLevel)),
  );

  return {
    keyword: searchKeyword,
    limit: normalizedLimit,
    offset: normalizedOffset,
    level: selectedLevel,
    total: Number(searchPayload?.data?.total || songs.length) || songs.length,
    playlist,
  };
};

export default {
  name: 'musicPlaylist',
  description: '搜索网易云音乐并返回完整播放列表。会先按关键词搜索歌曲，再补全每首歌的播放链接、封面和歌词；默认返回 10 首。',
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '搜索关键词，例如歌曲名、歌手名或专辑名。',
      },
      limit: {
        type: 'number',
        description: '返回歌曲数量，默认 10，最大 20。',
      },
      offset: {
        type: 'number',
        description: '搜索偏移量，默认 0。',
      },
      level: {
        type: 'string',
        description: '音质等级，可选 standard、exhigh、lossless、hires、jymaster、sky、jyeffect。默认 lossless。',
      },
    },
    required: ['keyword'],
  },
  handler,
};
