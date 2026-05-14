export const decodeHtmlEntities = (value = '') => {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  };

  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (match, entity) => {
    const normalizedEntity = entity.toLowerCase();
    if (normalizedEntity.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalizedEntity.slice(2), 16));
    }
    if (normalizedEntity.startsWith('#')) {
      return String.fromCodePoint(parseInt(normalizedEntity.slice(1), 10));
    }
    return entities[normalizedEntity] || match;
  });
};

export const stripHtml = (value = '') => decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export const clampInteger = (value, defaultValue, min, max) => Math.min(Math.max(Number.parseInt(value, 10) || defaultValue, min), max);

export const isAllowedFetchProtocol = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export const extractTitle = (html) => {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
};

export const htmlToText = (html) => stripHtml(
  String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:br|p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, '\n'),
);
