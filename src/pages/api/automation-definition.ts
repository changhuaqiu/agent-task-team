import type { NextApiRequest, NextApiResponse } from 'next';
import {
  parseAutomationDefinitionDocument,
  serializeAutomationDefinition,
} from '@/server/automations';

type DefinitionResponse =
  | { definition: ReturnType<typeof parseAutomationDefinitionDocument>; document: string }
  | { error: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<DefinitionResponse>,
): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const definition = typeof req.body?.source === 'string'
      ? parseAutomationDefinitionDocument(req.body.source)
      : req.body?.definition;
    const document = serializeAutomationDefinition(definition);
    res.status(200).json({ definition, document });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'automation_document_invalid' });
  }
}
