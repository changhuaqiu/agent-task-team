import type { SkillPackageInput } from '@/lib/skills/types';
import { parseSkillMarkdown } from '@/server/skills/skill-package';

export function buildSkillPackageInput(input: {
  name: string;
  description: string;
  content: string;
  files: Array<{ path: string; content: string }>;
  config?: string;
  isPreset?: boolean;
}): SkillPackageInput {
  const skillMarkdown = `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.content.trim()}\n`;
  const parsed = parseSkillMarkdown(skillMarkdown);
  return {
    ...parsed,
    skillMarkdown,
    files: input.files.map((file) => ({
      path: file.path,
      content: Buffer.from(file.content, 'utf8'),
    })),
    config: input.config,
    isPreset: input.isPreset,
  };
}
