// src/server/types.ts

import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';

export interface DetectedRuntime {
  engine: RuntimeCliEngine;
  available: boolean;
  path?: string;
  version?: string;
}
