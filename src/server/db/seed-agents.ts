import { getDb } from './index';

interface PresetAgent {
  id: string;
  name: string;
  theme: string;
  emoji: string;
  responsibility: 'coordinator' | 'implementer' | 'reviewer';
}

const PRESET_AGENTS: PresetAgent[] = [
  { id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', responsibility: 'coordinator' },
  { id: 'luigi', name: 'Luigi', theme: 'luigi', emoji: '⚡', responsibility: 'implementer' },
  { id: 'peach', name: 'Peach', theme: 'peach', emoji: '🌸', responsibility: 'reviewer' },
  { id: 'dk', name: 'Donkey Kong', theme: 'dk', emoji: '⚙️', responsibility: 'reviewer' },
];

export function seedPresetAgents(): void {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO agents (
       id,name,role_card_id,theme,emoji,is_preset,runtime_id,account_ids,
       instructions,can_modify_code,can_review,responsibility,created_at,updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, 'codex', '[]', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );

  for (const agent of PRESET_AGENTS) {
    const instructions = agent.id === 'mario'
      ? '负责理解目标、拆解工作、协调团队并推动交付闭环。'
      : agent.id === 'luigi'
        ? '负责在明确边界内完成全栈实现，并提供可验证的实现证据。'
        : agent.id === 'peach'
          ? '负责独立评审、测试与质量判断，发现问题时给出可执行反馈。'
          : '负责架构、数据模型、安全与跨模块风险评估。';
    stmt.run(
      agent.id, agent.name, '', agent.theme, agent.emoji,
      instructions,
      agent.id === 'mario' || agent.id === 'luigi' || agent.id === 'dk' ? 1 : 0,
      agent.id === 'peach' || agent.id === 'dk' ? 1 : 0,
      agent.responsibility,
      now,
      now,
    );
  }
}
