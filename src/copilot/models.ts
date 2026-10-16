// Display names for the models the copilot can run on: Claude API ids
// (claude-opus-5-5) and OpenRouter slugs (anthropic/claude-opus-5.5, openai/gpt-…).

const NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
};

const WORD: Record<string, string> = { gpt: 'GPT', ai: 'AI', it: 'IT', r1: 'R1', v3: 'V3', oss: 'OSS' };

export function modelName(id: string | null | undefined): string {
  if (!id) return 'Claude';
  const known = NAMES[id.replace(/-\d{8}$/, '')];
  if (known) return known;
  // OpenRouter slug: drop the vendor and any :variant, then title-case the words
  const slug = id.includes('/') ? id.slice(id.indexOf('/') + 1).split(':')[0] : id;
  return slug.split(/[-_ ]+/).filter(Boolean)
    .map(w => WORD[w.toLowerCase()] ?? (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

export function providerName(p: string | null | undefined): string | null {
  return p === 'openrouter' ? 'OpenRouter' : p === 'anthropic' ? 'Claude API' : null;
}
