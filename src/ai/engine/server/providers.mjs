import { GeminiProvider } from './gemini.mjs';
import { OpenAIProvider } from './openai.mjs';
import { DomainError } from '../src/errors.mjs';
export function createProvider(config){
  if(config.provider==='gemini')return new GeminiProvider(config);
  if(config.provider==='disabled')return {kind:'disabled',diagnostics:()=>({mode:'offline',selected_provider:'disabled',live_tested:false}),async generate(){throw new DomainError('AI_NOT_CONFIGURED','Provider AI dinonaktifkan.',503);}};
  return new OpenAIProvider(config.openai);
}
