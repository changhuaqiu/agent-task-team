import { describe, expect, it } from 'vitest';
import { redactObservationPreview, sanitizeObservationPayload } from './redaction';

describe('secret redaction never preserves the matched credential', () => {
  it.each([
    'sk-abcdefghijklmnopqrstuvwx',
    'ghp_abcdefghijklmnopqrstuvwxyz1234',
    'Bearer sample-credential',
    'password=sample-password',
    'postgres://user:pass@host/db',
    '-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----',
  ])('removes credential from %s', (credential) => {
    const result = redactObservationPreview('before ' + credential + ' after')!;
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(credential);
    expect(sanitizeObservationPayload({ value: credential })?.content).not.toContain(credential);
  });
});
