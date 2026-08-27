import { describe, expect, it } from 'vitest';
import { parseAutomationDefinitionDocument, serializeAutomationDefinition } from './document-codec';

describe('automation definition document', () => {
  it('round-trips only the portable definition and preserves stable step ids', () => {
    const source = {
      name: '审批后创建工作',
      description: 'portable',
      trigger: { type: 'manual' as const },
      actions: [
        { id: 'approval', type: 'request_decision' as const, prompt: '继续吗？' },
        { id: 'work', type: 'product_command' as const, command: { name: 'work.create' as const, input: { title: '继续', category: 'change_request' as const } } },
      ],
    };
    const document = serializeAutomationDefinition(source);
    expect(document).toContain('"schemaVersion": 1');
    expect(document).not.toContain('projectId');
    expect(parseAutomationDefinitionDocument(document)).toEqual(source);
  });

  it('fails closed on unknown envelope fields and unknown commands', () => {
    expect(() => parseAutomationDefinitionDocument(JSON.stringify({
      schemaVersion: 1,
      name: 'unsafe',
      description: '',
      trigger: { type: 'manual' },
      actions: [{ id: 'x', type: 'notify', message: 'x' }],
      projectId: 'foreign',
    }))).toThrow('automation_document_unknown_field');
    expect(() => parseAutomationDefinitionDocument(JSON.stringify({
      schemaVersion: 1,
      name: 'unsafe',
      description: '',
      trigger: { type: 'manual' },
      actions: [{ id: 'x', type: 'product_command', command: { name: 'project.create', input: {} } }],
    }))).toThrow('automation_product_command_unsupported');
  });
});
