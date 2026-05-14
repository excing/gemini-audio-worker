import fetchTool from './tools/fetch.js';
import getWeatherTool from './tools/get-weather.js';
import imageGenerationTool from './tools/image-generation.js';
import urlContextTool from './tools/url-context.js';
import webSearchTool from './tools/web-search.js';

export const tools = [
  getWeatherTool,
  webSearchTool,
  urlContextTool,
  fetchTool,
  imageGenerationTool,
];

export const toolDeclarations = tools.map(({ name, description, parameters }) => ({
  name,
  description,
  parameters,
}));

export const toolHandlers = Object.fromEntries(
  tools.map(({ name, handler }) => [name, handler]),
);
