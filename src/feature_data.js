// MVP seed data is split by product feature so each screen has its own API contract.

const styleByVibe = {
  Casual: ['minimalist', 'sporty', 'streetwear'],
  Minimal: ['minimalist', 'classic'],
  Street: ['streetwear', 'edgy', 'sporty'],
  Formal: ['classic', 'minimalist'],
  Chic: ['classic', 'romantic', 'edgy'],
  Other: [],
};

const colorsByPreference = {
  Cool: ['blue', 'blue_green', 'pink', 'grey'],
  Warm: ['brown', 'beige', 'red', 'green'],
  Neutral: ['black', 'white', 'grey', 'beige'],
};

const titleCase = (value) => value == null || value === ''
  ? 'Unknown'
  : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function recommendationFor(item, questionnaire) {
  const preferredStyles = styleByVibe[questionnaire?.vibe] ?? [];
  const preferredColors = colorsByPreference[questionnaire?.color] ?? [];
  const styleMatches = item.style_tags.filter((tag) => preferredStyles.includes(tag));
  const colorMatches = preferredColors.includes(item.color_family);
  const confidenceBonus = item.visual_confidence === 'high' ? 5 : item.visual_confidence === 'medium' ? 2 : 0;
  const match = Math.min(98, 72 + styleMatches.length * 7 + (colorMatches ? 9 : 0) + confidenceBonus);
  const reasons = [];

  if (styleMatches.length > 0) reasons.push(`Matches your ${titleCase(styleMatches[0])} style preference`);
  if (colorMatches) reasons.push(`${titleCase(item.color_family)} fits your selected color direction`);
  if (item.occasion_tags.length > 0) reasons.push(`Suitable to explore for ${titleCase(item.occasion_tags[0])} styling`);
  if (reasons.length === 0) reasons.push('Adds variety to your current style direction');

  return {
    id: item.product_id,
    title: item.product_name,
    category: item.product_group === 'tops' ? 'Tops' : 'Bottoms',
    subcategory: titleCase(item.subcategory),
    price: null,
    match,
    color: titleCase(item.primary_color),
    imageUrl: `/dataset/images/${item.product_id}.jpg`,
    styleTags: item.style_tags.map(titleCase),
    occasionTags: item.occasion_tags.map(titleCase),
    coverageTags: item.coverage_tags.map(titleCase),
    silhouette: titleCase(item.apparent_silhouette),
    garmentLength: titleCase(item.garment_length),
    formality: titleCase(item.formality),
    visualConfidence: titleCase(item.visual_confidence),
    visibleDetails: item.visible_details,
    reasons,
    reviewStatus: item.review_status,
  };
}
export const knowMeData = {
  body: {
    heightCm: 160,
    silhouette: 'Balanced',
    note: 'Structured and relaxed proportions work well together.',
    quiz: [{ id: 'body-q1', question: 'How do you usually explore?', options: ['Menswear', 'Womenswear', 'Unisex', 'Modest Fashion', 'Mixed'] }],
  },
  face: {
    shape: 'Soft oval',
    note: 'Open necklines and rounded frames complement this profile.',
    quiz: [{ id: 'face-q1', question: 'Which face detail feels most like you?', options: ['Soft', 'Defined', 'Angular', 'Balanced'] }],
  },
  color: {
    season: 'Soft Autumn',
    bestColors: ['Plum', 'Coral', 'Warm Ivory'],
    avoidColors: ['Neon green'],
    swatches: [{ name: 'Glow Plum', hex: '#32132F' }, { name: 'Electric Iris', hex: '#7566D9' }, { name: 'Glow Coral', hex: '#E65F74' }],
  },
  style: { archetype: 'Modern Minimal', traits: ['Calm', 'Structured', 'Expressive'], quiz: ['Casual', 'Minimal', 'Street', 'Formal', 'Chic'] },
};

export function buildSuitsMeData(items, questionnaire = {}) {
  const recommendations = items
    .map((item) => recommendationFor(item, questionnaire))
    .sort((left, right) => right.match - left.match || left.id.localeCompare(right.id));

  return {
    profile: {
      match: recommendations[0]?.match ?? 0,
      confidence: 'Exploratory',
      questionnaire,
    },
    recommendations,
    categories: ['For You', 'Tops', 'Bottoms', 'Casual', 'Smart Casual'],
    catalog: {
      total: recommendations.length,
      schemaVersion: items[0]?.annotation_schema_version ?? null,
      labelStatus: items.every((item) => item.review_status === 'approved')
        ? 'approved'
        : 'needs_human_review',
      notice: 'Catalog labels are a first-pass review. Price, stock, material, sizing, and guaranteed fit are unavailable.',
    },
  };
}

export const connectData = {
  tabs: ['For You', 'People Like Me', 'Reviews'],
  posts: [
    { id: 'post-001', author: 'Raka', time: '2h ago', title: 'My go-to smart casual look', body: 'A relaxed blazer with a clean base layer.', likes: 328, comments: 24, imageKey: 'model_editorial' },
    { id: 'post-002', author: 'Alya', time: '5h ago', title: 'Oversized blazer - worth it?', body: 'The fabric drapes well and balances my proportions.', likes: 214, comments: 18, imageKey: 'model_color' },
  ],
  creators: [
    { id: 'creator-001', name: 'Alya', style: 'Minimal · Modest', match: 92, avatarKey: 'model_face' },
    { id: 'creator-002', name: 'Raka', style: 'Casual · Clean', match: 90, avatarKey: 'model_male' },
    { id: 'creator-003', name: 'Dimas', style: 'Street · Relaxed', match: 87, avatarKey: 'model_editorial' },
  ],
  reviews: [{ id: 'review-001', author: 'Salma', rating: 5, text: 'The color suggestion made choosing an outfit easier.' }],
};

export const glowyData = {
  greeting: 'Hi, you!',
  prompts: ['Analyze a product', 'Find alternatives', 'Ask about my style', 'Help me build an outfit'],
  suggestions: [
    'What would you like to explore today?',
    'Try asking me about a color, outfit, or occasion.',
  ],
  starterQuestions: [
    { id: 'glowy-001', label: 'Ask about my style', prompt: 'What style direction suits my profile?' },
    { id: 'glowy-002', label: 'Build an outfit', prompt: 'Build a simple outfit for a casual day.' },
    { id: 'glowy-003', label: 'Find alternatives', prompt: 'Show alternatives for my current favorite look.' },
  ],
};
