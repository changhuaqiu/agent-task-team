interface SkillInput {
  name: string;
  content: string;
  description?: string;
  revision?: string;
  contentHash?: string;
  resourceRefs?: string[];
}

export function buildSkillLayer(skills: SkillInput[]): string {
  if (skills.length === 0) return '';

  return skills.map((skill) => {
    const parts: string[] = [
      `## Skill: ${skill.name}`,
      skill.revision ? `Revision: ${skill.revision}` : '',
      skill.contentHash ? `Content hash: ${skill.contentHash}` : '',
      skill.content,
    ].filter(Boolean);

    if (skill.resourceRefs?.length) {
      parts.push([
        '### 按需资源',
        '以下资源未加载到上下文。仅在 SKILL.md 指示或当前任务确实需要时读取：',
        ...skill.resourceRefs.map(resource => `- ${resource}`),
      ].join('\n'));
    }

    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}
