import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = process.cwd();
const vitestEntry = path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
const benchmarkFile = 'src/server/project-context/project-context-benchmark.test.ts';
const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', benchmarkFile, '--reporter=verbose'],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RUN_PROJECT_CONTEXT_BENCHMARK: '1',
    },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
