import { describe, expect, it } from 'vitest';
import { buildCodeTopology } from './topology';

describe('buildCodeTopology', () => {
  it('resolves NodeNext runtime extensions to TypeScript owner files', () => {
    const topology = buildCodeTopology([
      {
        path: 'src/index.ts',
        content: "export { authenticate } from './auth.js';",
      },
      {
        path: 'src/auth.ts',
        content: 'export const authenticate = true;',
      },
    ], 1, '2026-07-20T00:00:00.000Z', false);

    expect(topology.edges).toContainEqual({
      from: 'src/index.ts',
      to: 'src/auth.ts',
      kind: 'import',
    });
    expect(topology.unresolvedImports).toBe(0);
  });

  it('resolves internal absolute Python imports when an owner module exists', () => {
    const topology = buildCodeTopology([
      {
        path: 'app/main.py',
        content: 'from app.services.auth import authenticate',
      },
      {
        path: 'app/services/auth.py',
        content: 'def authenticate():\n    return True',
      },
    ], 1, '2026-07-20T00:00:00.000Z', false);

    expect(topology.edges).toContainEqual({
      from: 'app/main.py',
      to: 'app/services/auth.py',
      kind: 'import',
    });
  });
});
