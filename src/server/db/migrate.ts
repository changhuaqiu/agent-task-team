import type Database from 'better-sqlite3';

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS conversation (
  id TEXT PRIMARY KEY,
  title TEXT,
  goal TEXT,
  status TEXT,
  priority TEXT,
  project_path TEXT,
  participants TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  dependencies TEXT,
  artifacts TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  mentions TEXT,
  intent TEXT,
  metadata TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_session (
  id TEXT PRIMARY KEY,
  cli_session_id TEXT,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  context_health TEXT,
  usage_snapshot TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  seal_reason TEXT,
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  UNIQUE(agent_id, task_id, seq)
);

CREATE TABLE IF NOT EXISTS invocation (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  engine TEXT,
  account_id TEXT,
  cli_session_id TEXT,
  prompt TEXT,
  exit_code INTEGER,
  reason_code TEXT,
  usage TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_event (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_conv ON task(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON chat_message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_task ON chat_message(task_id);
CREATE INDEX IF NOT EXISTS idx_msg_created ON chat_message(created_at);
CREATE INDEX IF NOT EXISTS idx_session_agent_task ON agent_session(agent_id, task_id);
CREATE INDEX IF NOT EXISTS idx_invocation_agent ON invocation(agent_id);
CREATE INDEX IF NOT EXISTS idx_invocation_conv ON invocation(conversation_id);
CREATE INDEX IF NOT EXISTS idx_event_conv ON agent_event(conversation_id);
CREATE INDEX IF NOT EXISTS idx_event_agent ON agent_event(agent_id);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE IF NOT EXISTS role_cards (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS role_cards (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  content TEXT NOT NULL,
  config TEXT,
  is_preset INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_file (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(skill_id, path)
);

CREATE TABLE IF NOT EXISTS agent_skill (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_file_skill ON skill_file(skill_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_agent ON agent_skill(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_skill ON agent_skill(skill_id);
`,
  },
  {
    version: 4,
    sql: `
    ALTER TABLE task ADD COLUMN claimed_at TEXT;
    ALTER TABLE task ADD COLUMN started_at TEXT;
    ALTER TABLE task ADD COLUMN completed_at TEXT;
    ALTER TABLE task ADD COLUMN lease_expiry TEXT;
    ALTER TABLE task ADD COLUMN work_dir TEXT;

    ALTER TABLE invocation ADD COLUMN dispatch_status TEXT DEFAULT 'queued';
    ALTER TABLE invocation ADD COLUMN token_usage TEXT;
  `,
  },
  {
    version: 5,
    sql: `
    ALTER TABLE invocation ADD COLUMN lease_expiry TEXT;
    `,
  },
  {
    version: 6,
    sql: `
    CREATE TABLE IF NOT EXISTS phase (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      title TEXT NOT NULL,
      description TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_phase_conv ON phase(conversation_id);
    `,
  },
  {
    version: 7,
    sql: `
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_card_id TEXT NOT NULL,
      theme TEXT NOT NULL,
      emoji TEXT NOT NULL,
      is_preset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    `,
  },
  {
    version: 8,
    sql: `
    CREATE TABLE IF NOT EXISTS agent_mailbox (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      trigger_message_id TEXT,
      task_id TEXT,
      content TEXT NOT NULL,
      context_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      chain_depth INTEGER NOT NULL DEFAULT 0,
      a2a_from TEXT,
      source TEXT NOT NULL DEFAULT 'a2a',
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mailbox_to_status ON agent_mailbox(to_agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_mailbox_conv ON agent_mailbox(conversation_id);
    `,
  },
  {
    version: 9,
    sql: `ALTER TABLE agent_mailbox ADD COLUMN epoch_id TEXT;`,
  },
  {
    version: 10,
    sql: `
    -- A2A v2: Chain-Orchestrated Dispatch

    CREATE TABLE IF NOT EXISTS invocation_chain (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      root_trigger_type TEXT NOT NULL,
      root_trigger_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chain_conv ON invocation_chain(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chain_status ON invocation_chain(status);

    CREATE TABLE IF NOT EXISTS chain_worklist (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES invocation_chain(id),
      agent_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      prompt TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      outcome TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_worklist_chain ON chain_worklist(chain_id);
    CREATE INDEX IF NOT EXISTS idx_worklist_agent ON chain_worklist(agent_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_worklist_hash ON chain_worklist(chain_id, content_hash);

    CREATE TABLE IF NOT EXISTS delivery_cursor (
      agent_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_chain_id TEXT,
      last_entry_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS a2a_audit_log (
      id TEXT PRIMARY KEY,
      chain_id TEXT,
      conversation_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_agent_id TEXT,
      to_agent_id TEXT,
      content_hash TEXT,
      reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_chain ON a2a_audit_log(chain_id);
    CREATE INDEX IF NOT EXISTS idx_audit_conv ON a2a_audit_log(conversation_id);
    `,
  },
  {
    version: 11,
    sql: `
    CREATE TABLE IF NOT EXISTS team_pack (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      author TEXT,
      license TEXT,
      tags TEXT,
      category TEXT NOT NULL DEFAULT 'team/general',
      workflow TEXT NOT NULL,
      communication_matrix TEXT NOT NULL,
      shared_context TEXT,
      rules TEXT,
      is_preset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_pack_role (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES team_pack(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      soul TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      role_card_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(pack_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS agent_team_pack (
      agent_id TEXT NOT NULL,
      pack_id TEXT NOT NULL REFERENCES team_pack(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, pack_id)
    );

    CREATE INDEX IF NOT EXISTS idx_team_pack_role_pack ON team_pack_role(pack_id);
    CREATE INDEX IF NOT EXISTS idx_agent_team_pack_agent ON agent_team_pack(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_team_pack_pack ON agent_team_pack(pack_id);
    `,
  },
  {
    version: 12,
    sql: `
    ALTER TABLE conversation ADD COLUMN team_pack_id TEXT REFERENCES team_pack(id);
  `,
  },
  {
    version: 13,
    sql: `
    ALTER TABLE team_pack ADD COLUMN team_mode TEXT NOT NULL DEFAULT 'hub_spoke';
    ALTER TABLE team_pack ADD COLUMN source TEXT;
  `,
  },
  {
    version: 14,
    sql: `
    ALTER TABLE team_pack_role ADD COLUMN role_card_snapshot TEXT;
    ALTER TABLE team_pack_role ADD COLUMN account_ids TEXT;
    ALTER TABLE team_pack_role ADD COLUMN skill_ids TEXT;
  `,
  },
  {
    version: 15,
    sql: `
    ALTER TABLE conversation ADD COLUMN use_worktree INTEGER;
    ALTER TABLE conversation ADD COLUMN git_repo_root TEXT;
  `,
  },
  {
    version: 16,
    sql: `
    CREATE TABLE IF NOT EXISTS a2a_possession_chain (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      root_trigger_type TEXT NOT NULL,
      root_trigger_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_holder_id TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_possession_chain_conv ON a2a_possession_chain(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_possession_chain_status ON a2a_possession_chain(status);
    CREATE INDEX IF NOT EXISTS idx_possession_chain_holder ON a2a_possession_chain(current_holder_id);

    CREATE TABLE IF NOT EXISTS a2a_possession (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES a2a_possession_chain(id),
      holder_id TEXT NOT NULL,
      holder_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_possession_chain ON a2a_possession(chain_id);
    CREATE INDEX IF NOT EXISTS idx_possession_holder ON a2a_possession(holder_id, status);

    CREATE TABLE IF NOT EXISTS a2a_pass (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES a2a_possession_chain(id),
      from_possession_id TEXT NOT NULL REFERENCES a2a_possession(id),
      from_holder_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted',
      intent TEXT NOT NULL,
      phase TEXT,
      reason TEXT,
      handoff_packet_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pass_chain ON a2a_pass(chain_id);
    CREATE INDEX IF NOT EXISTS idx_pass_target_status ON a2a_pass(to_agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_pass_status ON a2a_pass(status);

    CREATE TABLE IF NOT EXISTS a2a_handoff_packet (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES a2a_possession_chain(id),
      pass_id TEXT NOT NULL REFERENCES a2a_pass(id),
      from_holder_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      requested_action TEXT NOT NULL,
      possession_summary TEXT NOT NULL,
      relevant_decisions TEXT NOT NULL DEFAULT '[]',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      constraints TEXT NOT NULL DEFAULT '[]',
      open_questions TEXT NOT NULL DEFAULT '[]',
      forbidden_behaviors TEXT NOT NULL DEFAULT '[]',
      source_message_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_chain ON a2a_handoff_packet(chain_id);
    CREATE INDEX IF NOT EXISTS idx_handoff_pass ON a2a_handoff_packet(pass_id);
  `,
  },
  {
    version: 17,
    sql: `
    CREATE TABLE IF NOT EXISTS control_proof_event (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      conversation_id TEXT,
      task_id TEXT,
      chain_id TEXT,
      pass_id TEXT,
      envelope_id TEXT,
      node_id TEXT,
      agent_id TEXT,
      actor_id TEXT,
      reason_code TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proof_event_type ON control_proof_event(event_type);
    CREATE INDEX IF NOT EXISTS idx_proof_event_conv ON control_proof_event(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_proof_event_envelope ON control_proof_event(envelope_id);
    CREATE INDEX IF NOT EXISTS idx_proof_event_node ON control_proof_event(node_id);
    CREATE INDEX IF NOT EXISTS idx_proof_event_agent ON control_proof_event(agent_id);

    CREATE TABLE IF NOT EXISTS runtime_node (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      endpoint TEXT,
      status TEXT NOT NULL DEFAULT 'reachable',
      capabilities TEXT NOT NULL DEFAULT '[]',
      trust_level TEXT NOT NULL DEFAULT 'local',
      last_heartbeat_at TEXT,
      missed_heartbeats INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_node_kind ON runtime_node(kind);
    CREATE INDEX IF NOT EXISTS idx_runtime_node_status ON runtime_node(status);
    CREATE INDEX IF NOT EXISTS idx_runtime_node_heartbeat ON runtime_node(last_heartbeat_at);

    CREATE TABLE IF NOT EXISTS agent_binding (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      node_id TEXT NOT NULL REFERENCES runtime_node(id),
      runtime_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      active_envelope_id TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_binding_conv_agent ON agent_binding(conversation_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_binding_node ON agent_binding(node_id);
    CREATE INDEX IF NOT EXISTS idx_agent_binding_status ON agent_binding(status);

    CREATE TABLE IF NOT EXISTS execution_envelope (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      intent TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      task_id TEXT,
      chain_id TEXT,
      pass_id TEXT,
      from_node_id TEXT NOT NULL,
      from_agent_id TEXT,
      to_node_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      ttl_ms INTEGER NOT NULL,
      nonce TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted',
      reason_code TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_execution_envelope_conv ON execution_envelope(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_execution_envelope_target ON execution_envelope(to_node_id, to_agent_id);
    CREATE INDEX IF NOT EXISTS idx_execution_envelope_status ON execution_envelope(status);
    CREATE INDEX IF NOT EXISTS idx_execution_envelope_expires ON execution_envelope(expires_at);
    `,
  },
  {
    version: 18,
    sql: `
    CREATE TABLE IF NOT EXISTS task_action (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      type TEXT NOT NULL,
      task_ids TEXT NOT NULL DEFAULT '[]',
      message_id TEXT,
      pass_id TEXT,
      possession_id TEXT,
      proof_event_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_action_conv ON task_action(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_task_action_type ON task_action(type);
    CREATE INDEX IF NOT EXISTS idx_task_action_message ON task_action(message_id);
    CREATE INDEX IF NOT EXISTS idx_task_action_pass ON task_action(pass_id);

    CREATE TABLE IF NOT EXISTS task_edge (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      from_task_id TEXT NOT NULL REFERENCES task(id),
      to_task_id TEXT NOT NULL REFERENCES task(id),
      type TEXT NOT NULL,
      created_by_action_id TEXT NOT NULL REFERENCES task_action(id),
      created_at TEXT NOT NULL,
      UNIQUE(from_task_id, to_task_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_task_edge_conv ON task_edge(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_task_edge_from ON task_edge(from_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_edge_to ON task_edge(to_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_edge_type ON task_edge(type);

    CREATE TABLE IF NOT EXISTS task_artifact_ref (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      task_id TEXT NOT NULL REFERENCES task(id),
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      path TEXT,
      url TEXT,
      proof_event_id TEXT,
      created_by_action_id TEXT NOT NULL REFERENCES task_action(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_artifact_conv ON task_artifact_ref(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_task_artifact_task ON task_artifact_ref(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_artifact_action ON task_artifact_ref(created_by_action_id);

    CREATE TABLE IF NOT EXISTS chat_task_binding (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      message_id TEXT NOT NULL REFERENCES chat_message(id),
      task_id TEXT NOT NULL REFERENCES task(id),
      action_id TEXT REFERENCES task_action(id),
      created_at TEXT NOT NULL,
      UNIQUE(message_id, task_id, action_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_task_binding_conv ON chat_task_binding(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_task_binding_message ON chat_task_binding(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_task_binding_task ON chat_task_binding(task_id);
    CREATE INDEX IF NOT EXISTS idx_chat_task_binding_action ON chat_task_binding(action_id);

    INSERT OR IGNORE INTO task_action
      (id, conversation_id, actor_id, actor_type, type, task_ids, payload, created_at)
    SELECT
      'task-action-migrated-' || id,
      conversation_id,
      'system',
      'system',
      'task.created',
      '["' || replace(id, '"', '\\"') || '"]',
      json_object('title', title, 'status', status, 'ownerAgentId', agent_id, 'migrated', 1),
      created_at
    FROM task;
    `,
  },
  {
    version: 19,
    sql: `
    CREATE TABLE IF NOT EXISTS a2a_delivery (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      chain_id TEXT NOT NULL REFERENCES invocation_chain(id),
      entry_id TEXT NOT NULL REFERENCES chain_worklist(id),
      pass_id TEXT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'a2a:dispatch',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_a2a_delivery_conv ON a2a_delivery(conversation_id, status);
    CREATE INDEX IF NOT EXISTS idx_a2a_delivery_entry ON a2a_delivery(entry_id);
    CREATE INDEX IF NOT EXISTS idx_a2a_delivery_agent ON a2a_delivery(agent_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_a2a_delivery_entry ON a2a_delivery(entry_id);
    `,
  },
];

export function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)`);

  const current = db.prepare('SELECT MAX(version) as v FROM _schema_version').get() as {
    v: number | null;
  };
  const currentVersion = current?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(migration.version);
    }
  }
}
