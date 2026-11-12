import assert from 'node:assert/strict';
import test from 'node:test';

import { configuration, modelRates, openaiConfigured } from '../src/ai/engine/server/config.mjs';
import { OpenAIProvider, sanitizedOpenAIError } from '../src/ai/engine/server/openai.mjs';

const request = {
  instructions: 'Be concise.',
  context: { message: 'Suggest an outfit.' },
  schema: {
    type: 'object',
    required: ['ok'],
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
  },
};

function openaiConfig(overrides = {}) {
  return configuration({
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'unit-test-key',
    OPENAI_ENABLE_LIVE: 'true',
    OPENAI_KEY_ROTATED_CONFIRMED: 'true',
    OPENAI_MAX_OUTPUT_TOKENS: '128',
    ...overrides,
  }).openai;
}

function mockClient(handler = async () => ({
  status: 'completed',
  output_text: '{"ok":true}',
  output: [],
  usage: { input_tokens: 10, output_tokens: 10 },
})) {
  const calls = [];
  return {
    calls,
    client: {
      responses: {
        create(body, options) {
          calls.push({ body, options });
          return {
            withResponse: async () => ({
              data: await handler(body, options),
              response: { status: 200 },
              request_id: 'mock-request',
            }),
          };
        },
      },
    },
  };
}

test('budget accepts values above $0.50 and rejects invalid amounts', () => {
  assert.equal(configuration({ OPENAI_BUDGET_USD: '1.25' }).openai.budgetUsd, 1.25);
  for (const value of ['0', '-0.01', 'NaN', 'Infinity', 'not-a-number']) {
    assert.throws(
      () => configuration({ OPENAI_BUDGET_USD: value }),
      (error) => error.code === 'INVALID_CONFIG',
    );
  }
});

test('OpenAI key confirmation follows explicit true/false environment values', () => {
  const base = { OPENAI_API_KEY: 'unit-test-key', OPENAI_ENABLE_LIVE: 'true' };
  assert.equal(openaiConfigured(configuration({
    ...base,
    OPENAI_KEY_ROTATED_CONFIRMED: 'false',
  }).openai), false);
  assert.equal(openaiConfigured(configuration({
    ...base,
    OPENAI_KEY_ROTATED_CONFIRMED: 'true',
  }).openai), true);
});

test('only audited OpenAI model identifiers have configured pricing', () => {
  const defaults = configuration({}).openai;
  assert.equal(defaults.chatModel, 'gpt-6-luna');
  assert.equal(defaults.visionModel, 'gpt-6.1-terra');
  assert.deepEqual(modelRates('gpt-4.1-mini'), { input: 0.4, output: 1.6 });
  assert.deepEqual(modelRates('gpt-4.1-mini-2025-04-14'), { input: 0.4, output: 1.6 });
  assert.deepEqual(modelRates('gpt-6-luna'), { input: 0.1, output: 0.5, reasoningEffort: 'none' });
  assert.deepEqual(modelRates('gpt-6.1-terra'), { input: 1, output: 5, reasoningEffort: 'none' });
  assert.equal(modelRates('gpt-unknown'), null);
  assert.throws(
    () => configuration({ OPENAI_CHAT_MODEL: 'gpt-unknown' }),
    (error) => error.code === 'INVALID_CONFIG',
  );
});

test('embedded provider preserves audited source model selection and reasoning settings', async () => {
  const bodies = [];
  const { client } = mockClient(async (body) => {
    bodies.push(body);
    return {
      status: 'completed',
      output_text: '{"ok":true}',
      output: [],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  });
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_CHAT_MODEL: 'gpt-6-luna',
    OPENAI_VISION_MODEL: 'gpt-6.1-terra',
  }), client);

  await provider.generate(request);
  await provider.generate({
    ...request,
    task: 'vision',
    image: { mimeType: 'image/jpeg', data: 'dGVzdA==' },
  });

  assert.deepEqual(bodies.map((body) => body.model), ['gpt-6-luna', 'gpt-6.1-terra']);
  assert.ok(bodies.every((body) => body.reasoning.effort === 'none'));
});

test('budget exhaustion persists across call-window rollover without another API call', async () => {
  let now = 1000;
  const { client, calls } = mockClient();
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_BUDGET_USD: '0.0007',
    OPENAI_MAX_CALLS_PER_WINDOW: '1',
    OPENAI_CALL_WINDOW_MS: '60000',
  }), client, () => now);

  assert.equal(openaiConfigured(openaiConfig()), true);
  assert.deepEqual(await provider.generate(request), { ok: true });
  const reservedAfterFirstCall = provider.diagnostics().reserved_cost_usd;
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_CALL_CAP' && error.retryable === true,
  );

  now += 60000;
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_BUDGET_CAP' && error.status === 429,
  );
  assert.equal(calls.length, 1);
  assert.equal(provider.diagnostics().reserved_cost_usd, reservedAfterFirstCall);
  assert.equal(provider.diagnostics().calls_in_window, 0);
});

test('OpenAI quota exhaustion and rate limiting remain distinct with SDK retries disabled', async () => {
  assert.equal(sanitizedOpenAIError({ status: 429, code: 'insufficient_quota' }).code, 'AI_QUOTA_EXHAUSTED');
  assert.equal(sanitizedOpenAIError({ status: 429, code: 'rate_limit_exceeded' }).code, 'AI_RATE_LIMITED');

  const { client, calls } = mockClient(async () => {
    throw { status: 429, code: 'insufficient_quota' };
  });
  const provider = new OpenAIProvider(openaiConfig(), client);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_QUOTA_EXHAUSTED' && error.retryable === false,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRetries, 0);
});
