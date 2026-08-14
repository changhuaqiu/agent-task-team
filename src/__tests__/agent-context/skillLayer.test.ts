import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types (duplicated from skillLayer to avoid exporting internals)
// ---------------------------------------------------------------------------

interface SkillInput {
  name: string;
  content: string;
  revision?: string;
  contentHash?: string;
  resourceRefs?: string[];
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

  it('renders revision metadata and resource references without loading their bodies', () => {
    const skill = makeSkill({
      name: 'with-files',
      content: 'Has files.',
      revision: 'skill-rev-1',
      contentHash: 'abc123',
      resourceRefs: ['/managed/with-files/references/guide.md'],
    });
    const result = buildSkillLayer([skill]);
    expect(result).toContain('Revision: skill-rev-1');
    expect(result).toContain('Content hash: abc123');
    expect(result).toContain('### 按需资源');
    expect(result).toContain('/managed/with-files/references/guide.md');
    expect(result).not.toContain('export const x = 1;');
  });
});
