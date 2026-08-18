import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  sql?: string;
  run?: (db: Database.Database) => void;
  foreignKeysOff?: boolean;
}

const MIGRATIONS: Migration[] = [
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
  {
    version: 20,
    sql: `
    -- Session identity: retain only the newest active binding for each
    -- project(conversation) + agent before enforcing the business invariant.
    UPDATE agent_session AS stale
    SET status = 'sealed',
        seal_reason = 'migration_duplicate_active',
        sealed_at = COALESCE(sealed_at, datetime('now'))
    WHERE stale.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM agent_session AS newer
        WHERE newer.conversation_id = stale.conversation_id
          AND newer.agent_id = stale.agent_id
          AND newer.status = 'active'
          AND (
            newer.created_at > stale.created_at
            OR (newer.created_at = stale.created_at AND newer.id > stale.id)
          )
      );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_session_active_project_agent
      ON agent_session(conversation_id, agent_id)
      WHERE status = 'active';
    `,
  },
  {
    version: 21,
    sql: `
    CREATE TABLE IF NOT EXISTS agent_log_cursor (
      agent_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      last_consumed_id TEXT NOT NULL,
      consumed_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_log_cursor_project ON agent_log_cursor(project_id);
    `,
  },
  {
    version: 22,
    sql: `
    CREATE TABLE IF NOT EXISTS observation_span (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      conversation_id TEXT NOT NULL,
      task_id TEXT,
      agent_id TEXT,
      invocation_id TEXT,
      envelope_id TEXT,
      chain_id TEXT,
      pass_id TEXT,
      attributes TEXT NOT NULL DEFAULT '{}',
      input_preview TEXT,
      output_preview TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_observation_span_trace
      ON observation_span(trace_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_observation_span_conv
      ON observation_span(conversation_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_observation_span_invocation
      ON observation_span(invocation_id);
    CREATE INDEX IF NOT EXISTS idx_observation_span_agent
      ON observation_span(agent_id, started_at);
    `,
  },
  {
    version: 23,
    sql: `
    CREATE TABLE IF NOT EXISTS observation_span_payload (
      span_id TEXT NOT NULL REFERENCES observation_span(span_id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (span_id, role, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_observation_span_payload_span
      ON observation_span_payload(span_id);
    `,
  },
  {
    version: 24,
    run(db) {
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_message'").get();
      if (!table) return;
      const columns = db.prepare('PRAGMA table_info(chat_message)').all() as Array<{ name: string }>;
      if (!columns.some(column => column.name === 'invocation_id')) {
        db.exec('ALTER TABLE chat_message ADD COLUMN invocation_id TEXT');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_msg_invocation ON chat_message(invocation_id)');
    },
  },
  {
    version: 25,
    run(db) {
      const skillTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skill'").get();
      if (!skillTable) return;
      const skillColumns = db.prepare('PRAGMA table_info(skill)').all() as Array<{ name: string }>;
      if (!skillColumns.some(column => column.name === 'active_revision_id')) {
        db.exec('ALTER TABLE skill ADD COLUMN active_revision_id TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS skill_revision (
          id TEXT PRIMARY KEY,
          skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL,
          description TEXT NOT NULL,
          body TEXT NOT NULL,
          package_path TEXT NOT NULL,
          config TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(skill_id, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_skill_revision_skill ON skill_revision(skill_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_revision_hash ON skill_revision(skill_id, content_hash);

        CREATE TABLE IF NOT EXISTS skill_revision_file (
          id TEXT PRIMARY KEY,
          revision_id TEXT NOT NULL REFERENCES skill_revision(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          kind TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          UNIQUE(revision_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_skill_revision_file_revision ON skill_revision_file(revision_id, path);
      `);
    },
  },
  {
    version: 27,
    sql: `
CREATE TABLE IF NOT EXISTS eval_rubric (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_rubric_revision (
  id TEXT PRIMARY KEY, rubric_id TEXT NOT NULL REFERENCES eval_rubric(id),
  revision INTEGER NOT NULL, definition TEXT NOT NULL, content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published', published_by TEXT NOT NULL,
  published_at TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(rubric_id, revision), UNIQUE(rubric_id, content_hash)
);
CREATE TABLE IF NOT EXISTS eval_subject_snapshot (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  root_task_id TEXT, chain_id TEXT, mode TEXT NOT NULL, evidence_cutoff_at TEXT NOT NULL,
  collected_at TEXT NOT NULL, snapshot_hash TEXT NOT NULL UNIQUE,
  evidence_refs TEXT NOT NULL, evidence_payload TEXT NOT NULL, app_manifest TEXT NOT NULL,
  data_quality TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'unknown',
  difficulty TEXT NOT NULL DEFAULT 'unknown', language TEXT NOT NULL DEFAULT 'unknown'
);
CREATE TABLE IF NOT EXISTS eval_run (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES eval_subject_snapshot(id),
  rubric_revision_id TEXT NOT NULL REFERENCES eval_rubric_revision(id),
  mode TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued',
  gate_status TEXT NOT NULL DEFAULT 'unknown', evidence_coverage REAL NOT NULL DEFAULT 0,
  overall_score REAL, evaluator_bundle_digest TEXT NOT NULL,
  error_code TEXT, error_message TEXT, started_at TEXT, completed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_job (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES eval_run(id) ON DELETE CASCADE,
  request_payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT NOT NULL, lease_until TEXT, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_score (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL, evaluator_kind TEXT NOT NULL, evaluator_revision TEXT NOT NULL,
  applicability TEXT NOT NULL, raw_score REAL, normalized_score REAL, label TEXT NOT NULL,
  rationale TEXT NOT NULL, evidence_refs TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(run_id, dimension_key, evaluator_kind)
);
CREATE TABLE IF NOT EXISTS eval_judge_attempt (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  score_id TEXT REFERENCES eval_score(id), dimension_key TEXT NOT NULL,
  judge_account_id TEXT, provider TEXT, model TEXT, prompt_digest TEXT NOT NULL,
  request_params TEXT NOT NULL, response_payload TEXT, parse_status TEXT NOT NULL,
  prompt_tokens INTEGER, completion_tokens INTEGER, latency_ms INTEGER,
  error_code TEXT, error_message TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_gap (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL, severity TEXT NOT NULL, description TEXT NOT NULL,
  suggestion TEXT NOT NULL, target_type TEXT, target_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open', evidence_refs TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_policy (
  conversation_id TEXT PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1, sampling_rate REAL NOT NULL DEFAULT 1,
  daily_token_budget INTEGER NOT NULL DEFAULT 50000, judge_account_id TEXT,
  allowed_providers TEXT NOT NULL DEFAULT '["openai","anthropic"]',
  retention_days INTEGER NOT NULL DEFAULT 180, fail_strategy TEXT NOT NULL DEFAULT 'partial',
  updated_by TEXT NOT NULL DEFAULT 'project-admin', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_dataset (
  id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(conversation_id, name, revision)
);
CREATE TABLE IF NOT EXISTS eval_case (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES eval_dataset(id) ON DELETE CASCADE,
  case_key TEXT NOT NULL, split TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT,
  input_payload TEXT NOT NULL, expected_labels TEXT NOT NULL, metadata TEXT NOT NULL,
  content_hash TEXT NOT NULL, redaction_status TEXT NOT NULL DEFAULT 'redacted',
  created_at TEXT NOT NULL, UNIQUE(dataset_id, case_key)
);
CREATE TABLE IF NOT EXISTS eval_annotation (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES eval_case(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES eval_run(id), rubric_revision_id TEXT NOT NULL REFERENCES eval_rubric_revision(id),
  reviewer_id TEXT NOT NULL, dimension_key TEXT NOT NULL, label TEXT NOT NULL,
  rationale TEXT NOT NULL, blind_batch_id TEXT, status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_run_conversation ON eval_run(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_job_claim ON eval_job(status, next_attempt_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_eval_score_run ON eval_score(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_gap_run ON eval_gap(run_id, status);
CREATE INDEX IF NOT EXISTS idx_eval_case_dataset ON eval_case(dataset_id, split);
`,
  },
  {
    version: 28,
    sql: `
CREATE TABLE IF NOT EXISTS eval_experiment (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES eval_dataset(id), dataset_revision INTEGER NOT NULL,
  rubric_revision_id TEXT NOT NULL REFERENCES eval_rubric_revision(id),
  evaluator_bundle_digest TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  baseline_manifest TEXT NOT NULL, candidate_manifest TEXT NOT NULL, summary TEXT,
  created_by TEXT NOT NULL, started_at TEXT, completed_at TEXT, error_code TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_experiment_item (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES eval_experiment(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES eval_case(id), baseline_run_id TEXT REFERENCES eval_run(id),
  candidate_run_id TEXT REFERENCES eval_run(id), winner TEXT, score_delta REAL,
  details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  UNIQUE(experiment_id, case_id)
);
CREATE TABLE IF NOT EXISTS eval_change_proposal (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  gap_id TEXT REFERENCES eval_gap(id), target_type TEXT NOT NULL, target_ref TEXT,
  hypothesis TEXT NOT NULL, proposed_change TEXT NOT NULL, risk TEXT NOT NULL,
  owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', approval_by TEXT,
  approved_at TEXT, regression_experiment_id TEXT REFERENCES eval_experiment(id),
  apply_evidence TEXT, revert_evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_experiment_conversation ON eval_experiment(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_change_proposal_conversation ON eval_change_proposal(conversation_id, status);
`,
  },
  {
    version: 29,
    run(db) {
      const columns = db.prepare('PRAGMA table_info(eval_job)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'lease_token')) {
        db.exec('ALTER TABLE eval_job ADD COLUMN lease_token TEXT');
      }
    },
  },
  {
    version: 30,
    run(db) {
      const columns = db.prepare('PRAGMA table_info(eval_run)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'case_id')) db.exec('ALTER TABLE eval_run ADD COLUMN case_id TEXT');
      if (!columns.some((column) => column.name === 'application_manifest_digest')) {
        db.exec('ALTER TABLE eval_run ADD COLUMN application_manifest_digest TEXT');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_eval_run_case ON eval_run(case_id, application_manifest_digest)');
    },
  },
  {
    version: 31,
    run(db) {
      const policyColumns = db.prepare('PRAGMA table_info(eval_policy)').all() as Array<{ name: string }>;
      if (!policyColumns.some((column) => column.name === 'secondary_judge_account_id')) {
        db.exec('ALTER TABLE eval_policy ADD COLUMN secondary_judge_account_id TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS eval_review_queue (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES eval_run(id) ON DELETE CASCADE,
          experiment_id TEXT REFERENCES eval_experiment(id) ON DELETE CASCADE,
          case_id TEXT REFERENCES eval_case(id),
          dimension_key TEXT,
          reason_code TEXT NOT NULL,
          primary_label TEXT,
          secondary_label TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          assigned_to TEXT,
          resolution TEXT,
          resolved_by TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eval_review_queue_conversation
          ON eval_review_queue(conversation_id, status, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_review_queue_run_dimension
          ON eval_review_queue(run_id, dimension_key, reason_code)
          WHERE run_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS eval_pairwise_round (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          experiment_id TEXT NOT NULL REFERENCES eval_experiment(id) ON DELETE CASCADE,
          case_id TEXT NOT NULL REFERENCES eval_case(id),
          blind_seed TEXT NOT NULL,
          first_order TEXT NOT NULL,
          first_choice TEXT,
          first_judge_id TEXT,
          swapped_choice TEXT,
          swapped_judge_id TEXT,
          resolved_winner TEXT,
          consistency_status TEXT NOT NULL DEFAULT 'pending_first',
          review_queue_id TEXT REFERENCES eval_review_queue(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(experiment_id, case_id)
        );
        CREATE INDEX IF NOT EXISTS idx_eval_pairwise_round_experiment
          ON eval_pairwise_round(experiment_id, consistency_status);
      `);
    },
  },
  {
    version: 32,
    run(db) {
      const policyColumns = db.prepare('PRAGMA table_info(eval_policy)').all() as Array<{ name: string }>;
      if (!policyColumns.some((column) => column.name === 'max_concurrency')) {
        db.exec('ALTER TABLE eval_policy ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 2');
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_eval_rubric_revision_immutable
        BEFORE UPDATE ON eval_rubric_revision
        BEGIN SELECT RAISE(ABORT, 'published rubric revisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS trg_eval_subject_snapshot_immutable
        BEFORE UPDATE ON eval_subject_snapshot
        BEGIN SELECT RAISE(ABORT, 'evaluation snapshots are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS trg_eval_score_immutable
        BEFORE UPDATE ON eval_score
        BEGIN SELECT RAISE(ABORT, 'evaluation scores are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS trg_eval_judge_attempt_immutable
        BEFORE UPDATE ON eval_judge_attempt
        BEGIN SELECT RAISE(ABORT, 'Judge attempts are immutable'); END;
      `);
    },
  },
  {
    version: 33,
    run(db) {
      const reviewColumns = db.prepare('PRAGMA table_info(eval_review_queue)').all() as Array<{ name: string }>;
      if (!reviewColumns.some((column) => column.name === 'request_payload')) {
        db.exec("ALTER TABLE eval_review_queue ADD COLUMN request_payload TEXT NOT NULL DEFAULT '{}'");
      }
    },
  },
  {
    version: 34,
    run(db) {
      const annotationColumns = db.prepare('PRAGMA table_info(eval_annotation)').all() as Array<{ name: string }>;
      if (!annotationColumns.some((column) => column.name === 'conversation_id')) {
        db.exec('ALTER TABLE eval_annotation ADD COLUMN conversation_id TEXT');
        db.exec(`
          UPDATE eval_annotation
          SET conversation_id=(
            SELECT d.conversation_id FROM eval_case c
            JOIN eval_dataset d ON d.id=c.dataset_id
            WHERE c.id=eval_annotation.case_id
          )
          WHERE conversation_id IS NULL
        `);
      }
      const itemColumns = db.prepare('PRAGMA table_info(eval_experiment_item)').all() as Array<{ name: string }>;
      if (!itemColumns.some((column) => column.name === 'execution_verified')) {
        db.exec('ALTER TABLE eval_experiment_item ADD COLUMN execution_verified INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_eval_snapshot_conversation
          ON eval_subject_snapshot(conversation_id, evidence_cutoff_at);
        CREATE INDEX IF NOT EXISTS idx_eval_annotation_scope
          ON eval_annotation(conversation_id, case_id, dimension_key, reviewer_id);
        CREATE TRIGGER IF NOT EXISTS trg_eval_annotation_conversation_insert
        BEFORE INSERT ON eval_annotation
        WHEN NEW.conversation_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM conversation WHERE id=NEW.conversation_id)
        BEGIN SELECT RAISE(ABORT, 'annotation conversation does not exist'); END;
        CREATE TRIGGER IF NOT EXISTS trg_eval_annotation_conversation_update
        BEFORE UPDATE OF conversation_id ON eval_annotation
        WHEN NEW.conversation_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM conversation WHERE id=NEW.conversation_id)
        BEGIN SELECT RAISE(ABORT, 'annotation conversation does not exist'); END;
        CREATE TABLE IF NOT EXISTS eval_budget_reservation (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
          reservation_key TEXT NOT NULL UNIQUE,
          reserved_tokens INTEGER NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eval_budget_reservation_scope
          ON eval_budget_reservation(conversation_id, expires_at);
      `);
    },
  },
  {
    version: 35,
    sql: `
CREATE TABLE IF NOT EXISTS eval_application_snapshot (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  project_path TEXT NOT NULL,
  code_revision TEXT NOT NULL,
  team_manifest TEXT NOT NULL,
  agent_manifest TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(conversation_id, manifest_digest)
);
CREATE TABLE IF NOT EXISTS eval_case_execution (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  experiment_id TEXT REFERENCES eval_experiment(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES eval_case(id),
  application_snapshot_id TEXT NOT NULL REFERENCES eval_application_snapshot(id),
  variant TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  harness_trigger_id TEXT,
  invocation_id TEXT REFERENCES invocation(id),
  trace_id TEXT,
  eval_run_id TEXT REFERENCES eval_run(id),
  proof_event_id TEXT REFERENCES control_proof_event(id),
  target_manifest_digest TEXT NOT NULL,
  observed_manifest_digest TEXT,
  execution_verified INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(experiment_id, case_id, variant)
);
CREATE INDEX IF NOT EXISTS idx_eval_application_snapshot_conversation
  ON eval_application_snapshot(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_case_execution_claim
  ON eval_case_execution(status, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_case_execution_experiment
  ON eval_case_execution(experiment_id, case_id);
CREATE TRIGGER IF NOT EXISTS trg_eval_application_snapshot_immutable
BEFORE UPDATE ON eval_application_snapshot
BEGIN SELECT RAISE(ABORT, 'application snapshots are immutable'); END;
`,
  },
  {
    version: 36,
    run(db) {
      const columns = db.prepare('PRAGMA table_info(agent_session)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'isolation_key')) {
        db.exec("ALTER TABLE agent_session ADD COLUMN isolation_key TEXT NOT NULL DEFAULT ''");
      }
      db.exec(`
        DROP INDEX IF EXISTS uq_agent_session_active_project_agent;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_session_active_project_agent
          ON agent_session(conversation_id, agent_id, isolation_key)
          WHERE status='active';
      `);
    },
  },
  {
    version: 37,
    run(db) {
      const columns = db.prepare('PRAGMA table_info(eval_experiment)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'baseline_snapshot_id')) {
        db.exec('ALTER TABLE eval_experiment ADD COLUMN baseline_snapshot_id TEXT');
      }
      if (!columns.some((column) => column.name === 'candidate_snapshot_id')) {
        db.exec('ALTER TABLE eval_experiment ADD COLUMN candidate_snapshot_id TEXT');
      }
    },
  },
  {
    version: 38,
    run(db) {
      const columns = db.prepare('PRAGMA table_info(eval_case_execution)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'agent_id')) {
        db.exec('ALTER TABLE eval_case_execution ADD COLUMN agent_id TEXT');
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_case_execution_agent
        ON eval_case_execution(conversation_id,agent_id,status)`);
    },
  },
  {
    version: 26,
    sql: `
CREATE TABLE IF NOT EXISTS autonomous_delivery_run (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  root_task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN (
    'submitted','planning','executing','reviewing','verifying','integrating',
    'delivering','recovering','completed','escalated','cancelled'
  )),
  current_stage TEXT NOT NULL,
  goal_contract_json TEXT NOT NULL,
  repair_cycle INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  escalation_code TEXT,
  escalation_detail TEXT,
  delivery_bundle_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_conversation
  ON autonomous_delivery_run(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_reconcile
  ON autonomous_delivery_run(status, updated_at);

CREATE TABLE IF NOT EXISTS autonomous_delivery_action (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN (
    'ready','claimed','running','retry_wait','succeeded','failed','cancelled'
  )),
  not_before TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  last_failure_code TEXT,
  last_failure_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_action_claim
  ON autonomous_delivery_action(run_id, status, not_before, created_at);

CREATE TABLE IF NOT EXISTS autonomous_delivery_attempt (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES autonomous_delivery_action(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'claimed','running','succeeded','failed','abandoned'
  )),
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  workdir_ref TEXT,
  session_generation INTEGER,
  execution_envelope_id TEXT REFERENCES execution_envelope(id),
  failure_code TEXT,
  failure_detail TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(action_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_attempt_lease
  ON autonomous_delivery_attempt(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS autonomous_delivery_receipt (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES autonomous_delivery_action(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES autonomous_delivery_attempt(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_receipt_run
  ON autonomous_delivery_receipt(run_id, kind, observed_at);
`,
  },
  {
    version: 40,
    sql: `
CREATE TABLE IF NOT EXISTS github_issue_ingress (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  repository_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_node_id TEXT NOT NULL,
  issue_url TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  delivery_run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('started')),
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  UNIQUE(repository_full_name, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_github_issue_ingress_run
  ON github_issue_ingress(delivery_run_id);
`,
  },
  {
    // Compatibility for databases initialized by the unpublished checkpoint,
    // where the autonomous-delivery table existed without optimistic revision.
    version: 41,
    run(db) {
      const table = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='autonomous_delivery_run'",
      ).get();
      if (!table) return;
      const columns = db.prepare('PRAGMA table_info(autonomous_delivery_run)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'revision')) {
        db.exec('ALTER TABLE autonomous_delivery_run ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
  {
    // Structural repair for databases created by unpublished checkpoint builds.
    // Those builds reused migration numbers 26-40, so a version watermark alone
    // cannot prove that the autonomous-delivery schema or its FK semantics exist.
    version: 42,
    foreignKeysOff: true,
    run(db) {
      const migration = MIGRATIONS.find((item) => item.version === 26);
      if (!migration?.sql) throw new Error('autonomous delivery schema migration is unavailable');
      db.exec(migration.sql);

      const columns = db.prepare('PRAGMA table_info(autonomous_delivery_run)')
        .all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'revision')) {
        db.exec('ALTER TABLE autonomous_delivery_run ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      }

      const rootTaskForeignKey = (db.prepare("PRAGMA foreign_key_list('autonomous_delivery_run')")
        .all() as Array<{ from: string; table: string; on_delete: string }>)
        .find((foreignKey) => foreignKey.from === 'root_task_id' && foreignKey.table === 'task');
      if (rootTaskForeignKey?.on_delete.toUpperCase() !== 'SET NULL') {
        db.exec(`
          DROP TABLE IF EXISTS autonomous_delivery_run_v42;
          CREATE TABLE autonomous_delivery_run_v42 (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
            root_task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
            status TEXT NOT NULL CHECK(status IN (
              'submitted','planning','executing','reviewing','verifying','integrating',
              'delivering','recovering','completed','escalated','cancelled'
            )),
            current_stage TEXT NOT NULL,
            goal_contract_json TEXT NOT NULL,
            repair_cycle INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0,
            escalation_code TEXT,
            escalation_detail TEXT,
            delivery_bundle_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
          );
          INSERT INTO autonomous_delivery_run_v42 (
            id,conversation_id,root_task_id,status,current_stage,goal_contract_json,
            repair_cycle,revision,escalation_code,escalation_detail,delivery_bundle_json,
            created_at,updated_at,completed_at
          )
          SELECT
            id,conversation_id,root_task_id,status,current_stage,goal_contract_json,
            repair_cycle,revision,escalation_code,escalation_detail,delivery_bundle_json,
            created_at,updated_at,completed_at
          FROM autonomous_delivery_run;
          DROP TABLE autonomous_delivery_run;
          ALTER TABLE autonomous_delivery_run_v42 RENAME TO autonomous_delivery_run;
          CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_conversation
            ON autonomous_delivery_run(conversation_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_reconcile
            ON autonomous_delivery_run(status, updated_at);
        `);
      }

      const violations = db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (violations.length > 0) {
        throw new Error(`migration 42 foreign key check failed: ${JSON.stringify(violations.slice(0, 10))}`);
      }
    },
  },
  {
    version: 44,
    sql: `
CREATE TABLE IF NOT EXISTS platform_event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'domain','coordination','runtime_lifecycle','runtime_activity'
  )),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  stream_key TEXT NOT NULL,
  stream_sequence INTEGER NOT NULL CHECK(stream_sequence > 0),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','agent','system','runtime')),
  actor_id TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  project_agent_id TEXT,
  invocation_id TEXT,
  inbox_item_id TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  dedupe_key TEXT,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(stream_key, stream_sequence),
  UNIQUE(dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_platform_event_project
  ON platform_event(project_id, recorded_at, id);
CREATE INDEX IF NOT EXISTS idx_platform_event_stream
  ON platform_event(stream_key, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_platform_event_invocation
  ON platform_event(invocation_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_platform_event_project_agent
  ON platform_event(project_id, project_agent_id, recorded_at);
`,
  },
  {
    version: 45,
    sql: `
CREATE TABLE IF NOT EXISTS platform_event_delivery (
  id TEXT PRIMARY KEY,
  handler_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
  stream_key TEXT NOT NULL,
  stream_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  current_attempt_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(handler_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_event_delivery_claim
  ON platform_event_delivery(status, next_attempt_at, handler_id, stream_key, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_platform_event_delivery_stream
  ON platform_event_delivery(handler_id, stream_key, stream_sequence);

CREATE TABLE IF NOT EXISTS platform_event_delivery_attempt (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES platform_event_delivery(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','abandoned')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  UNIQUE(delivery_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_platform_event_delivery_attempt_delivery
  ON platform_event_delivery_attempt(delivery_id, attempt_no);
`,
  },
  {
    version: 46,
    sql: `
CREATE TABLE IF NOT EXISTS runtime_invocation_projection (
  invocation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  project_agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','running','terminated')),
  outcome TEXT,
  reason_code TEXT,
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  terminated_at TEXT,
  last_stream_sequence INTEGER NOT NULL CHECK(last_stream_sequence > 0),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_invocation_projection_project
  ON runtime_invocation_projection(project_id, project_agent_id, updated_at);
`,
  },
  {
    version: 47,
    sql: `
CREATE TABLE IF NOT EXISTS platform_event_handler_cursor (
  handler_id TEXT PRIMARY KEY,
  last_event_rowid INTEGER NOT NULL DEFAULT 0 CHECK(last_event_rowid >= 0),
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 48,
    sql: `
CREATE TABLE IF NOT EXISTS platform_event_ingestion (
  ingestion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES platform_event(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO platform_event_ingestion (event_id)
  SELECT id FROM platform_event ORDER BY recorded_at ASC, id ASC;
`,
    run: (db) => {
      const cursorTable = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_event_handler_cursor'",
      ).get();
      if (!cursorTable) {
        db.exec(`
          CREATE TABLE platform_event_handler_cursor (
            handler_id TEXT PRIMARY KEY,
            last_ingestion_id INTEGER NOT NULL DEFAULT 0 CHECK(last_ingestion_id >= 0),
            updated_at TEXT NOT NULL
          )
        `);
        return;
      }
      const columns = db.prepare('PRAGMA table_info(platform_event_handler_cursor)')
        .all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === 'last_event_rowid')) {
        db.exec(`
          ALTER TABLE platform_event_handler_cursor
          RENAME COLUMN last_event_rowid TO last_ingestion_id
        `);
      }
    },
  },
  {
    version: 49,
    sql: `
CREATE TABLE IF NOT EXISTS agent_inbox_item (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  project_agent_id TEXT NOT NULL,
  source_event_id TEXT REFERENCES platform_event(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  UNIQUE(source_event_id, project_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_inbox_claim
  ON agent_inbox_item(status, available_at, project_id, project_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_inbox_agent
  ON agent_inbox_item(project_id, project_agent_id, status, created_at);
`,
  },
  {
    version: 50,
    sql: `
CREATE TABLE IF NOT EXISTS autonomous_delivery_advancement_request (
  id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE REFERENCES platform_event(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  cause_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  available_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_advancement_claim
  ON autonomous_delivery_advancement_request(status, available_at, created_at, id);
`,
  },
  {
    version: 51,
    sql: `
CREATE TABLE IF NOT EXISTS runtime_message_projection (
  event_id TEXT PRIMARY KEY REFERENCES platform_event(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES chat_message(id) ON DELETE SET NULL,
  projected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_observability_projection (
  event_id TEXT PRIMARY KEY REFERENCES platform_event(id) ON DELETE CASCADE,
  projected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_completion_context (
  invocation_id TEXT PRIMARY KEY REFERENCES invocation(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  chain_id TEXT,
  pass_id TEXT,
  context_scenario TEXT,
  team_log_up_to_entry_id TEXT,
  task_project_dir TEXT NOT NULL,
  evaluation_execution_id TEXT,
  source_event_id TEXT UNIQUE REFERENCES platform_event(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS runtime_completion_step_receipt (
  event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(event_id,step)
);

-- Events recorded before this projection existed already produced their legacy
-- message and observability rows. Mark them as projected at the cutover so the
-- durable dispatcher does not duplicate historical read models on first boot.
INSERT OR IGNORE INTO runtime_message_projection (event_id,message_id,projected_at)
SELECT id,NULL,recorded_at
FROM platform_event
WHERE type IN ('runtime.message.segment.completed','runtime.tool.started');

INSERT OR IGNORE INTO runtime_observability_projection (event_id,projected_at)
SELECT id,recorded_at
FROM platform_event
WHERE type LIKE 'runtime.%';
`,
  },
  {
    version: 52,
    sql: `
CREATE TABLE IF NOT EXISTS platform_effect_outbox (
  id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  lane_key TEXT NOT NULL,
  lane_sequence INTEGER NOT NULL CHECK(lane_sequence > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  current_attempt_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(lane_key,lane_sequence)
);
CREATE INDEX IF NOT EXISTS idx_platform_effect_claim
  ON platform_effect_outbox(status,next_attempt_at,effect_type,lane_key,lane_sequence);
CREATE INDEX IF NOT EXISTS idx_platform_effect_source
  ON platform_effect_outbox(source_event_id,lane_key,lane_sequence);

CREATE TABLE IF NOT EXISTS platform_effect_attempt (
  id TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL REFERENCES platform_effect_outbox(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','abandoned')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  UNIQUE(effect_id,attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_platform_effect_attempt_effect
  ON platform_effect_attempt(effect_id,attempt_no);

CREATE TABLE IF NOT EXISTS runtime_completion_legacy_effect_suppression (
  event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL,
  PRIMARY KEY(event_id,effect_type)
);
INSERT OR IGNORE INTO runtime_completion_legacy_effect_suppression (event_id,effect_type)
SELECT event_id,
  CASE step
    WHEN 'task-sync' THEN 'runtime.task_sync'
    WHEN 'valid-exit-proof' THEN 'runtime.valid_exit_proof'
    WHEN 'closure-evaluation' THEN 'runtime.closure_evaluation'
    WHEN 'team-log' THEN 'runtime.team_log'
    WHEN 'a2a-response' THEN 'runtime.a2a_response'
    WHEN 'a2a-done' THEN 'runtime.a2a_done'
  END
FROM runtime_completion_step_receipt
WHERE step IN (
  'task-sync',
  'valid-exit-proof',
  'closure-evaluation',
  'team-log',
  'a2a-response',
  'a2a-done'
);
DROP TABLE IF EXISTS runtime_completion_step_receipt;
`,
  },
  {
    version: 53,
    run: (db) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(agent_session)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has('engine')) db.exec('ALTER TABLE agent_session ADD COLUMN engine TEXT');
      if (!columns.has('runtime_id')) db.exec('ALTER TABLE agent_session ADD COLUMN runtime_id TEXT');
      if (!columns.has('account_id')) db.exec('ALTER TABLE agent_session ADD COLUMN account_id TEXT');
      const invocationColumns = new Set(
        (db.prepare('PRAGMA table_info(invocation)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      const completedInvocationPredicate = invocationColumns.has('outcome')
        ? "invocation.status = 'terminated' AND invocation.outcome = 'completed'"
        : "invocation.status = 'succeeded'";
      db.exec(`
        UPDATE agent_session
        SET engine = (
              SELECT invocation.engine
              FROM invocation
              WHERE invocation.session_id = agent_session.id
                AND ${completedInvocationPredicate}
              ORDER BY invocation.created_at DESC, invocation.id DESC
              LIMIT 1
            ),
            account_id = (
              SELECT invocation.account_id
              FROM invocation
              WHERE invocation.session_id = agent_session.id
                AND ${completedInvocationPredicate}
              ORDER BY invocation.created_at DESC, invocation.id DESC
              LIMIT 1
            )
        WHERE engine IS NULL
      `);
    },
  },
  {
    version: 54,
    run: (db) => {
      db.exec(`
        UPDATE task
        SET review_note = CASE
              WHEN status NOT IN (
                'proposed','ready','in_progress','blocked','in_review','done','cancelled',
                'pending','completed','approved','rejected','canceled'
              )
              THEN COALESCE(review_note || char(10), '')
                || '[migration] unsupported legacy status: ' || status
              ELSE review_note
            END,
            status = CASE status
              WHEN 'pending' THEN 'ready'
              WHEN 'completed' THEN 'done'
              WHEN 'approved' THEN 'done'
              WHEN 'rejected' THEN 'in_progress'
              WHEN 'canceled' THEN 'cancelled'
              WHEN 'proposed' THEN 'proposed'
              WHEN 'ready' THEN 'ready'
              WHEN 'in_progress' THEN 'in_progress'
              WHEN 'blocked' THEN 'blocked'
              WHEN 'in_review' THEN 'in_review'
              WHEN 'done' THEN 'done'
              WHEN 'cancelled' THEN 'cancelled'
              ELSE 'blocked'
            END;

        DROP TRIGGER IF EXISTS trg_task_status_insert;
        DROP TRIGGER IF EXISTS trg_task_status_update;
        DROP TRIGGER IF EXISTS trg_task_transition_update;

        CREATE TRIGGER trg_task_status_insert
        BEFORE INSERT ON task
        WHEN NEW.status NOT IN (
          'proposed','ready','in_progress','blocked','in_review','done','cancelled'
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_task_status');
        END;

        CREATE TRIGGER trg_task_status_update
        BEFORE UPDATE OF status ON task
        WHEN NEW.status NOT IN (
          'proposed','ready','in_progress','blocked','in_review','done','cancelled'
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_task_status');
        END;

        CREATE TRIGGER trg_task_transition_update
        BEFORE UPDATE OF status ON task
        WHEN NEW.status IN (
            'proposed','ready','in_progress','blocked','in_review','done','cancelled'
          )
          AND NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'proposed' AND NEW.status IN ('ready','cancelled'))
            OR (OLD.status = 'ready' AND NEW.status IN ('in_progress','blocked','cancelled'))
            OR (OLD.status = 'in_progress' AND NEW.status IN ('blocked','in_review','cancelled'))
            OR (OLD.status = 'blocked' AND NEW.status IN ('ready','in_progress','cancelled'))
            OR (OLD.status = 'in_review' AND NEW.status IN ('done','in_progress','blocked','cancelled'))
            OR (OLD.status = 'done' AND NEW.status = 'ready')
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_task_transition');
        END;
      `);
    },
  },
  {
    version: 55,
    run: (db) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(invocation)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has('outcome')) db.exec('ALTER TABLE invocation ADD COLUMN outcome TEXT');
      if (!columns.has('started_at')) db.exec('ALTER TABLE invocation ADD COLUMN started_at TEXT');
      if (!columns.has('terminated_at')) db.exec('ALTER TABLE invocation ADD COLUMN terminated_at TEXT');
      if (!columns.has('revision')) {
        db.exec('ALTER TABLE invocation ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        UPDATE invocation
        SET outcome = CASE status
              WHEN 'succeeded' THEN 'completed'
              WHEN 'failed' THEN 'failed'
              WHEN 'canceled' THEN 'cancelled'
              WHEN 'cancelled' THEN 'cancelled'
              ELSE NULL
            END,
            started_at = CASE
              WHEN status IN ('running','succeeded','failed','canceled','cancelled')
              THEN updated_at
              ELSE NULL
            END,
            terminated_at = CASE
              WHEN status IN ('succeeded','failed','canceled','cancelled')
              THEN updated_at
              ELSE NULL
            END,
            reason_code = CASE
              WHEN status NOT IN (
                'queued','running','succeeded','failed','canceled','cancelled',
                'planned','starting','terminating','terminated'
              )
              THEN COALESCE(reason_code, 'legacy_invocation_status_unknown')
              ELSE reason_code
            END,
            status = CASE status
              WHEN 'queued' THEN 'planned'
              WHEN 'running' THEN 'running'
              WHEN 'succeeded' THEN 'terminated'
              WHEN 'failed' THEN 'terminated'
              WHEN 'canceled' THEN 'terminated'
              WHEN 'cancelled' THEN 'terminated'
              WHEN 'planned' THEN 'planned'
              WHEN 'starting' THEN 'starting'
              WHEN 'terminating' THEN 'terminating'
              WHEN 'terminated' THEN 'terminated'
              ELSE 'terminated'
            END;

        UPDATE invocation
        SET outcome = 'failed',
            terminated_at = COALESCE(terminated_at, updated_at)
        WHERE status = 'terminated' AND outcome IS NULL;

        DROP TRIGGER IF EXISTS trg_invocation_status_insert;
        DROP TRIGGER IF EXISTS trg_invocation_status_update;
        DROP TRIGGER IF EXISTS trg_invocation_transition_update;
        DROP TRIGGER IF EXISTS trg_invocation_outcome_insert;
        DROP TRIGGER IF EXISTS trg_invocation_outcome_update;

        CREATE TRIGGER trg_invocation_status_insert
        BEFORE INSERT ON invocation
        WHEN NEW.status NOT IN ('planned','starting','running','terminating','terminated')
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_status');
        END;

        CREATE TRIGGER trg_invocation_status_update
        BEFORE UPDATE OF status ON invocation
        WHEN NEW.status NOT IN ('planned','starting','running','terminating','terminated')
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_status');
        END;

        CREATE TRIGGER trg_invocation_transition_update
        BEFORE UPDATE OF status ON invocation
        WHEN NEW.status IN ('planned','starting','running','terminating','terminated')
          AND NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'planned' AND NEW.status IN ('starting','terminating','terminated'))
            OR (OLD.status = 'starting' AND NEW.status IN ('running','terminating','terminated'))
            OR (OLD.status = 'running' AND NEW.status IN ('terminating','terminated'))
            OR (OLD.status = 'terminating' AND NEW.status = 'terminated')
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_transition');
        END;

        CREATE TRIGGER trg_invocation_outcome_insert
        BEFORE INSERT ON invocation
        WHEN (NEW.status = 'terminated' AND (
                NEW.outcome IS NULL
                OR NEW.outcome NOT IN ('completed','failed','cancelled','timed_out')
              ))
          OR (NEW.status <> 'terminated' AND NEW.outcome IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_outcome');
        END;

        CREATE TRIGGER trg_invocation_outcome_update
        BEFORE UPDATE OF status, outcome ON invocation
        WHEN (NEW.status = 'terminated' AND (
                NEW.outcome IS NULL
                OR NEW.outcome NOT IN ('completed','failed','cancelled','timed_out')
              ))
          OR (NEW.status <> 'terminated' AND NEW.outcome IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_outcome');
        END;
      `);
    },
  },
  {
    version: 56,
    run: (db) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(agent_inbox_item)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      db.exec(`
        DROP TRIGGER IF EXISTS trg_agent_inbox_status_insert;
        DROP TRIGGER IF EXISTS trg_agent_inbox_transition_update;
        DROP TRIGGER IF EXISTS trg_agent_inbox_lease_insert;
        DROP TRIGGER IF EXISTS trg_agent_inbox_lease_update;
      `);
      if (!columns.has('settled_at')) {
        db.exec(`
        ALTER TABLE agent_inbox_item RENAME TO agent_inbox_item_legacy_56;

        CREATE TABLE agent_inbox_item (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          project_agent_id TEXT NOT NULL,
          source_event_id TEXT REFERENCES platform_event(id) ON DELETE SET NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          command_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'enqueued' CHECK(
            status IN ('enqueued','claimed','admitted','released','expired','cancelled')
          ),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
          available_at TEXT NOT NULL,
          lease_token TEXT,
          lease_expires_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          claimed_at TEXT,
          settled_at TEXT,
          UNIQUE(source_event_id, project_agent_id)
        );

        INSERT INTO agent_inbox_item (
          id,project_id,project_agent_id,source_event_id,idempotency_key,command_json,
          status,attempt_count,available_at,lease_token,lease_expires_at,last_error,
          created_at,updated_at,claimed_at,settled_at
        )
        SELECT
          id,project_id,project_agent_id,source_event_id,idempotency_key,command_json,
          CASE
            WHEN status = 'queued' THEN 'enqueued'
            WHEN status = 'claimed' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
              THEN 'claimed'
            WHEN status = 'claimed' THEN 'released'
            WHEN status = 'completed' THEN 'admitted'
            WHEN status = 'failed' THEN 'expired'
            WHEN status = 'cancelled' THEN 'cancelled'
            WHEN status = 'enqueued' THEN 'enqueued'
            WHEN status = 'admitted' THEN 'admitted'
            WHEN status = 'released' THEN 'released'
            WHEN status = 'expired' THEN 'expired'
            ELSE 'expired'
          END,
          attempt_count,
          available_at,
          CASE
            WHEN status = 'claimed' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
            THEN lease_token
            ELSE NULL
          END,
          CASE
            WHEN status = 'claimed' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
            THEN lease_expires_at
            ELSE NULL
          END,
          CASE
            WHEN status IN (
              'queued','claimed','completed','failed','cancelled',
              'enqueued','admitted','released','expired'
            ) THEN last_error
            ELSE COALESCE(last_error, 'legacy_agent_inbox_status_unknown')
          END,
          created_at,
          updated_at,
          claimed_at,
          CASE
            WHEN status IN ('completed','failed','cancelled','admitted','expired')
            THEN COALESCE(completed_at, updated_at)
            ELSE NULL
          END
        FROM agent_inbox_item_legacy_56;

        DROP TABLE agent_inbox_item_legacy_56;

        CREATE INDEX idx_agent_inbox_claim
          ON agent_inbox_item(status, available_at, project_id, project_agent_id, created_at);
        CREATE INDEX idx_agent_inbox_agent
          ON agent_inbox_item(project_id, project_agent_id, status, created_at);
        `);
      }
      db.exec(`
        CREATE TRIGGER trg_agent_inbox_status_insert
        BEFORE INSERT ON agent_inbox_item
        WHEN NEW.status NOT IN ('enqueued','claimed','admitted','released','expired','cancelled')
        BEGIN
          SELECT RAISE(ABORT, 'invalid_agent_inbox_status');
        END;

        CREATE TRIGGER trg_agent_inbox_transition_update
        BEFORE UPDATE OF status ON agent_inbox_item
        WHEN NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'enqueued' AND NEW.status IN ('claimed','expired','cancelled'))
            OR (OLD.status = 'released' AND NEW.status IN ('claimed','expired','cancelled'))
            OR (OLD.status = 'claimed' AND NEW.status IN ('admitted','released','expired','cancelled'))
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_agent_inbox_transition');
        END;

        CREATE TRIGGER trg_agent_inbox_lease_insert
        BEFORE INSERT ON agent_inbox_item
        WHEN (NEW.status = 'claimed' AND (
                NEW.lease_token IS NULL
                OR NEW.lease_expires_at IS NULL
              ))
          OR (NEW.status <> 'claimed' AND (
                NEW.lease_token IS NOT NULL
                OR NEW.lease_expires_at IS NOT NULL
              ))
          OR (NEW.status IN ('admitted','expired','cancelled') AND NEW.settled_at IS NULL)
          OR (NEW.status NOT IN ('admitted','expired','cancelled') AND NEW.settled_at IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_agent_inbox_lease');
        END;

        CREATE TRIGGER trg_agent_inbox_lease_update
        BEFORE UPDATE OF status, lease_token, lease_expires_at, settled_at ON agent_inbox_item
        WHEN (NEW.status = 'claimed' AND (
                NEW.lease_token IS NULL
                OR NEW.lease_expires_at IS NULL
              ))
          OR (NEW.status <> 'claimed' AND (
                NEW.lease_token IS NOT NULL
                OR NEW.lease_expires_at IS NOT NULL
              ))
          OR (NEW.status IN ('admitted','expired','cancelled') AND NEW.settled_at IS NULL)
          OR (NEW.status NOT IN ('admitted','expired','cancelled') AND NEW.settled_at IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_agent_inbox_lease');
        END;
      `);
    },
  },
  {
    version: 57,
    run: (db) => {
      const table = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='execution_envelope'",
      ).get();
      if (!table) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(execution_envelope)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has('settled_at')) {
        db.exec('ALTER TABLE execution_envelope ADD COLUMN settled_at TEXT');
      }
      if (!columns.has('revision')) {
        db.exec('ALTER TABLE execution_envelope ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        UPDATE execution_envelope
        SET reason_code = CASE
              WHEN status NOT IN (
                'drafted','validated','blocked','queued','routed','sent','started',
                'failed','completed','expired','acknowledged','rejected'
              )
              THEN COALESCE(reason_code, 'legacy_execution_envelope_status_unknown')
              ELSE reason_code
            END,
            settled_at = CASE
              WHEN status IN (
                'blocked','failed','completed','expired','started',
                'acknowledged','rejected'
              )
              THEN COALESCE(settled_at, updated_at)
              ELSE NULL
            END,
            status = CASE status
              WHEN 'drafted' THEN 'drafted'
              WHEN 'validated' THEN 'validated'
              WHEN 'queued' THEN 'validated'
              WHEN 'routed' THEN 'routed'
              WHEN 'sent' THEN 'sent'
              WHEN 'started' THEN 'acknowledged'
              WHEN 'completed' THEN 'acknowledged'
              WHEN 'blocked' THEN 'rejected'
              WHEN 'failed' THEN 'rejected'
              WHEN 'expired' THEN 'expired'
              WHEN 'acknowledged' THEN 'acknowledged'
              WHEN 'rejected' THEN 'rejected'
              ELSE 'rejected'
            END;

        UPDATE execution_envelope
        SET reason_code = COALESCE(NULLIF(trim(reason_code), ''), 'legacy_dispatch_rejected'),
            settled_at = COALESCE(settled_at, updated_at)
        WHERE status = 'rejected';

        DROP TRIGGER IF EXISTS trg_execution_envelope_status_insert;
        DROP TRIGGER IF EXISTS trg_execution_envelope_status_update;
        DROP TRIGGER IF EXISTS trg_execution_envelope_transition_update;
        DROP TRIGGER IF EXISTS trg_execution_envelope_settled_insert;
        DROP TRIGGER IF EXISTS trg_execution_envelope_settled_update;

        CREATE TRIGGER trg_execution_envelope_status_insert
        BEFORE INSERT ON execution_envelope
        WHEN NEW.status NOT IN (
          'drafted','validated','routed','sent','acknowledged','rejected','expired'
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_execution_envelope_status');
        END;

        CREATE TRIGGER trg_execution_envelope_status_update
        BEFORE UPDATE OF status ON execution_envelope
        WHEN NEW.status NOT IN (
          'drafted','validated','routed','sent','acknowledged','rejected','expired'
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_execution_envelope_status');
        END;

        CREATE TRIGGER trg_execution_envelope_transition_update
        BEFORE UPDATE OF status ON execution_envelope
        WHEN NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'drafted' AND NEW.status IN ('validated','rejected','expired'))
            OR (OLD.status = 'validated' AND NEW.status IN ('routed','rejected','expired'))
            OR (OLD.status = 'routed' AND NEW.status IN ('sent','rejected','expired'))
            OR (OLD.status = 'sent' AND NEW.status IN ('acknowledged','rejected','expired'))
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_execution_envelope_transition');
        END;

        CREATE TRIGGER trg_execution_envelope_settled_insert
        BEFORE INSERT ON execution_envelope
        WHEN (NEW.status IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NULL)
          OR (NEW.status NOT IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NOT NULL)
          OR (NEW.status = 'rejected' AND (
                NEW.reason_code IS NULL
                OR length(trim(NEW.reason_code)) = 0
              ))
        BEGIN
          SELECT RAISE(ABORT, 'invalid_execution_envelope_settlement');
        END;

        CREATE TRIGGER trg_execution_envelope_settled_update
        BEFORE UPDATE OF status, reason_code, settled_at ON execution_envelope
        WHEN (NEW.status IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NULL)
          OR (NEW.status NOT IN ('acknowledged','rejected','expired') AND NEW.settled_at IS NOT NULL)
          OR (NEW.status = 'rejected' AND (
                NEW.reason_code IS NULL
                OR length(trim(NEW.reason_code)) = 0
              ))
        BEGIN
          SELECT RAISE(ABORT, 'invalid_execution_envelope_settlement');
        END;
      `);
    },
  },
  {
    version: 58,
    foreignKeysOff: true,
    run: (db) => {
      const table = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='autonomous_delivery_run'",
      ).get();
      if (!table) return;

      db.exec(`
        DROP TABLE IF EXISTS autonomous_delivery_run_v58;
        CREATE TABLE autonomous_delivery_run_v58 (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          root_task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK(status IN (
            'active','waiting_gate','waiting_human','retrying','completed','failed','cancelled'
          )),
          current_stage TEXT NOT NULL CHECK(current_stage IN (
            'planning','executing','reviewing','verifying','integrating','delivering'
          )),
          goal_contract_json TEXT NOT NULL,
          repair_cycle INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 0,
          escalation_code TEXT,
          escalation_detail TEXT,
          delivery_bundle_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );

        INSERT INTO autonomous_delivery_run_v58 (
          id,conversation_id,root_task_id,status,current_stage,goal_contract_json,
          repair_cycle,revision,escalation_code,escalation_detail,delivery_bundle_json,
          created_at,updated_at,completed_at
        )
        SELECT
          id,
          conversation_id,
          root_task_id,
          CASE status
            WHEN 'active' THEN 'active'
            WHEN 'waiting_gate' THEN 'waiting_gate'
            WHEN 'waiting_human' THEN 'waiting_human'
            WHEN 'retrying' THEN 'retrying'
            WHEN 'submitted' THEN 'active'
            WHEN 'planning' THEN 'active'
            WHEN 'executing' THEN 'active'
            WHEN 'reviewing' THEN 'active'
            WHEN 'verifying' THEN 'active'
            WHEN 'integrating' THEN 'active'
            WHEN 'delivering' THEN 'active'
            WHEN 'recovering' THEN 'retrying'
            WHEN 'escalated' THEN 'waiting_human'
            WHEN 'completed' THEN 'completed'
            WHEN 'failed' THEN 'failed'
            WHEN 'cancelled' THEN 'cancelled'
            ELSE 'failed'
          END,
          CASE
            WHEN current_stage IN (
              'planning','executing','reviewing','verifying','integrating','delivering'
            ) THEN current_stage
            WHEN status IN (
              'planning','executing','reviewing','verifying','integrating','delivering'
            ) THEN status
            WHEN status = 'completed' THEN 'delivering'
            ELSE 'planning'
          END,
          goal_contract_json,
          repair_cycle,
          revision + 1,
          CASE
            WHEN status IN ('escalated','waiting_human')
              THEN COALESCE(NULLIF(trim(escalation_code), ''), 'legacy_human_decision_required')
            WHEN status NOT IN (
              'active','waiting_gate','retrying','submitted','planning','executing',
              'reviewing','verifying','integrating','delivering','recovering',
              'completed','failed','cancelled'
            ) THEN COALESCE(NULLIF(trim(escalation_code), ''), 'legacy_delivery_status_unknown')
            ELSE NULL
          END,
          CASE
            WHEN status IN ('escalated','waiting_human')
              THEN COALESCE(
                NULLIF(trim(escalation_detail), ''),
                'Legacy delivery run requires a human decision before it can resume.'
              )
            ELSE escalation_detail
          END,
          delivery_bundle_json,
          created_at,
          updated_at,
          CASE
            WHEN status IN ('completed','failed','cancelled')
              OR status NOT IN (
                'active','waiting_gate','waiting_human','retrying','submitted','planning',
                'executing','reviewing','verifying','integrating','delivering','recovering',
                'escalated'
              )
              THEN COALESCE(completed_at, updated_at)
            ELSE NULL
          END
        FROM autonomous_delivery_run;

        DROP TABLE autonomous_delivery_run;
        ALTER TABLE autonomous_delivery_run_v58 RENAME TO autonomous_delivery_run;
        CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_conversation
          ON autonomous_delivery_run(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_run_reconcile
          ON autonomous_delivery_run(status, updated_at);

        DROP TRIGGER IF EXISTS trg_delivery_run_transition_update;
        DROP TRIGGER IF EXISTS trg_delivery_run_terminal_immutable;
        DROP TRIGGER IF EXISTS trg_delivery_run_state_insert;
        DROP TRIGGER IF EXISTS trg_delivery_run_state_update;

        CREATE TRIGGER trg_delivery_run_transition_update
        BEFORE UPDATE OF status ON autonomous_delivery_run
        WHEN NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'active'
              AND NEW.status IN (
                'waiting_gate','waiting_human','retrying','completed','failed','cancelled'
              ))
            OR (OLD.status = 'waiting_gate'
              AND NEW.status IN ('active','waiting_human','completed','failed','cancelled'))
            OR (OLD.status = 'waiting_human'
              AND NEW.status IN ('active','failed','cancelled'))
            OR (OLD.status = 'retrying'
              AND NEW.status IN ('active','waiting_human','failed','cancelled'))
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_delivery_run_transition');
        END;

        CREATE TRIGGER trg_delivery_run_state_insert
        BEFORE INSERT ON autonomous_delivery_run
        WHEN (NEW.status IN ('completed','failed','cancelled') AND NEW.completed_at IS NULL)
          OR (NEW.status NOT IN ('completed','failed','cancelled') AND NEW.completed_at IS NOT NULL)
          OR (NEW.status = 'waiting_human' AND (
                NEW.escalation_code IS NULL OR length(trim(NEW.escalation_code)) = 0
              ))
          OR (NEW.status = 'completed' AND NEW.delivery_bundle_json IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_delivery_run_state');
        END;

        CREATE TRIGGER trg_delivery_run_state_update
        BEFORE UPDATE OF status, escalation_code, delivery_bundle_json, completed_at
        ON autonomous_delivery_run
        WHEN (NEW.status IN ('completed','failed','cancelled') AND NEW.completed_at IS NULL)
          OR (NEW.status NOT IN ('completed','failed','cancelled') AND NEW.completed_at IS NOT NULL)
          OR (NEW.status = 'waiting_human' AND (
                NEW.escalation_code IS NULL OR length(trim(NEW.escalation_code)) = 0
              ))
          OR (NEW.status = 'completed' AND NEW.delivery_bundle_json IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'invalid_delivery_run_state');
        END;

        CREATE TRIGGER trg_delivery_run_terminal_immutable
        BEFORE UPDATE ON autonomous_delivery_run
        WHEN OLD.status IN ('completed','failed','cancelled')
        BEGIN
          SELECT RAISE(ABORT, 'delivery_run_terminal_immutable');
        END;
      `);

      const violations = db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
      if (violations.length > 0) {
        throw new Error(
          `migration 58 foreign key check failed: ${JSON.stringify(violations.slice(0, 10))}`,
        );
      }
    },
  },
  {
    version: 59,
    sql: `
CREATE TABLE IF NOT EXISTS quality_gate (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (
    'implementation_readiness','code_review','delivery_review',
    'acceptance_verification','integration'
  )),
  target_type TEXT NOT NULL CHECK(target_type IN ('task','delivery_run')),
  target_id TEXT NOT NULL,
  artifact_revision TEXT NOT NULL CHECK(length(trim(artifact_revision)) > 0),
  status TEXT NOT NULL CHECK(status IN (
    'requested','evaluating','passed','changes_requested','rejected','cancelled'
  )),
  criteria_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  requested_by_type TEXT NOT NULL CHECK(requested_by_type IN ('user','agent','system')),
  requested_by TEXT NOT NULL,
  evaluator_type TEXT CHECK(evaluator_type IN ('user','agent','system')),
  evaluator_id TEXT,
  decision_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE(kind,target_type,target_id,artifact_revision)
);
CREATE INDEX IF NOT EXISTS idx_quality_gate_conversation_status
  ON quality_gate(conversation_id,status,updated_at);

CREATE TABLE IF NOT EXISTS quality_gate_evidence (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES quality_gate(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_ref TEXT,
  submitted_by_type TEXT NOT NULL CHECK(submitted_by_type IN ('user','agent','system')),
  submitted_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(gate_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_quality_gate_evidence_gate
  ON quality_gate_evidence(gate_id,created_at);

CREATE TABLE IF NOT EXISTS quality_gate_decision (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL UNIQUE REFERENCES quality_gate(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN (
    'passed','changes_requested','rejected','cancelled'
  )),
  evaluator_type TEXT NOT NULL CHECK(evaluator_type IN ('user','agent','system')),
  evaluator_id TEXT NOT NULL,
  reason TEXT,
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_transition
BEFORE UPDATE OF status ON quality_gate
WHEN NEW.status <> OLD.status
  AND NOT (
    (OLD.status='requested' AND NEW.status IN ('evaluating','cancelled'))
    OR (OLD.status='evaluating'
      AND NEW.status IN ('passed','changes_requested','rejected','cancelled'))
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_quality_gate_transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_state_insert
BEFORE INSERT ON quality_gate
WHEN (NEW.status='requested' AND (
        NEW.evaluator_type IS NOT NULL OR NEW.evaluator_id IS NOT NULL OR NEW.decided_at IS NOT NULL
      ))
  OR (NEW.status='evaluating' AND (
        NEW.evaluator_type IS NULL OR NEW.evaluator_id IS NULL OR NEW.decided_at IS NOT NULL
      ))
  OR (NEW.status IN ('passed','changes_requested','rejected','cancelled') AND (
        NEW.evaluator_type IS NULL OR NEW.evaluator_id IS NULL OR NEW.decided_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'invalid_quality_gate_state');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_state_update
BEFORE UPDATE OF status,evaluator_type,evaluator_id,decided_at ON quality_gate
WHEN (NEW.status='requested' AND (
        NEW.evaluator_type IS NOT NULL OR NEW.evaluator_id IS NOT NULL OR NEW.decided_at IS NOT NULL
      ))
  OR (NEW.status='evaluating' AND (
        NEW.evaluator_type IS NULL OR NEW.evaluator_id IS NULL OR NEW.decided_at IS NOT NULL
      ))
  OR (NEW.status IN ('passed','changes_requested','rejected','cancelled') AND (
        NEW.evaluator_type IS NULL OR NEW.evaluator_id IS NULL OR NEW.decided_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'invalid_quality_gate_state');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_terminal_immutable
BEFORE UPDATE ON quality_gate
WHEN OLD.status IN ('passed','changes_requested','rejected','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'quality_gate_terminal_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_evidence_immutable_update
BEFORE UPDATE ON quality_gate_evidence
BEGIN
  SELECT RAISE(ABORT, 'quality_gate_evidence_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_evidence_immutable_delete
BEFORE DELETE ON quality_gate_evidence
WHEN EXISTS (SELECT 1 FROM quality_gate WHERE id=OLD.gate_id)
BEGIN
  SELECT RAISE(ABORT, 'quality_gate_evidence_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_decision_immutable_update
BEFORE UPDATE ON quality_gate_decision
BEGIN
  SELECT RAISE(ABORT, 'quality_gate_decision_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_quality_gate_decision_immutable_delete
BEFORE DELETE ON quality_gate_decision
WHEN EXISTS (SELECT 1 FROM quality_gate WHERE id=OLD.gate_id)
BEGIN
  SELECT RAISE(ABORT, 'quality_gate_decision_immutable');
END;
`,
  },
  {
    version: 60,
    sql: `
CREATE TABLE IF NOT EXISTS work_contract (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  work_epoch INTEGER NOT NULL CHECK(work_epoch > 0),
  attempt_id TEXT NOT NULL UNIQUE,
  fencing_token TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  task_id TEXT,
  delivery_run_id TEXT,
  agent_id TEXT NOT NULL CHECK(length(trim(agent_id)) > 0),
  goal TEXT NOT NULL CHECK(length(trim(goal)) > 0),
  acceptance_criteria_json TEXT NOT NULL,
  role_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  authoritative_refs_json TEXT NOT NULL,
  authoritative_revisions_json TEXT NOT NULL,
  context_snapshot_ref TEXT NOT NULL CHECK(length(trim(context_snapshot_ref)) > 0),
  allowed_outcome_types_json TEXT NOT NULL,
  deadline_at TEXT,
  budget_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL CHECK(length(trim(correlation_id)) > 0),
  causation_id TEXT NOT NULL CHECK(length(trim(causation_id)) > 0),
  created_at TEXT NOT NULL,
  UNIQUE(work_id,work_epoch)
);
CREATE INDEX IF NOT EXISTS idx_work_contract_project_agent
  ON work_contract(project_id,agent_id,created_at);
CREATE INDEX IF NOT EXISTS idx_work_contract_task
  ON work_contract(task_id,created_at);

CREATE TABLE IF NOT EXISTS work_authority (
  work_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  current_epoch INTEGER NOT NULL CHECK(current_epoch > 0),
  current_contract_id TEXT NOT NULL UNIQUE
    REFERENCES work_contract(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('active','closed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK(
    (status='active' AND closed_at IS NULL)
    OR (status='closed' AND closed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_work_authority_project_status
  ON work_authority(project_id,status,updated_at);

CREATE TABLE IF NOT EXISTS agent_outcome (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  work_epoch INTEGER NOT NULL CHECK(work_epoch > 0),
  attempt_id TEXT NOT NULL,
  fencing_token TEXT NOT NULL,
  outcome_type TEXT NOT NULL CHECK(outcome_type IN (
    'continue_work','propose_task_graph','submit_task_result','request_review',
    'record_gate_decision','handoff_to_agent','report_blocked','request_human_decision'
  )),
  payload_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  authoritative_revisions_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  admission_status TEXT NOT NULL CHECK(admission_status IN ('accepted','rejected')),
  rejection_reason TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(project_id,idempotency_key),
  CHECK(
    (admission_status='accepted' AND rejection_reason IS NULL)
    OR (
      admission_status='rejected'
      AND rejection_reason IS NOT NULL
      AND length(trim(rejection_reason)) > 0
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_agent_outcome_contract
  ON agent_outcome(contract_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_agent_outcome_work
  ON agent_outcome(work_id,work_epoch,recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_outcome_terminal_contract
  ON agent_outcome(contract_id)
  WHERE admission_status='accepted' AND outcome_type<>'continue_work';

CREATE TRIGGER IF NOT EXISTS trg_work_contract_immutable
BEFORE UPDATE ON work_contract
BEGIN
  SELECT RAISE(ABORT, 'work_contract_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_contract_delete_guard
BEFORE DELETE ON work_contract
WHEN EXISTS (SELECT 1 FROM conversation WHERE id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'work_contract_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_authority_transition
BEFORE UPDATE ON work_authority
WHEN (OLD.status='closed')
  OR (NEW.project_id <> OLD.project_id)
  OR (NEW.revision <> OLD.revision + 1)
  OR (
    NEW.status='active'
    AND (
      NEW.current_epoch <> OLD.current_epoch + 1
      OR NEW.current_contract_id = OLD.current_contract_id
    )
  )
  OR (
    NEW.status='closed'
    AND (
      OLD.status <> 'active'
      OR NEW.current_epoch <> OLD.current_epoch
      OR NEW.current_contract_id <> OLD.current_contract_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_work_authority_transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_authority_contract_insert
BEFORE INSERT ON work_authority
WHEN NOT EXISTS (
  SELECT 1 FROM work_contract AS contract
  WHERE contract.id=NEW.current_contract_id
    AND contract.project_id=NEW.project_id
    AND contract.work_id=NEW.work_id
    AND contract.work_epoch=NEW.current_epoch
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_work_authority_contract');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_authority_contract_update
BEFORE UPDATE OF current_contract_id,current_epoch ON work_authority
WHEN NOT EXISTS (
  SELECT 1 FROM work_contract AS contract
  WHERE contract.id=NEW.current_contract_id
    AND contract.project_id=NEW.project_id
    AND contract.work_id=NEW.work_id
    AND contract.work_epoch=NEW.current_epoch
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_work_authority_contract');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_authority_delete_guard
BEFORE DELETE ON work_authority
WHEN EXISTS (SELECT 1 FROM conversation WHERE id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'work_authority_delete_forbidden');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_outcome_acceptance_contract
BEFORE INSERT ON agent_outcome
WHEN NEW.admission_status='accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM work_contract AS contract
    JOIN work_authority AS authority
      ON authority.work_id=contract.work_id
    WHERE contract.id=NEW.contract_id
      AND contract.project_id=NEW.project_id
      AND contract.work_id=NEW.work_id
      AND contract.work_epoch=NEW.work_epoch
      AND contract.attempt_id=NEW.attempt_id
      AND contract.fencing_token=NEW.fencing_token
      AND contract.correlation_id=NEW.correlation_id
      AND contract.authoritative_revisions_json=NEW.authoritative_revisions_json
      AND EXISTS (
        SELECT 1 FROM json_each(contract.allowed_outcome_types_json)
        WHERE value=NEW.outcome_type
      )
      AND authority.status='active'
      AND authority.current_contract_id=contract.id
      AND authority.current_epoch=contract.work_epoch
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_agent_outcome_authority');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_outcome_immutable
BEFORE UPDATE ON agent_outcome
BEGIN
  SELECT RAISE(ABORT, 'agent_outcome_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_outcome_delete_guard
BEFORE DELETE ON agent_outcome
WHEN EXISTS (SELECT 1 FROM conversation WHERE id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_outcome_immutable');
END;

`,
    run(db) {
      const invocationExists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='invocation'",
      ).get();
      if (!invocationExists) return;
      const columns = new Set(
        (db.pragma('table_info(invocation)') as Array<{ name: string }>)
          .map((column) => column.name),
      );
      for (const [name, type] of [
        ['work_contract_id', 'TEXT'],
        ['work_id', 'TEXT'],
        ['work_epoch', 'INTEGER'],
        ['fencing_token', 'TEXT'],
      ] as const) {
        if (!columns.has(name)) db.exec(`ALTER TABLE invocation ADD COLUMN ${name} ${type}`);
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_invocation_work_contract
        ON invocation(work_contract_id)
        WHERE work_contract_id IS NOT NULL
      `);
      if (!['id', 'conversation_id', 'agent_id'].every((column) => columns.has(column))) return;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_invocation_work_binding_insert
        BEFORE INSERT ON invocation
        WHEN (
            NEW.work_contract_id IS NULL
            AND (
              NEW.work_id IS NOT NULL
              OR NEW.work_epoch IS NOT NULL
              OR NEW.fencing_token IS NOT NULL
            )
          )
          OR (
            NEW.work_contract_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM work_contract AS contract
              JOIN work_authority AS authority
                ON authority.current_contract_id=contract.id
              WHERE contract.id=NEW.work_contract_id
                AND contract.attempt_id=NEW.id
                AND contract.project_id=NEW.conversation_id
                AND contract.agent_id=NEW.agent_id
                AND contract.work_id=NEW.work_id
                AND contract.work_epoch=NEW.work_epoch
                AND contract.fencing_token=NEW.fencing_token
                AND authority.status='active'
                AND authority.current_epoch=contract.work_epoch
            )
          )
        BEGIN
          SELECT RAISE(ABORT, 'invalid_invocation_work_binding');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_invocation_work_binding_immutable
        BEFORE UPDATE OF work_contract_id,work_id,work_epoch,fencing_token ON invocation
        WHEN NEW.work_contract_id IS NOT OLD.work_contract_id
          OR NEW.work_id IS NOT OLD.work_id
          OR NEW.work_epoch IS NOT OLD.work_epoch
          OR NEW.fencing_token IS NOT OLD.fencing_token
        BEGIN
          SELECT RAISE(ABORT, 'invocation_work_binding_immutable');
        END
      `);
    },
  },
  {
    version: 61,
    run(db) {
      const tableExists = (name: string) => Boolean(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
      ).get(name));
      const addColumns = (
        table: string,
        definitions: ReadonlyArray<readonly [name: string, sqlType: string]>,
      ) => {
        if (!tableExists(table)) return;
        const columns = new Set(
          (db.pragma(`table_info(${table})`) as Array<{ name: string }>)
            .map((column) => column.name),
        );
        for (const [name, sqlType] of definitions) {
          if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlType}`);
        }
      };

      addColumns('a2a_possession_chain', [
        ['revision', 'INTEGER NOT NULL DEFAULT 0'],
        ['updated_at', "TEXT NOT NULL DEFAULT ''"],
      ]);
      addColumns('a2a_possession', [
        ['parent_pass_id', 'TEXT'],
        ['revision', 'INTEGER NOT NULL DEFAULT 0'],
        ['updated_at', "TEXT NOT NULL DEFAULT ''"],
      ]);
      addColumns('a2a_pass', [
        ['group_id', 'TEXT'],
        ['idempotency_key', 'TEXT'],
        ['hop_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['target_possession_id', 'TEXT'],
        ['inbox_item_id', 'TEXT'],
        ['task_id', 'TEXT'],
        ['revision', 'INTEGER NOT NULL DEFAULT 0'],
      ]);

      if (tableExists('a2a_possession_chain')) {
        db.exec(`
          UPDATE a2a_possession_chain
          SET updated_at=COALESCE(NULLIF(updated_at,''),completed_at,created_at)
        `);
      }
      if (tableExists('a2a_possession')) {
        db.exec(`
          UPDATE a2a_possession
          SET updated_at=COALESCE(NULLIF(updated_at,''),completed_at,started_at)
        `);
      }

      if (
        tableExists('a2a_possession_chain')
        && tableExists('a2a_possession')
        && tableExists('a2a_pass')
      ) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS a2a_pass_group (
            id TEXT PRIMARY KEY,
            chain_id TEXT NOT NULL REFERENCES a2a_possession_chain(id) ON DELETE CASCADE,
            source_possession_id TEXT NOT NULL REFERENCES a2a_possession(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            request_digest TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('transfer','fan_out')),
            status TEXT NOT NULL CHECK(status IN (
              'offered','active','recovering','completed','failed','cancelled'
            )),
            expected_count INTEGER NOT NULL CHECK(expected_count > 0),
            resolved_count INTEGER NOT NULL DEFAULT 0
              CHECK(resolved_count >= 0 AND resolved_count <= expected_count),
            recovery_possession_id TEXT,
            hop_count INTEGER NOT NULL CHECK(hop_count >= 0),
            max_hops INTEGER NOT NULL CHECK(max_hops > 0),
            revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            CHECK(
              (status IN ('offered','active','recovering') AND completed_at IS NULL)
              OR (status IN ('completed','failed','cancelled') AND completed_at IS NOT NULL)
            )
          );
          CREATE INDEX IF NOT EXISTS idx_a2a_pass_group_chain
            ON a2a_pass_group(chain_id,status,created_at);
          CREATE UNIQUE INDEX IF NOT EXISTS uq_a2a_pass_group_idempotency
            ON a2a_pass_group(chain_id,idempotency_key);
          CREATE UNIQUE INDEX IF NOT EXISTS uq_a2a_pass_group_source_open
            ON a2a_pass_group(source_possession_id)
            WHERE status IN ('offered','active','recovering');
          CREATE UNIQUE INDEX IF NOT EXISTS uq_a2a_pass_idempotency
            ON a2a_pass(chain_id,idempotency_key)
            WHERE idempotency_key IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_a2a_pass_group
            ON a2a_pass(group_id,status,updated_at);
          CREATE INDEX IF NOT EXISTS idx_a2a_possession_parent_pass
            ON a2a_possession(parent_pass_id);
        `);
      }
    },
  },
  {
    version: 62,
    foreignKeysOff: true,
    sql: `
      DROP TABLE IF EXISTS a2a_delivery;
      DROP TABLE IF EXISTS delivery_cursor;
      DROP TABLE IF EXISTS chain_worklist;
      DROP TABLE IF EXISTS invocation_chain;
      DROP TABLE IF EXISTS a2a_audit_log;
    `,
  },
  {
    version: 63,
    foreignKeysOff: true,
    run: (db) => {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_invocation_projection'",
      ).get();
      if (!exists) return;
      db.exec(`
        ALTER TABLE runtime_invocation_projection RENAME TO runtime_invocation_projection_v62;
        CREATE TABLE runtime_invocation_projection (
          invocation_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          project_agent_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('blocked','accepted','running','terminated')),
          outcome TEXT,
          reason_code TEXT,
          accepted_at TEXT NOT NULL,
          started_at TEXT,
          terminated_at TEXT,
          last_stream_sequence INTEGER NOT NULL CHECK(last_stream_sequence > 0),
          updated_at TEXT NOT NULL
        );
        INSERT INTO runtime_invocation_projection (
          invocation_id,project_id,project_agent_id,status,outcome,reason_code,
          accepted_at,started_at,terminated_at,last_stream_sequence,updated_at
        )
        SELECT
          invocation_id,project_id,project_agent_id,status,outcome,reason_code,
          accepted_at,started_at,terminated_at,last_stream_sequence,updated_at
        FROM runtime_invocation_projection_v62;
        DROP TABLE runtime_invocation_projection_v62;
        CREATE INDEX idx_runtime_invocation_projection_project
          ON runtime_invocation_projection(project_id,project_agent_id,updated_at);
      `);
    },
  },
  {
    version: 64,
    sql: `
      CREATE TABLE IF NOT EXISTS supervisor_control_decision (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        snapshot_revision INTEGER NOT NULL CHECK(snapshot_revision>=0),
        policy_revision INTEGER NOT NULL CHECK(policy_revision>=0),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','superseded','completed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(run_id,snapshot_revision,policy_revision)
      );
      CREATE INDEX IF NOT EXISTS idx_supervisor_control_decision_active
        ON supervisor_control_decision(run_id,status,created_at);

      CREATE TABLE IF NOT EXISTS supervisor_control_action (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES supervisor_control_decision(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN (
          'activate','retry','requestGate','resume','escalateToHuman','terminate'
        )),
        target_work_id TEXT,
        work_epoch INTEGER,
        slot_id TEXT,
        reason_code TEXT NOT NULL,
        retry_budget_kind TEXT CHECK(retry_budget_kind IS NULL OR retry_budget_kind IN (
          'invocation','effect','task_rework','agent_local'
        )),
        termination_outcome TEXT CHECK(
          termination_outcome IS NULL OR termination_outcome IN ('completed','failed')
        ),
        status TEXT NOT NULL CHECK(status IN ('ready','claimed','applied','failed','cancelled')),
        claim_token TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        CHECK(
          (target_work_id IS NULL AND work_epoch IS NULL)
          OR (target_work_id IS NOT NULL AND work_epoch IS NOT NULL AND work_epoch>=0)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_supervisor_control_action_claim
        ON supervisor_control_action(run_id,status,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_supervisor_control_active_slot
        ON supervisor_control_action(run_id,slot_id)
        WHERE slot_id IS NOT NULL AND type='activate' AND status IN ('claimed','applied');
    `,
  },
  {
    version: 65,
    foreignKeysOff: true,
    run: (db) => {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_effect_outbox'",
      ).get();
      if (!exists) return;
      db.exec(`
        ALTER TABLE platform_effect_attempt RENAME TO platform_effect_attempt_v64;
        ALTER TABLE platform_effect_outbox RENAME TO platform_effect_outbox_v64;
        CREATE TABLE platform_effect_outbox (
          id TEXT PRIMARY KEY,
          source_event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
          effect_type TEXT NOT NULL,
          target_key TEXT NOT NULL,
          lane_key TEXT NOT NULL,
          lane_sequence INTEGER NOT NULL CHECK(lane_sequence>0),
          idempotency_key TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'queued','running','succeeded','dead_letter','cancelled','superseded'
          )),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
          max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts>0),
          criticality TEXT NOT NULL DEFAULT 'non_blocking'
            CHECK(criticality IN ('blocking','non_blocking')),
          delivery_run_id TEXT REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          applies_from_revision INTEGER NOT NULL DEFAULT 0 CHECK(applies_from_revision>=0),
          source_action_id TEXT,
          superseded_at_revision INTEGER,
          successor_effect_id TEXT,
          disposition_reason TEXT,
          next_attempt_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_expires_at TEXT,
          current_attempt_id TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE(lane_key,lane_sequence),
          CHECK(
            (status='superseded' AND superseded_at_revision IS NOT NULL
              AND disposition_reason IS NOT NULL)
            OR (status<>'superseded' AND superseded_at_revision IS NULL)
          ),
          CHECK(
            status NOT IN ('cancelled','superseded') OR disposition_reason IS NOT NULL
          )
        );
        INSERT INTO platform_effect_outbox (
          id,source_event_id,effect_type,target_key,lane_key,lane_sequence,
          idempotency_key,payload,status,attempt_count,max_attempts,criticality,
          delivery_run_id,applies_from_revision,source_action_id,
          superseded_at_revision,successor_effect_id,disposition_reason,
          next_attempt_at,lease_owner,lease_expires_at,current_attempt_id,last_error,
          created_at,updated_at,completed_at
        )
        SELECT
          id,source_event_id,effect_type,target_key,lane_key,lane_sequence,
          idempotency_key,payload,status,attempt_count,5,'non_blocking',
          NULL,0,NULL,NULL,NULL,NULL,next_attempt_at,lease_owner,lease_expires_at,
          current_attempt_id,last_error,created_at,updated_at,completed_at
        FROM platform_effect_outbox_v64;

        CREATE TABLE platform_effect_attempt (
          id TEXT PRIMARY KEY,
          effect_id TEXT NOT NULL REFERENCES platform_effect_outbox(id) ON DELETE CASCADE,
          attempt_no INTEGER NOT NULL CHECK(attempt_no>0),
          worker_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','abandoned')),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT,
          UNIQUE(effect_id,attempt_no)
        );
        INSERT INTO platform_effect_attempt
          SELECT * FROM platform_effect_attempt_v64;
        DROP TABLE platform_effect_attempt_v64;
        DROP TABLE platform_effect_outbox_v64;

        CREATE INDEX idx_platform_effect_claim
          ON platform_effect_outbox(status,next_attempt_at,effect_type,lane_key,lane_sequence);
        CREATE INDEX idx_platform_effect_source
          ON platform_effect_outbox(source_event_id,lane_key,lane_sequence);
        CREATE INDEX idx_platform_effect_delivery_closure
          ON platform_effect_outbox(delivery_run_id,criticality,status,applies_from_revision);
        CREATE INDEX idx_platform_effect_attempt_effect
          ON platform_effect_attempt(effect_id,attempt_no);
      `);
    },
  },
  {
    version: 66,
    foreignKeysOff: true,
    run: (db) => {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='supervisor_control_action'",
      ).get();
      const dependencies = db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type='table' AND name IN (
          'conversation','autonomous_delivery_run','supervisor_control_decision'
        )
      `).get() as { count: number };
      if (!exists || dependencies.count !== 3) return;
      db.exec(`
        ALTER TABLE supervisor_control_action RENAME TO supervisor_control_action_v65;
        CREATE TABLE supervisor_control_action (
          id TEXT PRIMARY KEY,
          decision_id TEXT NOT NULL REFERENCES supervisor_control_decision(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN (
            'initializeGraph','activate','retry','requestGate','integrate','finalize',
            'resume','escalateToHuman','terminate'
          )),
          target_work_id TEXT,
          work_epoch INTEGER,
          slot_id TEXT,
          reason_code TEXT NOT NULL,
          retry_budget_kind TEXT CHECK(retry_budget_kind IS NULL OR retry_budget_kind IN (
            'invocation','effect','task_rework','agent_local'
          )),
          termination_outcome TEXT CHECK(
            termination_outcome IS NULL OR termination_outcome IN ('completed','failed')
          ),
          status TEXT NOT NULL CHECK(status IN ('ready','claimed','applied','failed','cancelled')),
          claim_token TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          failure_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          CHECK(
            (target_work_id IS NULL AND work_epoch IS NULL)
            OR (target_work_id IS NOT NULL AND work_epoch IS NOT NULL AND work_epoch>=0)
          )
        );
        INSERT INTO supervisor_control_action
          SELECT * FROM supervisor_control_action_v65;
        DROP TABLE supervisor_control_action_v65;
        CREATE INDEX idx_supervisor_control_action_claim
          ON supervisor_control_action(run_id,status,created_at);
        CREATE UNIQUE INDEX uq_supervisor_control_active_slot
          ON supervisor_control_action(run_id,slot_id)
          WHERE slot_id IS NOT NULL AND type='activate' AND status IN ('claimed','applied');
      `);
    },
  },
  {
    version: 67,
    foreignKeysOff: true,
    run: (db) => {
      const receipt = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='autonomous_delivery_receipt'",
      ).get();
      if (!receipt) return;
      db.exec(`
        ALTER TABLE autonomous_delivery_receipt RENAME TO autonomous_delivery_receipt_v66;
        CREATE TABLE autonomous_delivery_receipt (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          external_id TEXT,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          observed_at TEXT NOT NULL
        );
        INSERT INTO autonomous_delivery_receipt (
          id,run_id,kind,external_id,status,payload_json,idempotency_key,observed_at
        )
        SELECT
          id,run_id,kind,external_id,status,payload_json,idempotency_key,observed_at
        FROM autonomous_delivery_receipt_v66;
        DROP TABLE autonomous_delivery_receipt_v66;
        DROP TABLE IF EXISTS autonomous_delivery_attempt;
        DROP TABLE IF EXISTS autonomous_delivery_action;
        CREATE INDEX idx_autonomous_delivery_receipt_run
          ON autonomous_delivery_receipt(run_id,kind,observed_at);
      `);
    },
  },
  {
    version: 68,
    foreignKeysOff: true,
    run: (db) => {
      const legacyTables = db.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type='table'
          AND name IN ('supervisor_control_decision','supervisor_control_action')
      `).get() as { count: number };
      if (legacyTables.count !== 2) return;
      db.exec(`
        DROP INDEX IF EXISTS idx_supervisor_control_decision_active;
        DROP INDEX IF EXISTS idx_supervisor_control_action_claim;
        DROP INDEX IF EXISTS uq_supervisor_control_active_slot;
        CREATE TABLE IF NOT EXISTS delivery_control_decision (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          snapshot_revision INTEGER NOT NULL,
          policy_revision INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','completed','superseded')),
          created_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE(run_id,snapshot_revision,policy_revision)
        );
        CREATE TABLE IF NOT EXISTS delivery_control_action (
          id TEXT PRIMARY KEY,
          decision_id TEXT NOT NULL REFERENCES delivery_control_decision(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN (
            'initializeGraph','activate','retry','requestGate','integrate','finalize',
            'resume','escalateToHuman','terminate'
          )),
          target_work_id TEXT,
          work_epoch INTEGER,
          slot_id TEXT,
          reason_code TEXT NOT NULL,
          retry_budget_kind TEXT,
          termination_outcome TEXT,
          status TEXT NOT NULL CHECK(status IN ('ready','claimed','applied','failed','cancelled')),
          claim_token TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          failure_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          CHECK(
            (target_work_id IS NULL AND work_epoch IS NULL)
            OR (target_work_id IS NOT NULL AND work_epoch IS NOT NULL AND work_epoch>=0)
          )
        );
        INSERT OR IGNORE INTO delivery_control_decision
          SELECT * FROM supervisor_control_decision;
        INSERT OR IGNORE INTO delivery_control_action (
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          retry_budget_kind,termination_outcome,status,claim_token,lease_owner,
          lease_expires_at,failure_code,created_at,updated_at,completed_at
        )
        SELECT
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          retry_budget_kind,termination_outcome,status,claim_token,lease_owner,
          lease_expires_at,failure_code,created_at,updated_at,completed_at
        FROM supervisor_control_action;
        DROP TABLE supervisor_control_action;
        DROP TABLE supervisor_control_decision;
        CREATE INDEX IF NOT EXISTS idx_delivery_control_decision_active
          ON delivery_control_decision(run_id,status,created_at);
        CREATE INDEX IF NOT EXISTS idx_delivery_control_action_claim
          ON delivery_control_action(run_id,status,created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_control_active_slot
          ON delivery_control_action(run_id,slot_id)
          WHERE slot_id IS NOT NULL AND type='activate' AND status IN ('claimed','applied');
      `);
    },
  },
  {
    version: 69,
    run: (db) => {
      const table = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='a2a_pass_group'
      `).get();
      if (!table) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(a2a_pass_group)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has('source_work_id')) {
        db.exec('ALTER TABLE a2a_pass_group ADD COLUMN source_work_id TEXT');
      }
      if (!columns.has('delivery_run_id')) {
        db.exec(`
          ALTER TABLE a2a_pass_group
            ADD COLUMN delivery_run_id TEXT
              REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE
        `);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_a2a_pass_group_delivery
          ON a2a_pass_group(delivery_run_id,status,created_at)
      `);
    },
  },
  {
    version: 70,
    run: (db) => {
      const tables = new Set(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{
          name: string;
        }>).map((row) => row.name),
      );
      if (tables.has('conversation')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_graph_revision (
            conversation_id TEXT PRIMARY KEY
              REFERENCES conversation(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
            updated_at TEXT NOT NULL
          )
        `);
      }
      if (tables.has('conversation') && tables.has('task_action')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_graph_commit (
            idempotency_key TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL
              REFERENCES conversation(id) ON DELETE CASCADE,
            request_digest TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision > 0),
            action_id TEXT NOT NULL REFERENCES task_action(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_task_graph_commit_conversation
            ON task_graph_commit(conversation_id,revision);
        `);
      }
      if (tables.has('platform_event')) {
        const columns = new Set(
          (db.prepare('PRAGMA table_info(platform_event)').all() as Array<{ name: string }>)
            .map((column) => column.name),
        );
        if (columns.has('correlation_id')) {
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_platform_event_correlation
              ON platform_event(correlation_id,recorded_at,id)
          `);
        }
      }
    },
  },
  {
    version: 71,
    run: (db) => {
      const deliveryTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='autonomous_delivery_run'
      `).get();
      if (deliveryTable) {
        const columns = new Set(
          (db.prepare('PRAGMA table_info(autonomous_delivery_run)').all() as Array<{
            name: string;
          }>).map((column) => column.name),
        );
        if (!columns.has('start_idempotency_key')) {
          db.exec('ALTER TABLE autonomous_delivery_run ADD COLUMN start_idempotency_key TEXT');
        }
        db.exec(`
          UPDATE autonomous_delivery_run
          SET start_idempotency_key='legacy:' || id
          WHERE start_idempotency_key IS NULL OR trim(start_idempotency_key)='';
          CREATE UNIQUE INDEX IF NOT EXISTS uq_autonomous_delivery_run_start
            ON autonomous_delivery_run(start_idempotency_key);
          CREATE TRIGGER IF NOT EXISTS trg_delivery_run_start_key_insert
          BEFORE INSERT ON autonomous_delivery_run
          WHEN NEW.start_idempotency_key IS NULL OR trim(NEW.start_idempotency_key)=''
          BEGIN
            SELECT RAISE(ABORT,'delivery_run_start_idempotency_key_required');
          END;
          CREATE TRIGGER IF NOT EXISTS trg_delivery_run_start_key_update
          BEFORE UPDATE OF start_idempotency_key ON autonomous_delivery_run
          WHEN NEW.start_idempotency_key IS NULL OR trim(NEW.start_idempotency_key)=''
          BEGIN
            SELECT RAISE(ABORT,'delivery_run_start_idempotency_key_required');
          END;
        `);
      }
      const actionTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='delivery_control_action'
      `).get();
      if (actionTable) {
        db.exec(`
          DROP INDEX IF EXISTS uq_delivery_control_active_slot;
          CREATE UNIQUE INDEX uq_delivery_control_active_slot
            ON delivery_control_action(run_id,slot_id)
            WHERE slot_id IS NOT NULL
              AND type IN ('activate','retry')
              AND status IN ('claimed','applied');
        `);
      }
    },
  },
  {
    version: 72,
    run: (db) => {
      const taskTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='task'
      `).get();
      if (!taskTable) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has('revision')) {
        db.exec('ALTER TABLE task ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_task_revision_nonnegative_insert
        BEFORE INSERT ON task
        WHEN NEW.revision < 0
        BEGIN
          SELECT RAISE(ABORT,'task_revision_must_be_nonnegative');
        END;
        CREATE TRIGGER IF NOT EXISTS trg_task_revision_monotonic_update
        BEFORE UPDATE OF revision ON task
        WHEN NEW.revision <= OLD.revision
        BEGIN
          SELECT RAISE(ABORT,'task_revision_must_advance');
        END;
      `);
    },
  },
  {
    version: 73,
    run: (db) => {
      const actionTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='delivery_control_action'
      `).get();
      if (!actionTable) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(delivery_control_action)').all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      if (!columns.has('attempt_count')) {
        db.exec(`
          ALTER TABLE delivery_control_action
          ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
        `);
      }
      if (!columns.has('max_attempts')) {
        db.exec(`
          ALTER TABLE delivery_control_action
          ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3
        `);
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_control_action_attempt_bounds_insert
        BEFORE INSERT ON delivery_control_action
        WHEN NEW.attempt_count < 0 OR NEW.max_attempts <= 0
          OR NEW.attempt_count > NEW.max_attempts
        BEGIN
          SELECT RAISE(ABORT,'control_action_attempt_bounds_invalid');
        END;
        CREATE TRIGGER IF NOT EXISTS trg_control_action_attempt_bounds_update
        BEFORE UPDATE OF attempt_count,max_attempts ON delivery_control_action
        WHEN NEW.attempt_count < OLD.attempt_count OR NEW.max_attempts <= 0
          OR NEW.attempt_count > NEW.max_attempts
        BEGIN
          SELECT RAISE(ABORT,'control_action_attempt_bounds_invalid');
        END;
      `);
    },
  },
  {
    version: 74,
    run: (db) => {
      const commitTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='task_graph_commit'
      `).get();
      if (!commitTable) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(task_graph_commit)').all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      if (!columns.has('result_json')) {
        db.exec(`
          ALTER TABLE task_graph_commit
          ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'
        `);
      }
    },
  },
  {
    version: 75,
    run: (db) => {
      const deliveryTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='autonomous_delivery_run'
      `).get();
      if (deliveryTable) {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_delivery_run_start_key_immutable
          BEFORE UPDATE OF start_idempotency_key ON autonomous_delivery_run
          WHEN NEW.start_idempotency_key IS NOT OLD.start_idempotency_key
          BEGIN
            SELECT RAISE(ABORT,'delivery_run_start_idempotency_key_immutable');
          END;
        `);
      }
      const actionTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='delivery_control_action'
      `).get();
      if (actionTable) {
        db.exec(`
          UPDATE delivery_control_action
          SET status='ready',claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
              updated_at=COALESCE(updated_at,created_at)
          WHERE status='claimed'
            AND (claim_token IS NULL OR lease_owner IS NULL OR lease_expires_at IS NULL);
          UPDATE delivery_control_action
          SET claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL
          WHERE status<>'claimed'
            AND (claim_token IS NOT NULL OR lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL);
          CREATE TRIGGER IF NOT EXISTS trg_control_action_lease_shape_insert
          BEFORE INSERT ON delivery_control_action
          WHEN (
            NEW.status='claimed'
            AND (NEW.claim_token IS NULL OR NEW.lease_owner IS NULL OR NEW.lease_expires_at IS NULL)
          ) OR (
            NEW.status<>'claimed'
            AND (NEW.claim_token IS NOT NULL OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL)
          )
          BEGIN
            SELECT RAISE(ABORT,'delivery_control_action_lease_shape_invalid');
          END;
          CREATE TRIGGER IF NOT EXISTS trg_control_action_lease_shape_update
          BEFORE UPDATE OF status,claim_token,lease_owner,lease_expires_at
          ON delivery_control_action
          WHEN (
            NEW.status='claimed'
            AND (NEW.claim_token IS NULL OR NEW.lease_owner IS NULL OR NEW.lease_expires_at IS NULL)
          ) OR (
            NEW.status<>'claimed'
            AND (NEW.claim_token IS NOT NULL OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL)
          )
          BEGIN
            SELECT RAISE(ABORT,'delivery_control_action_lease_shape_invalid');
          END;
        `);
      }
    },
  },
  {
    version: 76,
    run: (db) => {
      const runtimeNodeTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='runtime_node'
      `).get();
      if (!runtimeNodeTable) return;
      const bindingTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='agent_binding'
      `).get();
      if (bindingTable) {
        db.exec(`
          DELETE FROM agent_binding
          WHERE node_id IN (SELECT id FROM runtime_node WHERE kind='bridge')
        `);
      }
      db.exec("DELETE FROM runtime_node WHERE kind='bridge'");
    },
  },
  {
    version: 77,
    run: (db) => {
      const annotationTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='eval_annotation'
      `).get();
      if (!annotationTable) return;
      db.exec(`
        UPDATE eval_annotation
        SET conversation_id=COALESCE(
          (SELECT r.conversation_id FROM eval_run r WHERE r.id=eval_annotation.run_id),
          (SELECT d.conversation_id FROM eval_case c
           JOIN eval_dataset d ON d.id=c.dataset_id
           WHERE c.id=eval_annotation.case_id)
        )
        WHERE conversation_id IS NULL
          AND COALESCE(
            (SELECT r.conversation_id FROM eval_run r WHERE r.id=eval_annotation.run_id),
            (SELECT d.conversation_id FROM eval_case c
             JOIN eval_dataset d ON d.id=c.dataset_id
             WHERE c.id=eval_annotation.case_id)
          ) IS NOT NULL
      `);
    },
  },
  {
    version: 78,
    sql: `DROP TABLE IF EXISTS agent_team_pack;`,
  },
  {
    version: 79,
    sql: `
CREATE TABLE IF NOT EXISTS human_command_receipt (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  command_type TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  project_path TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_command_receipt_conversation
  ON human_command_receipt(conversation_id,created_at,id);
`,
  },
  {
    version: 80,
    foreignKeysOff: true,
    run: (db) => {
      const tables = db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type='table' AND name IN ('human_command_receipt','conversation')
      `).get() as { count: number };
      if (tables.count !== 2) return;
      db.exec(`
        ALTER TABLE human_command_receipt RENAME TO human_command_receipt_v79;
        CREATE TABLE human_command_receipt (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_digest TEXT NOT NULL,
          command_type TEXT NOT NULL,
          conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
          project_path TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO human_command_receipt (
          id,idempotency_key,request_digest,command_type,conversation_id,
          project_path,actor_type,actor_id,receipt_json,created_at
        )
        SELECT
          id,idempotency_key,request_digest,command_type,conversation_id,
          project_path,actor_type,actor_id,receipt_json,created_at
        FROM human_command_receipt_v79;
        DROP TABLE human_command_receipt_v79;
        CREATE INDEX idx_human_command_receipt_conversation
          ON human_command_receipt(conversation_id,created_at,id);
      `);
    },
  },
  {
    version: 81,
    sql: `
CREATE TABLE IF NOT EXISTS task_command_rejection_receipt (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  command_type TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  expected_task_revision INTEGER NOT NULL CHECK(expected_task_revision >= 0),
  response_json TEXT NOT NULL,
  recovery_inbox_item_id TEXT REFERENCES agent_inbox_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_command_rejection_receipt_task
  ON task_command_rejection_receipt(conversation_id,task_id,created_at,id);
`,
  },
  {
    version: 82,
    foreignKeysOff: true,
    run: (db) => {
      const tables = db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type='table'
          AND name IN ('task_command_rejection_receipt','conversation','agent_inbox_item')
      `).get() as { count: number };
      // Some recovery tests intentionally open partial historical checkpoints.
      // As with migration v80, only rebuild the aggregate-linked table when
      // the complete owning schema is present.
      if (tables.count !== 3) return;
      db.exec(`
        ALTER TABLE task_command_rejection_receipt
          RENAME TO task_command_rejection_receipt_v81;
        CREATE TABLE task_command_rejection_receipt (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_digest TEXT NOT NULL,
          command_type TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          expected_task_revision INTEGER NOT NULL CHECK(expected_task_revision >= 0),
          response_json TEXT NOT NULL,
          recovery_inbox_item_id TEXT REFERENCES agent_inbox_item(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO task_command_rejection_receipt (
          id,idempotency_key,request_digest,command_type,conversation_id,task_id,
          expected_task_revision,response_json,recovery_inbox_item_id,created_at
        )
        SELECT
          id,idempotency_key,request_digest,command_type,conversation_id,task_id,
          expected_task_revision,response_json,recovery_inbox_item_id,created_at
        FROM task_command_rejection_receipt_v81;
        DROP TABLE task_command_rejection_receipt_v81;
        CREATE INDEX idx_task_command_rejection_receipt_task
          ON task_command_rejection_receipt(conversation_id,task_id,created_at,id);
      `);
    },
  },
  {
    version: 83,
    foreignKeysOff: true,
    run: (db) => {
      const actionTable = db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='delivery_control_action'
      `).get();
      const dependencies = db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type='table' AND name IN (
          'conversation','autonomous_delivery_run','delivery_control_decision'
        )
      `).get() as { count: number };
      if (!actionTable || dependencies.count !== 3) return;
      const columns = new Set(
        (db.prepare('PRAGMA table_info(delivery_control_action)').all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      if (!columns.has('attempt_count')) {
        db.exec(`
          ALTER TABLE delivery_control_action
          ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
        `);
      }
      if (!columns.has('max_attempts')) {
        db.exec(`
          ALTER TABLE delivery_control_action
          ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3
        `);
      }
      db.exec(`
        DROP INDEX IF EXISTS idx_delivery_control_action_claim;
        DROP INDEX IF EXISTS uq_delivery_control_active_slot;
        DROP TRIGGER IF EXISTS trg_control_action_attempt_bounds_insert;
        DROP TRIGGER IF EXISTS trg_control_action_attempt_bounds_update;
        DROP TRIGGER IF EXISTS trg_control_action_lease_shape_insert;
        DROP TRIGGER IF EXISTS trg_control_action_lease_shape_update;
        ALTER TABLE delivery_control_action RENAME TO delivery_control_action_v82;
        CREATE TABLE delivery_control_action (
          id TEXT PRIMARY KEY,
          decision_id TEXT NOT NULL REFERENCES delivery_control_decision(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN (
            'initializeGraph','activate','continue','retry','requestGate','integrate','finalize',
            'resume','escalateToHuman','terminate'
          )),
          target_work_id TEXT,
          work_epoch INTEGER,
          slot_id TEXT,
          reason_code TEXT NOT NULL,
          retry_budget_kind TEXT,
          termination_outcome TEXT,
          status TEXT NOT NULL CHECK(status IN ('ready','claimed','applied','failed','cancelled')),
          claim_token TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          failure_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          CHECK(
            (target_work_id IS NULL AND work_epoch IS NULL)
            OR (target_work_id IS NOT NULL AND work_epoch IS NOT NULL AND work_epoch>=0)
          )
        );
        INSERT INTO delivery_control_action (
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          retry_budget_kind,termination_outcome,status,claim_token,lease_owner,
          lease_expires_at,failure_code,created_at,updated_at,completed_at,
          attempt_count,max_attempts
        )
        SELECT
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          retry_budget_kind,termination_outcome,status,claim_token,lease_owner,
          lease_expires_at,failure_code,created_at,updated_at,completed_at,
          attempt_count,max_attempts
        FROM delivery_control_action_v82;
        DROP TABLE delivery_control_action_v82;
        CREATE INDEX idx_delivery_control_action_claim
          ON delivery_control_action(run_id,status,created_at);
        CREATE UNIQUE INDEX uq_delivery_control_active_slot
          ON delivery_control_action(run_id,slot_id)
          WHERE slot_id IS NOT NULL
            AND type IN ('activate','continue','retry')
            AND status IN ('claimed','applied');
        CREATE TRIGGER trg_control_action_attempt_bounds_insert
        BEFORE INSERT ON delivery_control_action
        WHEN NEW.attempt_count < 0 OR NEW.max_attempts <= 0
          OR NEW.attempt_count > NEW.max_attempts
        BEGIN
          SELECT RAISE(ABORT,'control_action_attempt_bounds_invalid');
        END;
        CREATE TRIGGER trg_control_action_attempt_bounds_update
        BEFORE UPDATE OF attempt_count,max_attempts ON delivery_control_action
        WHEN NEW.attempt_count < OLD.attempt_count OR NEW.max_attempts <= 0
          OR NEW.attempt_count > NEW.max_attempts
        BEGIN
          SELECT RAISE(ABORT,'control_action_attempt_bounds_invalid');
        END;
        CREATE TRIGGER trg_control_action_lease_shape_insert
        BEFORE INSERT ON delivery_control_action
        WHEN (
          NEW.status='claimed'
          AND (NEW.claim_token IS NULL OR NEW.lease_owner IS NULL OR NEW.lease_expires_at IS NULL)
        ) OR (
          NEW.status<>'claimed'
          AND (NEW.claim_token IS NOT NULL OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL)
        )
        BEGIN
          SELECT RAISE(ABORT,'delivery_control_action_lease_shape_invalid');
        END;
        CREATE TRIGGER trg_control_action_lease_shape_update
        BEFORE UPDATE OF status,claim_token,lease_owner,lease_expires_at
        ON delivery_control_action
        WHEN (
          NEW.status='claimed'
          AND (NEW.claim_token IS NULL OR NEW.lease_owner IS NULL OR NEW.lease_expires_at IS NULL)
        ) OR (
          NEW.status<>'claimed'
          AND (NEW.claim_token IS NOT NULL OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL)
        )
        BEGIN
          SELECT RAISE(ABORT,'delivery_control_action_lease_shape_invalid');
        END;
      `);
    },
  },
  {
    version: 84,
    sql: `
      CREATE TABLE IF NOT EXISTS task_projection_mutex (
        project_path TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)`);

  // Migrations can land from isolated task branches. Checking every recorded
  // version, instead of trusting only MAX(version), keeps a later-numbered
  // migration from permanently masking a lower version merged afterwards.
  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM _schema_version').all() as Array<{ version: number }>)
      .map((row) => row.version),
  );

  for (const migration of [...MIGRATIONS].sort((left, right) => left.version - right.version)) {
    if (!appliedVersions.has(migration.version)) {
      const apply = () => {
        if (migration.sql) db.exec(migration.sql);
        migration.run?.(db);
        db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(migration.version);
      };
      if (!migration.foreignKeysOff) {
        db.transaction(apply)();
        continue;
      }

      const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
      if (foreignKeysEnabled) db.pragma('foreign_keys = OFF');
      try {
        db.transaction(apply)();
      } finally {
        if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
      }
      appliedVersions.add(migration.version);
    }
  }
}
