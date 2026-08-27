import type { NextApiRequest, NextApiResponse } from 'next';
import { projectRepo } from '@/server/repositories/project-repo';
import { asProjectCreateCommand, commandService } from '@/server/command-kernel/service';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ projects: projectRepo.list() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const rootPath = typeof req.body?.rootPath === 'string' ? req.body.rootPath : '';
    const commandId = typeof req.body?.commandId === 'string' && req.body.commandId
      ? req.body.commandId
      : `legacy-project:${Buffer.from(rootPath).toString('base64url')}`;
    const receipt = commandService.execute(asProjectCreateCommand({
      commandId,
      idempotencyKey: typeof req.body?.idempotencyKey === 'string'
        ? req.body.idempotencyKey
        : commandId,
      name,
      rootPath,
    }));
    if (!receipt.result || !('project' in receipt.result)) {
      throw new Error(receipt.reasonCode ?? 'project_create_failed');
    }
    return res.status(receipt.status === 'applied' ? 201 : 200).json({ project: receipt.result.project, receipt });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = reason === 'project_name_required'
      ? '请填写项目名称'
      : reason === 'project_path_required'
        ? '请选择项目目录'
        : '添加项目失败';
    return res.status(400).json({ error: message, reasonCode: reason });
  }
}
