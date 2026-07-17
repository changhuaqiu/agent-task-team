// src/lib/agent-context/skillTools.ts
//
// Extracted from PromptComposer to break the circular dependency
// (ContextManager ↔ PromptComposer). Pure utility: pulls declared tool
// definitions out of skill config JSON.

import type { SkillSummary, ToolDefinition } from './types';

export function extractToolsFromSkills(skills: SkillSummary[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    if (!skill.config) continue;
    try {
      const parsed = JSON.parse(skill.config);
      if (Array.isArray(parsed.tools)) {
        tools.push(...parsed.tools);
      }
    } catch {
      // invalid config JSON — skip
    }
  }
  return tools;
}
