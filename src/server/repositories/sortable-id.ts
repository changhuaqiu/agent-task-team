import crypto from 'node:crypto';

let seq = 0;

export function generateSortableId(prefix?: string): string {
  const ts = Date.now().toString().padStart(16, '0');
  const s = (++seq).toString().padStart(6, '0');
  const rand = crypto.randomBytes(4).toString('hex');
  const id = `${ts}-${s}-${rand}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function resetSeq(): void {
  seq = 0;
}
