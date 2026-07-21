import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'node:path';
import {
  ProjectContextError,
  projectContextService,
  type ProjectContextInspection,
  type ProjectScanDiagnostics,
} from '@/server/project-context';
import { conversationRepo } from '@/server/repositories/conversation-repo';

interface ProjectContextInspectResponse {
  ok: boolean;
  inspection?: ProjectContextInspection;
  diagnostics?: ProjectScanDiagnostics;
  error?: string;
  reasonCode?: string;
  candidates?: string[];
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProjectContextInspectResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const projectPath = typeof req.body?.path === 'string' ? req.body.path : '';
  try {
    const result = await projectContextService.prepare({ mode: 'inspect', projectPath });
    const selectedIdentity = pathIdentity(result.inspection.root);
    result.inspection.activeWorkstreamCount = conversationRepo.list()
      .filter(conversation => (
        conversation.status === 'active'
        && Boolean(conversation.project_path)
        && pathIdentity(conversation.project_path!) === selectedIdentity
      ))
      .length;
    return res.status(200).json({
      ok: true,
      inspection: result.inspection,
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    if (error instanceof ProjectContextError) {
      const status = error.reasonCode === 'project_path_not_found'
        || error.reasonCode === 'project_path_not_directory'
        || error.reasonCode === 'project_path_missing'
        ? 400
        : 500;
      return res.status(status).json({
        ok: false,
        error: error.message,
        reasonCode: error.reasonCode,
        candidates: error.candidates,
      });
    }
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      reasonCode: 'project_context_unreadable',
    });
  }
}
