const FALLBACK_PROMPT = '你好，请就绪并等待指令。';

export function buildUserMessageLayer(rawPrompt: string): string {
  const cleaned = rawPrompt.replace(/@\w+\s*/g, '').trim();
  return cleaned || FALLBACK_PROMPT;
}
