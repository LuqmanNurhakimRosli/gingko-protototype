// Display names for the Claude models the copilot can run on.

const NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
};

export function modelName(id: string | null | undefined): string {
  if (!id) return 'Claude';
  return NAMES[id.replace(/-\d{8}$/, '')] ?? id;
}
