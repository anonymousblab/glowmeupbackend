// MVP seed data is split by product feature so each screen has its own API contract.
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

export const suitsMeData = {
  profile: { match: 93, confidence: 'High' },
  recommendations: [
    { id: 'suits-001', title: 'Structured Blazer', category: 'Outfit', price: 'Rp249.000', match: 94, color: 'Plum', imageKey: 'model_editorial' },
    { id: 'suits-002', title: 'Soft Knit Top', category: 'Top', price: 'Rp179.000', match: 91, color: 'Warm Ivory', imageKey: 'model_color' },
    { id: 'suits-003', title: 'Everyday Blush Look', category: 'Beauty', price: 'Rp129.000', match: 89, color: 'Coral', imageKey: 'model_face' },
  ],
  categories: ['For You', 'Outfit', 'Top', 'Beauty'],
};

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
