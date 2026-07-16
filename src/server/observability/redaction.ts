const PREVIEW_LIMIT = 2_000;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  /((?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[=:]\s*["']?)[^\s,"'}]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
];

export function redactObservationPreview(value: unknown, limit = PREVIEW_LIMIT): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix?: string) => prefix ? `${prefix}[REDACTED]` : '[REDACTED]');
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
