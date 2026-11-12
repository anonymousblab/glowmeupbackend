// Adapter between the Express backend and the ported ai-offline engine
// (backend/src/ai/engine). The engine modules are copied verbatim from the
// ai-offline package; this file maps the backend's stored questionnaire and
// catalog onto the engine's GlowProfile v0.3 contract and chat/vision flows.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { configuration } from './engine/server/config.mjs';
import { createProvider } from './engine/server/providers.mjs';
import { glowyInstructions } from './engine/server/instructions.mjs';
import { ConversationHistory } from './engine/server/history.mjs';
import { decodeImage } from './engine/server/images.mjs';
import {
  extendedVisionSchema,
  validateExtendedVision,
  emptyVision,
  visionInstructions,
} from './engine/server/vision.mjs';
import { buildGlowyContext, validateGlowyOutput } from './engine/src/glowy.mjs';
import { rankProducts } from './engine/src/recommender.mjs';
import { emptyProfile } from './engine/src/know-me.mjs';
import { validateProfile, glowyOutputSchema } from './engine/src/contracts.mjs';
import { ensure, copy } from './engine/src/errors.mjs';

export { DomainError } from './engine/src/errors.mjs';

const styleByVibe = {
  Casual: ['minimalist', 'sporty'],
  Minimal: ['minimalist', 'classic'],
  Street: ['streetwear', 'edgy'],
  Formal: ['classic', 'minimalist'],
  Chic: ['classic', 'romantic'],
  Other: [],
};
const colorsByPreference = {
  Cool: ['blue', 'blue_green', 'pink', 'grey'],
  Warm: ['brown', 'beige', 'red', 'green'],
  Neutral: ['black', 'white', 'grey', 'beige'],
};

