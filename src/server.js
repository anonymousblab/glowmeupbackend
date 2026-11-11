import { readConfig } from './config.js';
import { createApp } from './app.js';
import { createPool } from './database.js';

const config = readConfig();
createApp({
  database: createPool(config.databaseUrl),
  corsOrigin: config.corsOrigin,
  openaiApiKey: config.openaiApiKey,
  openaiModel: config.openaiModel,
  aiEnabled: config.aiEnabled,
}).listen(config.port, () => {
  console.log(`GlowMeUp API listening on port ${config.port}`);
});
