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

test('missing API key leaves live OpenAI unavailable without making a request', async () => {
  const provider = new OpenAIProvider(configuration({
    OPENAI_ENABLE_LIVE: 'true',
    OPENAI_KEY_ROTATED_CONFIRMED: 'true',
  }).openai);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_NOT_CONFIGURED' && error.status === 503,
  );
  assert.equal(provider.diagnostics().calls_in_window, 0);
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

test('successful usage reconciles its reservation and budget persists across window rollover', async () => {
  let now = 1000;
  const { client, calls } = mockClient();
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_BUDGET_USD: '0.0007',
    OPENAI_MAX_CALLS_PER_WINDOW: '1',
    OPENAI_CALL_WINDOW_MS: '60000',
  }), client, () => now);

  assert.equal(openaiConfigured(openaiConfig()), true);
  assert.deepEqual(await provider.generate(request), { ok: true });
  assert.equal(provider.diagnostics().reserved_cost_usd, 0);
  assert.equal(provider.diagnostics().estimated_cost_usd, 0.000006);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_CALL_CAP' && error.retryable === true,
  );

  now += 60000;
  assert.deepEqual(await provider.generate(request), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(provider.diagnostics().reserved_cost_usd, 0);
  assert.equal(provider.diagnostics().calls_in_window, 1);
  assert.equal(provider.diagnostics().estimated_cost_usd, 0.000012);
});

test('call limits above 20 and per-user limits are configurable', () => {
  const { openai } = configuration({
    OPENAI_MAX_CALLS_PER_WINDOW: '100',
    OPENAI_MAX_CALLS_PER_USER_PER_WINDOW: '50',
  });
  assert.equal(openai.maxCalls, 100);
  assert.equal(openai.maxCallsPerUserPerWindow, 50);
  assert.equal(openai.maxConcurrentRequests, 3);
  assert.equal(openai.maxQueueSize, 10);
  assert.throws(
    () => configuration({ OPENAI_MAX_CONCURRENT_REQUESTS: '0' }),
    (error) => error.code === 'INVALID_CONFIG',
  );
});

test('OpenAI quota exhaustion and rate limiting remain distinct and quota is never retried', async () => {
  assert.equal(sanitizedOpenAIError({ status: 429, code: 'insufficient_quota' }).code, 'AI_QUOTA_EXHAUSTED');
  assert.equal(sanitizedOpenAIError({ status: 429, code: 'billing_hard_limit_reached' }).code, 'AI_QUOTA_EXHAUSTED');
  assert.equal(sanitizedOpenAIError({ status: 429, code: 'rate_limit_exceeded' }).code, 'AI_RATE_LIMITED');
  assert.equal(sanitizedOpenAIError({ status: 401 }).code, 'AI_AUTH_FAILED');
  assert.equal(sanitizedOpenAIError({ status: 404 }).code, 'AI_MODEL_UNAVAILABLE');
  assert.equal(sanitizedOpenAIError({ status: 503 }).code, 'AI_UNAVAILABLE');

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

  const { client: billingClient, calls: billingCalls } = mockClient(async () => {
    throw { status: 429, code: 'billing_hard_limit_reached' };
  });
  const billingProvider = new OpenAIProvider(openaiConfig({ OPENAI_MAX_RETRIES: '1' }), billingClient);
  await assert.rejects(
    () => billingProvider.generate(request),
    (error) => error.code === 'AI_QUOTA_EXHAUSTED' && error.retryable === false,
  );
  assert.equal(billingCalls.length, 1);
});
