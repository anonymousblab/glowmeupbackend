import assert from 'node:assert/strict';
import test from 'node:test';

import { configuration } from '../src/ai/engine/server/config.mjs';
import { OpenAIProvider } from '../src/ai/engine/server/openai.mjs';

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
    OPENAI_API_KEY: 'unit-test-key',
    OPENAI_ENABLE_LIVE: 'true',
    OPENAI_KEY_ROTATED_CONFIRMED: 'true',
    OPENAI_MAX_OUTPUT_TOKENS: '128',
    ...overrides,
  }).openai;
}

function success() {
  return {
    status: 'completed',
    output_text: '{"ok":true}',
    output: [],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function deferredClient() {
  const pending = [];
  const client = {
    responses: {
      create() {
        return {
          withResponse: () => new Promise((resolve) => {
            pending.push(() => resolve({
              data: success(),
              response: { status: 200 },
              request_id: 'mock-request',
            }));
          }),
        };
      },
    },
  };
  return { client, pending };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for mocked request');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('provider runs concurrent requests, bounds its queue, and releases slots', async () => {
  const { client, pending } = deferredClient();
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_MAX_CONCURRENT_REQUESTS: '2',
    OPENAI_MAX_QUEUE_SIZE: '1',
    OPENAI_QUEUE_TIMEOUT_MS: '1000',
  }), client);

  const first = provider.generate(request);
  const second = provider.generate(request);
  await waitFor(() => pending.length === 2);
  const queued = provider.generate(request);
  assert.equal(provider.diagnostics().active_requests, 2);
  assert.equal(provider.diagnostics().queued_requests, 1);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_QUEUE_FULL' && error.status === 429,
  );

  pending.shift()();
  await waitFor(() => pending.length === 2);
  pending.splice(0).forEach((resolve) => resolve());
  assert.deepEqual(await Promise.all([first, second, queued]), [
    { ok: true },
    { ok: true },
    { ok: true },
  ]);
  assert.equal(provider.diagnostics().active_requests, 0);
  assert.equal(provider.diagnostics().queued_requests, 0);
  assert.equal(provider.diagnostics().reserved_cost_usd, 0);
});

test('concurrent reservations cannot jointly exceed the process budget', async () => {
  const { client, pending } = deferredClient();
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_BUDGET_USD: '0.0007',
    OPENAI_MAX_CONCURRENT_REQUESTS: '2',
    OPENAI_MAX_CALLS_PER_WINDOW: '10',
  }), client);

  const first = provider.generate(request);
  await waitFor(() => pending.length === 1);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_BUDGET_CAP',
  );
  assert.equal(provider.diagnostics().reserved_cost_usd > 0, true);
  pending.shift()();
  assert.deepEqual(await first, { ok: true });
  assert.equal(provider.diagnostics().reserved_cost_usd, 0);
  assert.equal(provider.diagnostics().uncertain_cost_usd, 0);
  assert.equal(provider.diagnostics().estimated_cost_usd, 0.000006);
});

test('failed attempts conservatively retain their reservation and release concurrency slots', async () => {
  let calls = 0;
  const client = {
    responses: {
      create() {
        calls++;
        return {
          withResponse: async () => {
            if (calls === 1) throw { status: 503 };
            return { data: success(), response: { status: 200 }, request_id: 'mock-request' };
          },
        };
      },
    },
  };
  const provider = new OpenAIProvider(openaiConfig({
    OPENAI_BUDGET_USD: '0.0007',
    OPENAI_MAX_RETRIES: '0',
  }), client);

  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_UNAVAILABLE',
  );
  assert.equal(provider.diagnostics().active_requests, 0);
  assert.equal(provider.diagnostics().reserved_cost_usd, 0);
  assert.ok(provider.diagnostics().uncertain_cost_usd > 0);
  await assert.rejects(
    () => provider.generate(request),
    (error) => error.code === 'AI_BUDGET_CAP',
  );
  assert.equal(calls, 1);
});

test('transient OpenAI failures are retried only within the configured bound', async () => {
  let calls = 0;
  const client = {
    responses: {
      create() {
        calls++;
        return {
          withResponse: async () => {
            if (calls === 1) throw { status: 503 };
            return { data: success(), response: { status: 200 }, request_id: 'mock-request' };
          },
        };
      },
    },
  };
  const provider = new OpenAIProvider(openaiConfig({ OPENAI_MAX_RETRIES: '1' }), client);

  assert.deepEqual(await provider.generate(request), { ok: true });
  assert.equal(calls, 2);
  assert.equal(provider.diagnostics().calls_in_window, 2);
  assert.ok(provider.diagnostics().uncertain_cost_usd > 0);
  assert.equal(provider.diagnostics().active_requests, 0);
});

