import { readConfig } from './config.js';
import { createApp } from './app.js';
import { createPool } from './database.js';
import { GlowyAiService } from './ai/service.js';

const config = readConfig();
let ai = null;
try {
  ai = new GlowyAiService();
  console.log(`Glowy AI provider: ${JSON.stringify(ai.diagnostics().mode)}`);
} catch (error) {
  console.error(`Glowy AI disabled: ${error.message}`);
}
createApp({
  database: createPool(config.databaseUrl),
  corsOrigin: config.corsOrigin,
  ai,
  aiRequestLimit: ai?.requestLimits(),
}).listen(config.port, () => {
  console.log(`GlowMeUp API listening on port ${config.port}`);
});
