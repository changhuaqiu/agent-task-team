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

const STRIP_HTML_RE = /<[^>]+>/g;

/**
 * Parse PHASE/TASK structured text from agent output.
 * Handles both newline-separated and inline formats:
 *   PHASE: title | desc TASK: t1 | d1 @deep TASK: t2 | d2 @quick
 */
export function parsePhaseBreakdown(content: string): PhaseProposal[] {
  const cleaned = content.replace(STRIP_HTML_RE, '');
  // Normalize: treat "TASK:" and "PHASE:" as token boundaries by inserting newlines
  const normalized = cleaned
    .replace(/\s*TASK\s*:/gi, '\nTASK:')
    .replace(/\s*PHASE\s*:/gi, '\nPHASE:');

  const lines = normalized.split('\n');
  const phases: PhaseProposal[] = [];
  let currentPhase: PhaseProposal | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const phaseMatch = /^PHASE\s*:\s*(.+)$/i.exec(trimmed);
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

    const taskMatch = /^(?:-|\*)?\s*TASK\s*:\s*(.+)$/i.exec(trimmed);
    if (taskMatch && currentPhase) {
      const rest = taskMatch[1] || '';
      const agentMatch = /@(\w+)/.exec(rest);
      const agentId = agentMatch ? agentMatch[1] : undefined;
      const noAgent = rest.replace(/@(\w+)/g, '').trim();
      const [titlePart, ...descParts] = noAgent.split('|');
      const title = (titlePart || '').trim();
      const description = descParts.join('|').trim();
      if (title) {
        currentPhase.tasks.push({ title, description, agentId });
      }
    }
  }

  return phases;
}
