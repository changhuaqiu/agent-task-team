import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types (duplicated from skillLayer to avoid exporting internals)
// ---------------------------------------------------------------------------

interface SkillInput {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillInput> = {}): SkillInput {
  return { name: 'test-skill', content: '# Test Skill\nDo the thing.', ...overrides };
}

// ---------------------------------------------------------------------------
// Import after helper definitions so types are available
// ---------------------------------------------------------------------------

import { buildSkillLayer } from '@/lib/agent-context/layers/skillLayer';

// ===========================================================================
// buildSkillLayer
// ===========================================================================
describe('buildSkillLayer', () => {
  it('returns empty string for empty skills array', () => {
    expect(buildSkillLayer([])).toBe('');
  });

  it('renders a single skill with header and content', () => {
    const skill = makeSkill({ name: 'my-skill', content: 'Do something useful.' });
    const result = buildSkillLayer([skill]);
    expect(result).toContain('## Skill: my-skill');
    expect(result).toContain('Do something useful.');
  });

  it('renders multiple skills separated by ---', () => {
    const skills = [
      makeSkill({ name: 'skill-a', content: 'Content A' }),
      makeSkill({ name: 'skill-b', content: 'Content B' }),
    ];
    const result = buildSkillLayer(skills);
    expect(result).toContain('## Skill: skill-a');
    expect(result).toContain('## Skill: skill-b');
    expect(result).toContain('\n\n---\n\n');
  });

  it('includes skill files under 10KB with file header and code block', () => {
    const skill = makeSkill({
      name: 'with-files',
      content: 'Has files.',
      files: [{ path: 'src/utils.ts', content: 'export const x = 1;' }],
    });
    const result = buildSkillLayer([skill]);
    expect(result).toContain('### File: src/utils.ts');
    expect(result).toContain('```\nexport const x = 1;\n```');
  });

  it('skips skill files over 10KB (10_001 chars)', () => {
    const bigContent = 'x'.repeat(10_001);
    const skill = makeSkill({
      name: 'big-file-skill',
      content: 'Has a big file.',
      files: [{ path: 'huge.ts', content: bigContent }],
    });
    const result = buildSkillLayer([skill]);
    expect(result).not.toContain('### File: huge.ts');
    expect(result).not.toContain(bigContent);
  });

  it('includes multiple files for a single skill', () => {
    const skill = makeSkill({
      name: 'multi-file',
      content: 'Multi-file skill.',
      files: [
        { path: 'a.ts', content: 'const a = 1;' },
        { path: 'b.ts', content: 'const b = 2;' },
      ],
    });
    const result = buildSkillLayer([skill]);
    expect(result).toContain('### File: a.ts');
    expect(result).toContain('const a = 1;');
    expect(result).toContain('### File: b.ts');
    expect(result).toContain('const b = 2;');
  });

  it('includes files exactly at 10KB boundary (10_000 chars)', () => {
    const exactContent = 'x'.repeat(10_000);
    const skill = makeSkill({
      name: 'boundary-skill',
      content: 'Boundary test.',
      files: [{ path: 'boundary.ts', content: exactContent }],
    });
    const result = buildSkillLayer([skill]);
    expect(result).toContain('### File: boundary.ts');
  });
});
