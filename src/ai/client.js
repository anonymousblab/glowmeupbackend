import OpenAI from 'openai';

export function createAiClient({ apiKey = '', enabled = false }) {
  // The client is created only after the owner enables AI and provides a key.
  return enabled && apiKey ? new OpenAI({ apiKey }) : null;
}
