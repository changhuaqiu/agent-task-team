import type { ToolDefinition } from '../PromptComposer';

export function buildToolLayer(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  const toolDescriptions = tools.map((tool) => {
    const params = tool.parameters
      .map((p) => `- \`${p.name}\` (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`)
      .join('\n');

    const schema = {
      name: tool.name,
      description: tool.description,
      parameters: Object.fromEntries(
        tool.parameters.map((p) => [
          p.name,
          { type: p.type, description: p.description },
        ]),
      ),
    };

    return `### ${tool.name}

${tool.description}

Parameters:
${params || '(none)'}

Usage: use tool_use with the following JSON:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\``;
  });

  return `## Available Tools

You have access to the following tools. Use tool_use to invoke them.

${toolDescriptions.join('\n\n---\n\n')}`;
}
