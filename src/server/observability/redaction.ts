const PREVIEW_LIMIT = 2_000;
const DEFAULT_PAYLOAD_LIMIT_BYTES = 256 * 1024;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /((?:["']?(?:api[_-]?key|access[_-]?token|authorization|password|secret)["']?)\s*[=:]\s*["']?)[^\s,"'}]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi,
];

function observationText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { text = String(value); }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix?: string | number) => typeof prefix === 'string' ? `${prefix}[REDACTED]` : '[REDACTED]');
  }
  return text;
}

export function redactObservationPreview(value: unknown, limit = PREVIEW_LIMIT): string | undefined {
  const text = observationText(value);
  if (text === undefined) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function sanitizeObservationPayload(
  value: unknown,
  limitBytes = DEFAULT_PAYLOAD_LIMIT_BYTES,
): { content: string; byteSize: number; truncated: boolean } | undefined {
  const text = observationText(value);
  if (text === undefined) return undefined;
  const source = Buffer.from(text, 'utf8');
  if (source.byteLength <= limitBytes) {
    return { content: text, byteSize: source.byteLength, truncated: false };
  }
  let content = source.subarray(0, Math.max(0, limitBytes)).toString('utf8');
  if (content.endsWith('\uFFFD')) content = content.slice(0, -1);
  return { content, byteSize: Buffer.byteLength(content, 'utf8'), truncated: true };
}
