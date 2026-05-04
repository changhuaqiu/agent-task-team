const MAX_FILE_SIZE = 10_000; // 10KB

interface SkillInput {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
}

export function buildSkillLayer(skills: SkillInput[]): string {
  if (skills.length === 0) return '';

  return skills.map((skill) => {
    const parts: string[] = [`## Skill: ${skill.name}`, skill.content];

    if (skill.files) {
      for (const file of skill.files) {
        if (file.content.length > MAX_FILE_SIZE) continue;
        parts.push(`### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      }
    }

    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}
