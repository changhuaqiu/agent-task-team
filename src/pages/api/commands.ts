import type { NextApiRequest, NextApiResponse } from 'next';
import {
  asAgentTeamDeployCommand,
  asAgentTeamCreateCommand,
  asAgentTeamUpdateCommand,
  asAgentTeamDeleteCommand,
  asAgentCreateCommand,
  asAgentUpdateCommand,
  asAutomationCreateCommand,
  asAutomationDecideCommand,
  asAutomationRetryCommand,
  asAutomationSetEnabledCommand,
  asAutomationTriggerCommand,
  asAutomationUpdateCommand,
  asProjectCreateCommand,
  asProjectAgentAddCommand,
  asProjectAgentRemoveCommand,
  asReleaseCreateCommand,
  asReleasePublishCommand,
  asReviewCreateCommand,
  asReviewRecordDecisionCommand,
  asWorkCreateCommand,
  asWorkSubmitOutcomeCommand,
  commandService,
} from '@/server/command-kernel/service';
import type { CommandReceipt } from '@/server/command-kernel/types';
import type { Server as IOServer } from 'socket.io';
import {
  InvalidAgentOutcomeInputError,
  parseAgentOutcomeInput,
} from '@/server/work-contract/outcome-input';

type CommandApiResponse = CommandReceipt | { error: string; reasonCode?: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<CommandApiResponse>,
): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const commandName = req.body?.name;
    if (!['work.create', 'work.submit_outcome', 'project.create', 'project.agent.add', 'project.agent.remove', 'review.create', 'review.record_decision', 'agent_team.create', 'agent_team.update', 'agent_team.delete', 'agent_team.deploy', 'agent.create', 'agent.update', 'automation.create', 'automation.update', 'automation.set_enabled', 'automation.trigger', 'automation.retry', 'automation.decide', 'release.create', 'release.publish'].includes(commandName)) {
      res.status(400).json({ error: 'command_not_supported', reasonCode: 'command_not_supported' });
      return;
    }
    const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string'
      ? req.body.idempotencyKey
      : commandId;
    const receipt = commandName === 'automation.create'
      ? commandService.execute(asAutomationCreateCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          definition: req.body?.input ?? {},
        }))
      : commandName === 'automation.update'
      ? commandService.execute(asAutomationUpdateCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          expectedRevision: Number(req.body?.expectedRevision),
          definition: req.body?.input ?? {},
        }))
      : commandName === 'automation.set_enabled'
      ? commandService.execute(asAutomationSetEnabledCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          automationId: typeof req.body?.input?.automationId === 'string' ? req.body.input.automationId : '',
          expectedRevision: Number(req.body?.expectedRevision),
          enabled: req.body?.input?.enabled,
        }))
      : commandName === 'automation.trigger'
      ? commandService.execute(asAutomationTriggerCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          automationId: typeof req.body?.input?.automationId === 'string' ? req.body.input.automationId : '',
        }))
      : commandName === 'automation.retry'
      ? commandService.execute(asAutomationRetryCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          runId: typeof req.body?.input?.runId === 'string' ? req.body.input.runId : '',
        }))
      : commandName === 'automation.decide'
      ? commandService.execute(asAutomationDecideCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          decisionId: typeof req.body?.input?.decisionId === 'string' ? req.body.input.decisionId : '',
          decision: req.body?.input?.decision,
          note: typeof req.body?.input?.note === 'string' ? req.body.input.note : undefined,
        }))
      : commandName === 'release.create'
      ? commandService.execute(asReleaseCreateCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          name: typeof req.body?.input?.name === 'string' ? req.body.input.name : '',
          description: typeof req.body?.input?.description === 'string' ? req.body.input.description : undefined,
          targets: Array.isArray(req.body?.input?.targets) ? req.body.input.targets : [],
        }))
      : commandName === 'release.publish'
      ? commandService.execute(asReleasePublishCommand({
          commandId, idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          releaseId: typeof req.body?.input?.releaseId === 'string' ? req.body.input.releaseId : '',
          expectedRevision: Number(req.body?.expectedRevision),
        }))
      : commandName === 'agent.create'
      ? commandService.execute(asAgentCreateCommand({
          commandId,
          idempotencyKey,
          agent: req.body?.input ?? {},
        }))
      : commandName === 'agent.update'
      ? commandService.execute(asAgentUpdateCommand({
          commandId,
          idempotencyKey,
          expectedRevision: Number(req.body?.expectedRevision),
          agent: req.body?.input ?? {},
        }))
      : commandName === 'work.create'
      ? commandService.execute(asWorkCreateCommand({
          commandId,
          idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          title: typeof req.body?.input?.title === 'string' ? req.body.input.title : '',
          category: req.body?.input?.category,
          description: typeof req.body?.input?.description === 'string' ? req.body.input.description : undefined,
        }))
      : commandName === 'agent_team.create'
      ? commandService.execute(asAgentTeamCreateCommand({
          commandId,
          idempotencyKey,
          team: req.body?.input ?? {},
        }))
      : commandName === 'agent_team.update'
      ? commandService.execute(asAgentTeamUpdateCommand({
          commandId,
          idempotencyKey,
          expectedRevision: Number(req.body?.expectedRevision),
          team: req.body?.input ?? {},
        }))
      : commandName === 'agent_team.delete'
      ? commandService.execute(asAgentTeamDeleteCommand({
          commandId,
          idempotencyKey,
          expectedRevision: Number(req.body?.expectedRevision),
          teamId: typeof req.body?.input?.teamId === 'string' ? req.body.input.teamId : '',
        }))
      : commandName === 'agent_team.deploy'
      ? commandService.execute(asAgentTeamDeployCommand({
          commandId,
          idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          teamId: typeof req.body?.input?.teamId === 'string' ? req.body.input.teamId : '',
          channelId: typeof req.body?.input?.channelId === 'string' ? req.body.input.channelId : '',
        }))
      : commandName === 'project.create'
      ? commandService.execute(asProjectCreateCommand({
          commandId,
          idempotencyKey,
          name: typeof req.body?.input?.name === 'string' ? req.body.input.name : '',
          rootPath: typeof req.body?.input?.rootPath === 'string' ? req.body.input.rootPath : '',
        }))
      : commandName === 'project.agent.add'
      ? commandService.execute(asProjectAgentAddCommand({
          commandId,
          idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          agentId: typeof req.body?.input?.agentId === 'string' ? req.body.input.agentId : '',
        }))
      : commandName === 'project.agent.remove'
      ? commandService.execute(asProjectAgentRemoveCommand({
          commandId,
          idempotencyKey,
          projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
          agentId: typeof req.body?.input?.agentId === 'string' ? req.body.input.agentId : '',
        }))
      : commandName === 'review.create'
        ? commandService.execute(asReviewCreateCommand({
            commandId,
            idempotencyKey,
            projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
            repositoryRoot: typeof req.body?.input?.repositoryRoot === 'string' ? req.body.input.repositoryRoot : '',
            baseRef: typeof req.body?.input?.baseRef === 'string' ? req.body.input.baseRef : '',
            compareRef: typeof req.body?.input?.compareRef === 'string' ? req.body.input.compareRef : '',
            title: typeof req.body?.input?.title === 'string' ? req.body.input.title : '',
            description: typeof req.body?.input?.description === 'string' ? req.body.input.description : undefined,
          }))
        : commandName === 'review.record_decision'
          ? commandService.execute(asReviewRecordDecisionCommand({
              commandId,
              idempotencyKey,
              projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : '',
              reviewId: typeof req.body?.input?.reviewId === 'string' ? req.body.input.reviewId : '',
              expectedRevision: Number(req.body?.expectedRevision),
              status: req.body?.input?.status,
              summary: typeof req.body?.input?.summary === 'string' ? req.body.input.summary : '',
            }))
          : commandService.execute(asWorkSubmitOutcomeCommand(parseAgentOutcomeInput(req.body.input)));
    const statusCode = receipt.status === 'applied'
      ? 202
      : receipt.status === 'duplicate'
        ? 200
        : receipt.status === 'conflict'
          ? 409
          : receipt.status === 'delivery_unknown'
            ? 503
            : 422;
    if (receipt.status === 'applied') {
      const io = (res.socket as typeof res.socket & { server?: { io?: IOServer } } | null)?.server?.io;
      io?.emit('project:objects-updated', {
        projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : undefined,
        commandName,
        subject: receipt.subject,
      });
    }
    res.status(statusCode).json(receipt);
  } catch (error) {
    if (error instanceof InvalidAgentOutcomeInputError) {
      res.status(400).json({ error: error.message, reasonCode: error.reasonCode });
      return;
    }
    console.error('[commands] execution failed:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
