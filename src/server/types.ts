// src/server/types.ts

import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';

export type CliEngine = RuntimeCliEngine;

export interface DetectedRuntime {
  engine: CliEngine;
  available: boolean;
  path?: string;
  version?: string;
}
