import checkDomainAvailabilityTool from './tools/check-domain-availability.js';
import fetchTool from './tools/fetch.js';
import getWeatherTool from './tools/get-weather.js';
import imageEditingTool from './tools/image-editing.js';
import imageGenerationTool from './tools/image-generation.js';
import musicPlaylistTool from './tools/music-playlist.js';
import urlContextTool from './tools/url-context.js';
import webSearchTool from './tools/web-search.js';
import duckduckgoSearchTool from './tools/duckduckgo-search.js';

export const tools = [
  getWeatherTool,
  webSearchTool,
  urlContextTool,
  // fetchTool,
  checkDomainAvailabilityTool,
  // imageGenerationTool,
  // imageEditingTool,
  // musicPlaylistTool,
  // duckduckgoSearchTool,
];

export const toolDeclarations = tools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}));

export const toolHandlers = Object.fromEntries(
  tools.map(({ name, handler }) => [name, handler]),
);
