import { ensure } from "../src/errors.mjs";
export function configuration(env = process.env) {
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] ?? fallback);
    ensure(
      Number.isInteger(value) && value >= min && value <= max,
      "INVALID_CONFIG",
      `${key} tidak valid.`,
    );
    return value;
  };
  const model = env.GEMINI_MODEL ?? "";
  ensure(
    !model || /^gemini-[a-z0-9.-]+$/.test(model),
    "INVALID_CONFIG",
    "Nama model tidak valid.",
  );
  const token = env.GLOWY_LOCAL_TOKEN ?? "";
  ensure(
    !token || token.length >= 32,
    "INVALID_CONFIG",
    "Token lokal minimal 32 karakter.",
  );
  const provider = env.AI_PROVIDER ?? "openai";
  ensure(
    ["openai", "gemini", "disabled"].includes(provider),
    "INVALID_CONFIG",
    "AI_PROVIDER tidak didukung.",
  );
  const chatModel = env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini",
    visionModel = env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
  ensure(
    [chatModel, visionModel].every((value) =>
      /^gpt-[a-zA-Z0-9.-]+$/.test(value),
    ),
    "INVALID_CONFIG",
    "Nama model OpenAI tidak valid.",
  );
  const budgetUsd = Number(env.OPENAI_BUDGET_USD ?? 0.5);
  ensure(
    Number.isFinite(budgetUsd) && budgetUsd > 0 && budgetUsd <= 0.5,
    "INVALID_CONFIG",
    "Budget awal OpenAI harus >0 dan <= US$0.50.",
  );
  return {
    key: env.GEMINI_API_KEY ?? "",
    model,
    token,
    live: env.GEMINI_ENABLE_LIVE === "true",
    provider,
    openai: {
      key: env.OPENAI_API_KEY ?? "",
      chatModel,
      visionModel,
      live: env.OPENAI_ENABLE_LIVE === "true",
      rotatedKeyConfirmed: env.OPENAI_KEY_ROTATED_CONFIRMED === "false",
      budgetUsd,
      maxCalls: number("OPENAI_MAX_CALLS_PER_RUN", 8, 1, 20),
      timeoutMs: number("OPENAI_TIMEOUT_MS", 25000, 100, 60000),
      maxOutputTokens: number("OPENAI_MAX_OUTPUT_TOKENS", 1200, 128, 2048),
    },
    accessConfirmed: env.GEMINI_MODEL_ACCESS_CONFIRMED === "true",
    freeTierConfirmed: env.GEMINI_FREE_TIER_CONFIRMED === "true",
    port: number("GLOWY_PORT", 8765, 1024, 65535),
    maxImageBytes: number("GLOWY_MAX_IMAGE_BYTES", 2097152, 1024, 5242880),
    maxCalls: number("GEMINI_MAX_CALLS_PER_RUN", 10, 1, 100),
    timeoutMs: number("GEMINI_TIMEOUT_MS", 20000, 100, 60000),
  };
}
export function providerConfigured(c) {
  return Boolean(
    c.key && c.model && c.live && c.accessConfirmed && c.freeTierConfirmed,
  );
}
export function openaiConfigured(c) {
  return Boolean(
    c.key && c.chatModel && c.visionModel && c.live && c.rotatedKeyConfirmed,
  );
}
