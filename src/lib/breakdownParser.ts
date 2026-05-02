export interface TaskProposal {
  title: string;
  description: string;
  agentId?: string;
}

export interface PhaseProposal {
  title: string;
  description: string;
  tasks: TaskProposal[];
}

export function parsePhaseBreakdown(content: string): PhaseProposal[] {
  const lines = content.split('\n');
  const phases: PhaseProposal[] = [];
  let currentPhase: PhaseProposal | null = null;

  for (const raw of lines) {
    const phaseMatch = /^\s*PHASE\s*:\s*(.+)\s*$/i.exec(raw);
    if (phaseMatch) {
      const rest = phaseMatch[1] || '';
      const [titlePart, ...descParts] = rest.split('|');
      currentPhase = {
        title: titlePart.trim(),
        description: descParts.join('|').trim(),
        tasks: [],
      };
      phases.push(currentPhase);
      continue;
    }

    const taskMatch = /^\s*(?:-|\*)?\s*TASK\s*:\s*(.+)\s*$/i.exec(raw);
    if (taskMatch && currentPhase) {
      const rest = taskMatch[1] || '';
      const agentMatch = /@(\w+)/.exec(rest);
      const agentId = agentMatch ? agentMatch[1] : undefined;
      const cleaned = rest.replace(/@(\w+)/g, '').trim();
      const [titlePart, ...descParts] = cleaned.split('|');
      const title = (titlePart || '').trim();
      const description = descParts.join('|').trim();
      if (title) {
        currentPhase.tasks.push({ title, description, agentId });
      }
    }
  }

  return phases;
}