export function loadCatalog() {
  const file = fileURLToPath(new URL('../data/fashion_dataset.json', import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')).annotations;
}

export function questionnaireToGlowProfile(questionnaire) {
  if (!questionnaire?.vibe && !questionnaire?.color) return null;
  const profile = emptyProfile();
  const [primary = null, secondary = null] = styleByVibe[questionnaire.vibe] ?? [];
  profile.style_profile.primary = primary;
  profile.style_profile.secondary = secondary;
  if (primary) {
    profile.style_profile.source = 'user_confirmed';
    profile.style_profile.confirmed = true;
    profile.provenance['style_profile.primary'] = 'user_confirmed';
    profile.provenance['style_profile.secondary'] = 'user_confirmed';
  }
  const liked = colorsByPreference[questionnaire.color] ?? [];
  if (liked.length) {
    profile.color_profile.liked_color_families = liked;
    profile.provenance['color_profile.liked_color_families'] = 'user_confirmed';
  }
  profile.lifestyle.occasions = ['everyday'];
  profile.provenance['lifestyle.occasions'] = 'user_confirmed';
  if (questionnaire.explore === 'Modest Fashion') {
    profile.preferences.coverage_requirements = ['shoulders_covered', 'arms_covered', 'legs_covered'];
    profile.provenance['preferences.coverage_requirements'] = 'user_confirmed';
  }
  return validateProfile(profile);
}

export class GlowyAiService {
  #config;
  #provider;
  #history = new ConversationHistory();
  #proposals = new Map();

  constructor({ env = process.env, catalog = loadCatalog(), clock = () => Date.now() } = {}) {
    this.catalog = copy(catalog);
    this.clock = clock;
    this.#config = configuration(env);
    this.#provider = createProvider(this.#config);
  }

  enabled() {
    return this.#provider.diagnostics().mode !== 'offline';
  }

  diagnostics() {
    return this.#provider.diagnostics();
  }

  requestLimits() {
    return {
      maxCallsPerUserPerWindow: this.#config.openai.maxCallsPerUserPerWindow,
      windowMs: this.#config.openai.callWindowMs,
    };
  }

  async chat({ userId, questionnaire = null, message, productId = null, image = null, imageConsent = false }) {
    const profile = questionnaireToGlowProfile(questionnaire);
    let attachment = null;
    if (image) {
      ensure(imageConsent === true, 'CONSENT_REQUIRED', 'Persetujuan pengiriman gambar diperlukan.');
      attachment = await decodeImage(image, this.#config.maxImageBytes);
    }
    let candidates = profile ? rankProducts(profile, this.catalog, { limit: 50, demoOnly: true }) : [];
    if (productId && !profile) {
      ensure(this.catalog.some((p) => p.product_id === productId), 'UNKNOWN_PRODUCT', 'Produk tidak ditemukan.', 404);
      candidates = [{ product_id: productId, matched_tags: [] }];
    }
    const context = buildGlowyContext({
      profile,
      catalog: this.catalog,
      candidates,
      message,
      requestedProductId: productId,
      imageAttachment: attachment ? { media_key: 'request-scoped-image', purpose: 'glowy_private' } : null,
    });
    const engineOrder = new Map(candidates.map((item, index) => [item.product_id, index]));
    context.allowed_product_ids.sort((a, b) => engineOrder.get(a) - engineOrder.get(b));
    context.catalog_candidates.sort((a, b) => engineOrder.get(a.product_id) - engineOrder.get(b.product_id));
    context.conversation_history = {
      data_kind: 'UNTRUSTED_CONVERSATION_MEMORY',
      profile_version: profile?.profile_version ?? 0,
      turns: this.#history.get(userId, profile?.profile_version ?? 0, context.allowed_product_ids),
    };
    if (attachment) {
      context.image_attachment.data_kind = 'request_scoped_image_input';
      context.external_image_notice = 'Image is user-provided, not a verified catalog record. Do not assign a GM ID from visual similarity.';
    }
    const raw = await this.#provider.generate({
      task: 'chat',
      instructions: glowyInstructions,
      context,
      schema: glowyOutputSchema,
      image: attachment,
    });
    validateGlowyOutput(raw, context.allowed_product_ids);
    ensure(raw.mode !== 'profile_styling' || profile, 'INVALID_AI_RESPONSE', 'Tidak ada profil untuk personalisasi.', 502);
    ensure(raw.mode !== 'photo_analysis' || attachment, 'INVALID_AI_RESPONSE', 'Tidak ada input gambar.', 502);
    ensure(raw.mode !== 'post_discussion', 'INVALID_AI_RESPONSE', 'Tidak ada post berizin.', 502);
    const mentions = [raw.reply, ...raw.uncertainties, raw.follow_up_question ?? ''].join('\n').match(/\bGM\d+\b/gi) ?? [];
    ensure(
      mentions.every((id) => context.allowed_product_ids.includes(id.toUpperCase()) && raw.referenced_product_ids.includes(id.toUpperCase())),
      'INVALID_AI_RESPONSE', 'Semua ID yang disebut harus berasal dari shortlist dan tercatat sebagai referensi.', 502,
    );
    ensure(
      raw.referenced_product_ids.every((id, i, ids) => i === 0 || context.allowed_product_ids.indexOf(ids[i - 1]) < context.allowed_product_ids.indexOf(id)),
      'INVALID_AI_RESPONSE', 'Urutan engine tidak boleh diganti model.', 502,
    );
    this.#history.append(userId, profile?.profile_version ?? 0, message, raw.reply);
    return {
      reply: raw,
      provider: this.#provider.kind ?? 'unknown',
      rankedProducts: profile ? candidates.slice(0, 5) : [],
    };
  }

  async analyzePhoto({ userId, captureType, consent, image }) {
    ensure(['face', 'body'].includes(captureType), 'INVALID_INPUT', 'capture_type harus face atau body.');
    ensure(consent === true, 'CONSENT_REQUIRED', 'Persetujuan analisis foto diperlukan.');
    const attachment = await decodeImage(image, this.#config.maxImageBytes);
    try {
      const raw = await this.#provider.generate({
        task: 'vision',
        instructions: visionInstructions,
        context: { capture_type: captureType, consent_verified: true },
        schema: extendedVisionSchema,
        image: attachment,
      });
      const result = validateExtendedVision(raw, captureType);
      for (const [key, proposal] of this.#proposals) if (proposal.expires <= this.clock()) this.#proposals.delete(key);
      ensure(this.#proposals.size < 100, 'RATE_LIMITED', 'Terlalu banyak proposal sementara.', 429);
      const proposalId = randomUUID();
      this.#proposals.set(proposalId, { owner: userId, result: copy(result), expires: this.clock() + 1200000 });
      return { result, proposalId, provider: this.#provider.kind ?? 'unknown', fallback: false };
    } catch (error) {
      error.fallback = { manual_quiz_available: true, result: emptyVision(captureType) };
      throw error;
    }
  }

  confirmVision({ userId, proposalId, acceptedFields = [] }) {
    const proposal = this.#proposals.get(proposalId);
    ensure(proposal && proposal.owner === userId && proposal.expires > this.clock(), 'FORBIDDEN_RESOURCE', 'Proposal tidak ditemukan atau tidak berizin.', 404);
    ensure(Array.isArray(acceptedFields) && acceptedFields.every((f) => ['skinDepth', 'apparentShape'].includes(f)), 'INVALID_INPUT', 'Field tidak dikenal.');
    const values = {
      skinDepth: proposal.result.observed_attributes.skin_depth_apparent,
      apparentShape: proposal.result.observed_attributes.body_silhouette_apparent,
    };
    ensure(acceptedFields.every((f) => values[f] !== null), 'INVALID_INPUT', 'Tidak ada estimasi yang dapat diterima.');
    this.#proposals.delete(proposalId);
    return Object.fromEntries(acceptedFields.map((f) => [f, values[f]]));
  }

  deleteUserData(userId) {
    this.#history.delete(userId);
    for (const [key, proposal] of this.#proposals) if (proposal.owner === userId) this.#proposals.delete(key);
  }
}
