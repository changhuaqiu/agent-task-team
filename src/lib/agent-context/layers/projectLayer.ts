export function buildProjectLayer(project: { name: string; path: string }): string {
  const lines: string[] = ['## 项目上下文'];
  if (project.name) {
    lines.push(`- 项目：${project.name}`);
  }
  if (project.path) {
    lines.push(`- 工作目录：${project.path}`);
  }
  lines.push('- 项目根目录有 CLAUDE.md / AGENTS.md 规范文件，请遵循');
  return lines.join('\n');
}
