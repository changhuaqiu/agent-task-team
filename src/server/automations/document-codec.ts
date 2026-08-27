import type { AutomationDefinitionDocument } from '@/shared/automation';
import { validateAutomationDefinition, type AutomationDefinitionInput } from './definition';

const DOCUMENT_KEYS = new Set(['schemaVersion', 'name', 'description', 'trigger', 'actions']);

export function serializeAutomationDefinition(input: AutomationDefinitionInput): string {
  validateAutomationDefinition(input);
  const document: AutomationDefinitionDocument = {
    schemaVersion: 1,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    trigger: input.trigger,
    actions: input.actions,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseAutomationDefinitionDocument(source: string): AutomationDefinitionInput {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('automation_document_json_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('automation_document_invalid');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error('automation_document_version_unsupported');
  if (Object.keys(record).some((key) => !DOCUMENT_KEYS.has(key))) {
    throw new Error('automation_document_unknown_field');
  }
  const definition = {
    name: record.name,
    description: record.description,
    trigger: record.trigger,
    actions: record.actions,
  } as AutomationDefinitionInput;
  validateAutomationDefinition(definition);
  return definition;
}
