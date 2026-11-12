import OpenAI from 'openai';
import { DomainError,ensure } from '../src/errors.mjs';
import { validate } from '../src/contracts.mjs';
import { modelRates, openaiConfigured } from './config.mjs';

// Conservative uncached estimate based on Standard pricing:
// https://developers.openai.com/api/docs/pricing
export { modelRates };
export function structuredSchema(schema){
  if(Array.isArray(schema))return schema.map(structuredSchema);
  if(!schema||typeof schema!=='object')return schema;
  const result={};
  for(const [key,value]of Object.entries(schema))if(key!=='uniqueItems')result[key]=structuredSchema(value);
  if('const'in result){const value=result.const;delete result.const;result.enum=[value];result.type=typeof value;}
  if(result.type==='object')ensure(result.additionalProperties===false&&Object.keys(result.properties??{}).every(key=>result.required?.includes(key)),'OPENAI_SCHEMA_UNSUPPORTED','Semua field output OpenAI harus required.');
  return result;
}
const quotaErrorCodes = new Set(['insufficient_quota', 'billing_hard_limit_reached']);
function isQuotaError(error){return quotaErrorCodes.has(error?.code);}

export function sanitizedOpenAIError(error){
  if(error instanceof DomainError)return error;
  if(['AbortError','APIConnectionTimeoutError','TimeoutError'].includes(error?.name))return new DomainError('AI_TIMEOUT','OpenAI terlalu lama merespons.',504,true);
  const status=Number(error?.status);
  if(status===400)return new DomainError('AI_REQUEST_REJECTED','OpenAI menolak request/model/schema. Periksa konfigurasi backend.',502);
  if(status===401)return new DomainError('AI_AUTH_FAILED','Kredensial OpenAI tidak valid.',503);
  if(status===403)return new DomainError('AI_PERMISSION_DENIED','Project tidak diizinkan menggunakan model OpenAI ini.',503);
  if(status===404)return new DomainError('AI_MODEL_UNAVAILABLE','Model OpenAI tidak tersedia pada project ini. Tidak ada pergantian model otomatis.',503);
  if(status===429)return new DomainError(isQuotaError(error)?'AI_QUOTA_EXHAUSTED':'AI_RATE_LIMITED',isQuotaError(error)?'Kuota/kredit OpenAI tidak tersedia.':'Rate limit OpenAI tercapai.',429,!isQuotaError(error));
  return new DomainError('AI_UNAVAILABLE','Layanan OpenAI tidak tersedia. Profil manual dan Suits Me tetap dapat dipakai.',503,true);
}

const retryableNetworkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENOTFOUND',
]);
const maximumRetryAfterMs = 5000;

function responseHeader(error, name) {
  const headers = error?.headers ?? error?.response?.headers;
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function retryDelayMs(error, retryNumber, maxRetries) {
  if (retryNumber >= maxRetries) return null;
  if (error instanceof DomainError && error.code !== 'AI_TIMEOUT') return null;

  const status = Number(error?.status);
  const networkCode = error?.cause?.code ?? error?.code;
  const retryable = error instanceof DomainError
    ? error.code === 'AI_TIMEOUT' && error.retryable
    : (status === 429 && !isQuotaError(error))
      || (status >= 500 && status <= 599)
      || retryableNetworkCodes.has(networkCode)
      || ['APIConnectionError', 'APIConnectionTimeoutError', 'TimeoutError'].includes(error?.name);
  if (!retryable) return null;

  const retryAfterMs = responseHeader(error, 'retry-after-ms');
  if (retryAfterMs !== null && Number.isFinite(Number(retryAfterMs))) {
    const delay = Math.max(0, Number(retryAfterMs));
    return delay <= maximumRetryAfterMs ? delay : null;
  }
  const retryAfter = responseHeader(error, 'retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) {
      const boundedDelay = Math.max(0, delay);
      return boundedDelay <= maximumRetryAfterMs ? boundedDelay : null;
    }
  }
  return Math.min(250 * (2 ** retryNumber), maximumRetryAfterMs);
}

function waitForRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(new DomainError('AI_CANCELLED', 'Request dibatalkan.', 499));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DomainError('AI_CANCELLED', 'Request dibatalkan.', 499));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class OpenAIProvider{
  kind = 'openai';
  #config;
  #client;
  #clock;
  #calls = 0;
  #callWindowStartedAt;
  #inputTokens = 0;
  #outputTokens = 0;
  #reserved = 0;
  #estimated = 0;
  #uncertain = 0;
  #active = 0;
  #queue = [];
  #verified = new Set();
  #last = null;

  constructor(config, client = null, clock = () => Date.now()) {
    this.#config = config;
    this.#client = client;
    this.#clock = clock;
    this.#callWindowStartedAt = clock();
  }

  #refreshCallWindow() {
    const now = this.#clock();
    if (now - this.#callWindowStartedAt >= this.#config.callWindowMs) {
      this.#calls = 0;
      this.#callWindowStartedAt = now;
    }
  }

  #cleanupQueueEntry(entry) {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort);
  }

  #removeQueueEntry(entry) {
    const index = this.#queue.indexOf(entry);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#cleanupQueueEntry(entry);
  }

  #acquire(signal) {
    ensure(!signal?.aborted, 'AI_CANCELLED', 'Request dibatalkan.', 499);
    if (this.#active < this.#config.maxConcurrentRequests) {
      this.#active++;
      return Promise.resolve();
    }
    if (this.#queue.length >= this.#config.maxQueueSize) {
      console.warn('[glowmeup-ai] request queue full', {
        active: this.#active,
        queued: this.#queue.length,
        queueLimit: this.#config.maxQueueSize,
      });
      return Promise.reject(new DomainError('AI_QUEUE_FULL', 'Antrean AI sedang penuh. Coba lagi sebentar.', 429, true));
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, timer: null, onAbort: null };
      entry.onAbort = () => {
        this.#removeQueueEntry(entry);
        reject(new DomainError('AI_CANCELLED', 'Request dibatalkan.', 499));
      };
      this.#queue.push(entry);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      entry.timer = setTimeout(() => {
        this.#removeQueueEntry(entry);
        reject(new DomainError('AI_QUEUE_TIMEOUT', 'Request terlalu lama menunggu antrean AI.', 429, true));
      }, this.#config.queueTimeoutMs);
    });
  }

  #release() {
    while (this.#queue.length) {
      const entry = this.#queue.shift();
      this.#cleanupQueueEntry(entry);
      if (entry.signal?.aborted) {
        entry.reject(new DomainError('AI_CANCELLED', 'Request dibatalkan.', 499));
        continue;
      }
      entry.resolve();
      return;
    }
    this.#active--;
  }

  #reserve(reservation, model) {
    this.#refreshCallWindow();
    if (this.#calls >= this.#config.maxCalls) {
      console.warn('[glowmeup-ai] request window exhausted', {
        model,
        maxCalls: this.#config.maxCalls,
        callWindowMs: this.#config.callWindowMs,
      });
      throw new DomainError('AI_CALL_CAP', 'Batas panggilan AI pada jendela waktu ini tercapai.', 429, true);
    }
    const used = this.#estimated + this.#uncertain + this.#reserved;
    if (used + reservation > this.#config.budgetUsd) {
      console.warn('[glowmeup-ai] process budget exhausted', {
        model,
        budgetUsd: this.#config.budgetUsd,
        usedEstimateUsd: used,
        requestReserveUsd: reservation,
      });
      throw new DomainError('AI_BUDGET_CAP', 'Batas estimasi budget AI untuk proses ini tercapai.', 429);
    }
    this.#reserved += reservation;
    this.#calls++;
  }

  #settleReservation(reservation, actualCost = null) {
    this.#reserved -= reservation;
    if (actualCost === null) this.#uncertain += reservation;
    else this.#estimated += actualCost;
  }

  async #sendRequest({ model, instructions, contextText, schema, image, task, rates, signal }) {
    const controller = new AbortController();
    let timer;
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const content = [{ type: 'input_text', text: contextText }];
      if (image) content.push({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}`, detail: 'low' });
      const pending = this.#client.responses.create({
        model,
        instructions,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: task === 'vision' ? 'know_me_vision' : 'glowy_response', strict: true, schema } },
        store: false,
        max_output_tokens: this.#config.maxOutputTokens,
        ...(rates.reasoningEffort ? { reasoning: { effort: rates.reasoningEffort } } : {}),
      }, {
        maxRetries: 0,
        timeout: this.#config.timeoutMs,
        signal: controller.signal,
      }).withResponse();
      return await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new DomainError('AI_TIMEOUT', 'OpenAI terlalu lama merespons.', 504, true));
          }, this.#config.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (signal?.aborted) throw new DomainError('AI_CANCELLED', 'Request dibatalkan.', 499);
      if (timedOut) throw new DomainError('AI_TIMEOUT', 'OpenAI terlalu lama merespons.', 504, true);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  diagnostics() {
    const c = this.#config;
    return {
      mode: openaiConfigured(c) ? (this.#verified.size ? 'openai_live_verified' : 'openai_configured_unverified') : 'offline',
      selected_provider: 'openai',
      model: c.chatModel,
      chat_model: c.chatModel,
      vision_model: c.visionModel,
      model_access_verified: this.#verified.size > 0,
      live_tested: this.#verified.size > 0,
      calls_this_run: this.#calls,
      calls_in_window: this.#calls,
      call_cap: c.maxCalls,
      call_window_ms: c.callWindowMs,
      active_requests: this.#active,
      queued_requests: this.#queue.length,
      max_concurrent_requests: c.maxConcurrentRequests,
      max_queue_size: c.maxQueueSize,
      input_tokens: this.#inputTokens,
      output_tokens: this.#outputTokens,
      estimated_cost_usd: this.#estimated,
      uncertain_cost_usd: this.#uncertain,
      reserved_cost_usd: this.#reserved,
      budget_used_estimate_usd: this.#estimated + this.#uncertain + this.#reserved,
      budget_usd: c.budgetUsd,
      verified_models: [...this.#verified],
    };
  }

  lastEvidence() {
    return this.#last ? structuredClone(this.#last) : null;
  }

  async generate({ instructions, context, schema, image = null, task = 'chat', signal = null }) {
    const c = this.#config;
    ensure(openaiConfigured(c), 'AI_NOT_CONFIGURED', 'OpenAI belum aktif atau key baru belum dikonfirmasi. Gunakan profil manual dan Suits Me.', 503);
    ensure(!signal?.aborted, 'AI_CANCELLED', 'Request dibatalkan.', 499);

    const model = task === 'vision' || image ? c.visionModel : c.chatModel;
    const rates = modelRates(model);
    ensure(rates, 'AI_PRICING_UNVERIFIED', 'Tarif model ini belum diverifikasi.', 503);
    const contextText = JSON.stringify(context);
    ensure(Buffer.byteLength(contextText) <= 40000, 'CONTEXT_TOO_LARGE', 'Konteks terlalu panjang.');
    const format = structuredSchema(schema);
    const inputReserve = Buffer.byteLength(JSON.stringify({ instructions, context, schema: format })) + 4096 + (image ? 16000 : 0);
    const reservation = (inputReserve * rates.input + c.maxOutputTokens * rates.output) / 1000000;
    ensure(Number.isFinite(reservation), 'INVALID_CONFIG', 'Estimasi biaya request tidak valid.', 500);

    await this.#acquire(signal);
    let evidence = {
      provider: 'openai',
      model,
      http_status: null,
      status: 'FAILED',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: null,
    };
    try {
      this.#client ??= new OpenAI({
        apiKey: c.key,
        baseURL: 'https://api.openai.com/v1',
        logLevel: 'off',
        maxRetries: 0,
        timeout: c.timeoutMs,
      });

      let retryNumber = 0;
      while (true) {
        ensure(!signal?.aborted, 'AI_CANCELLED', 'Request dibatalkan.', 499);
        this.#reserve(reservation, model);
        let reservationHeld = true;
        try {
          const { data, response, request_id } = await this.#sendRequest({
            model,
            instructions,
            contextText,
            schema: format,
            image,
            task,
            rates,
            signal,
          });
          const input = data.usage?.input_tokens;
          const output = data.usage?.output_tokens;
          const hasUsage = Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0;
          let actualCost = null;
          if (hasUsage) {
            actualCost = (input * rates.input + output * rates.output) / 1000000;
            this.#inputTokens += input;
            this.#outputTokens += output;
          }
          this.#settleReservation(reservation, actualCost);
          reservationHeld = false;
          evidence = {
            provider: 'openai',
            model: data.model ?? model,
            http_status: response.status,
            request_id: request_id ?? null,
            status: 'FAILED',
            input_tokens: hasUsage ? input : 0,
            output_tokens: hasUsage ? output : 0,
            estimated_cost_usd: actualCost,
          };
          this.#last = structuredClone(evidence);
          console.info('[glowmeup-ai] OpenAI usage', {
            model,
            inputTokens: hasUsage ? input : null,
            outputTokens: hasUsage ? output : null,
            reservationUsd: reservation,
            actualEstimateUsd: actualCost,
            usageAvailable: hasUsage,
          });

          ensure(data.status === 'completed', 'AI_INCOMPLETE', 'OpenAI tidak menghasilkan jawaban lengkap.', 502);
          ensure(!(data.output ?? []).some((item) => (item.content ?? []).some((part) => part.type === 'refusal')), 'AI_REFUSED', 'OpenAI tidak dapat memenuhi permintaan ini.', 422);
          const text = data.output_text ?? (data.output ?? [])
            .flatMap((item) => item.content ?? [])
            .filter((part) => part.type === 'output_text')
            .map((part) => part.text)
            .join('');
          ensure(typeof text === 'string' && text.trim().length > 0 && text.length <= 20000, 'INVALID_AI_RESPONSE', 'Jawaban OpenAI kosong atau terlalu panjang.', 502);
          let result;
          try {
            result = JSON.parse(text);
            validate(schema, result);
          } catch {
            throw new DomainError('INVALID_AI_RESPONSE', 'Jawaban OpenAI tidak sesuai kontrak JSON.', 502);
          }
          this.#verified.add(model);
          evidence = { ...evidence, status: 'PASS' };
          this.#last = structuredClone(evidence);
          return result;
        } catch (error) {
          if (reservationHeld) {
            this.#settleReservation(reservation);
            console.warn('[glowmeup-ai] usage unavailable; retaining maximum reservation', {
              model,
              reservationUsd: reservation,
            });
          }
          const delay = retryDelayMs(error, retryNumber, c.maxRetries);
          if (delay === null) throw error;
          const safe = sanitizedOpenAIError(error);
          console.warn('[glowmeup-ai] retrying transient OpenAI failure', {
            code: safe.code,
            model,
            retry: retryNumber + 1,
            delayMs: delay,
          });
          retryNumber++;
          await waitForRetry(delay, signal);
        }
      }
    } catch (error) {
      const safe = sanitizedOpenAIError(error);
      const networkCode = error?.cause?.code ?? error?.code;
      evidence = {
        ...evidence,
        status: 'FAILED',
        error_code: safe.code,
        http_status: evidence.http_status ?? (Number(error?.status) || null),
        network_failure_code: retryableNetworkCodes.has(networkCode) ? networkCode : null,
      };
      this.#last = structuredClone(evidence);
      console.warn('[glowmeup-ai] OpenAI request failed', {
        code: safe.code,
        httpStatus: evidence.http_status,
        model,
        networkFailureCode: evidence.network_failure_code,
      });
      throw safe;
    } finally {
      this.#release();
    }
  }
}
