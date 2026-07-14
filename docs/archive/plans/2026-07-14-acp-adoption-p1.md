# ACP Adoption P1 Implementation Plan

> 归档状态：superseded（2026-07-14）｜替代规格：`specs/acp-runtime-integration/`。本计划只覆盖 P1，不再作为执行依据。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 证明一个基于官方 `@agentclientprotocol/sdk` 的 `AcpBackend` 能驱动 ACP agent 端到端，并把 ACP `session/update` 映射为框架的 `AgentEvent`——为后续全量替换 bespoke backend（P2/P3）奠基。

**Architecture:** 新建 `src/server/agent/acp/` 模块，自包含、不触碰 `daemon.ts`/现有 backend：`AcpBackend` 用 SDK 的 `ClientSideConnection` 连任意 ACP agent（本地子进程 stdio / 远程 url），`initialize` 握手取能力，`session/prompt` 发消息，`session/update` 回调经 `agentEventMapper` 映射成 `AgentEvent` 流。测试用自建 `MockAcpAgent`（`AgentSideConnection`）做确定性对打。

**Tech Stack:** TypeScript / Next.js / Vitest；`@agentclientprotocol/sdk`（新增）；`node:child_process` spawn（沿用 `CliBridge` 思路）。

## Global Constraints

- **P1 自包含、不碰 `daemon.ts`（54KB）、不删现有 backend、不改全局 `CapabilitySet` 类型**——AcpBackend 自带能力形状；daemon 接线 + 全局 CapabilitySet 重定义 + 删 bespoke 属 P2/P3。
- **`AgentBackend` 接口（`src/server/agent/types.ts`）不改**：`AcpBackend implements AgentBackend`（`execute(prompt, opts) → AsyncGenerator<AgentEvent>`）。如 `AgentBackend` 当前无 `capabilities` getter 则 P1 不强加（P2 再统一）。
- **client 能力最小**：`initialize` 时 `clientCapabilities` 不声明 `fs`/`terminal` → agent 自管文件/终端（行为对齐今天 CLI）；`request_permission` 自动选第一个 option（auto-grant）+ 日志。
- **TDD**：先红后绿，每任务独立可测。
- **测试运行**：`npx vitest run <file>`；类型 `npx tsc --noEmit`（`tsconfig.json:33` exclude test，测试靠 vitest）。
- **历史设计依据**：现已由 `specs/acp-runtime-integration/spec.md` 替代。
- **ACP 协议事实**（已核对 SDK 示例 `client.ts`/`agent.ts`）：`acp.ClientSideConnection((_) => clientImpl, stream)`；`connection.initialize({protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities})` → `connection.newSession({cwd, mcpServers:[]})` → `connection.prompt({sessionId, prompt:[{type:'text',text}]})`；事件经 `clientImpl.sessionUpdate(params)` 回调（`params.update.sessionUpdate` ∈ `agent_message_chunk`/`agent_thought_chunk`/`tool_call`/`tool_call_update`/`plan`/…）；`acp.ndJsonStream(input, output)` 构造传输。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `package.json` | 改 | + `@agentclientprotocol/sdk` |
| `src/server/agent/acp/agentCatalog.seed.json` | 新（Task 1 产出） | Task 1 探测到的各 agent ACP 启动命令 |
| `src/server/agent/acp/agentEventMapper.ts` | 新 | ACP `session/update` → `AgentEvent`（纯函数） |
| `src/server/agent/acp/agentEventMapper.test.ts` | 新 | mapper 单测 |
| `src/server/agent/acp/mockAcpAgent.ts` | 新 | 测试用 ACP agent（`AgentSideConnection`），按脚本 emit 事件 |
| `src/server/agent/acp/acpBackend.ts` | 新 | `AcpBackend implements AgentBackend`（`ClientSideConnection`） |
| `src/server/agent/acp/acpBackend.test.ts` | 新 | 对打 `MockAcpAgent` 的集成测试 |
| `src/server/agent/acp/catalog.ts` | 新 | `AgentCatalogEntry` 类型 + `loadCatalog()` + `createBackend(entry)` |
| `src/server/agent/acp/catalog.test.ts` | 新 | catalog 加载/构造测试 |

依赖顺序：Task 1（探测，产出 seed）→ Task 5（catalog 读 seed）；Task 2（mapper）→ Task 4（backend 用）；Task 3（mock）→ Task 4（测试对打）。Task 2、3 互相独立。

---

### Task 1: 安装 SDK + 探测各 agent 的 ACP 启动命令

**Files:**
- Modify: `package.json`（+ `@agentclientprotocol/sdk`）
- Create: `src/server/agent/acp/agentCatalog.seed.json`（探测产出）
- Create: `scripts/probe-acp.mjs`（探测脚本）

**Interfaces:**
- Produces: `agentCatalog.seed.json`（Task 5 的 `loadCatalog()` 读它）

**说明：** 各 agent 的 ACP 启动 flag 是经验性的，必须实测（不能猜）。本任务跑探测、记录结果。

- [ ] **Step 1: 安装 SDK**

Run: `pnpm add @agentclientprotocol/sdk`（或 `npm i @agentclientprotocol/sdk`）
Expected: `package.json` 出现该依赖，`node_modules/@agentclientprotocol/sdk` 存在。

- [ ] **Step 2: 写探测脚本 `scripts/probe-acp.mjs`**

```javascript
#!/usr/bin/env node
// 探测本地 agent 的 ACP 模式入口。逐个试常见 flag，记录哪个能说 ACP。
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const CANDIDATES = [
  { id: "claude",   command: "claude",   argsCandidates: [["--acp"], ["acp"], ["--mcp"], []] },
  { id: "opencode", command: "opencode", argsCandidates: [["acp"], ["--acp"], ["serve","--acp"], []] },
  { id: "codex",    command: "codex",    argsCandidates: [["--acp"], ["acp"], []] },
];

async function trySpawn(command, args) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    } catch (e) { return resolve({ ok: false, err: String(e) }); }
    const input = Writable.toWeb(p.stdin);
    const output = Readable.toWeb(p.stdout);
    let ok = false;
    const client = { async sessionUpdate(){}, async requestPermission(){return {outcome:{outcome:"cancelled"}};} };
    const stream = acp.ndJsonStream(input, output);
    const conn = new acp.ClientSideConnection(() => client, stream);
    conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
      .then((r) => { ok = true; resolve({ ok: true, protocolVersion: r.protocolVersion, agentInfo: r.agentInfo }); p.kill(); })
      .catch((e) => resolve({ ok: false, err: String(e) }));
    setTimeout(() => { if (!ok) { try{p.kill();}catch{} resolve({ ok: false, err: "timeout" }); } }, 4000);
  });
}

const out = [];
for (const c of CANDIDATES) {
  let winner = null;
  for (const args of c.argsCandidates) {
    const r = await trySpawn(c.command, args);
    if (r.ok) { winner = { args, ...r }; break; }
  }
  out.push({ id: c.id, command: c.command, ...(winner ? { spawn: { command: c.command, args: winner.args }, protocolVersion: winner.protocolVersion } : { unsupported: true }) });
}
console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 3: 跑探测，记录结果**

Run: `node scripts/probe-acp.mjs`
Expected: 打印每个 agent 是否能 initialize 成功 + 成功的启动 args。

把成功项写入 `src/server/agent/acp/agentCatalog.seed.json`（格式如下；**用实测结果填 args，未成功的标 `unsupported:true`**）：

```json
[
  { "id": "claude",   "transport": "local", "spawn": { "command": "claude",   "args": ["<实测flag>"] }, "protocolVersion": 1 },
  { "id": "opencode", "transport": "local", "spawn": { "command": "opencode", "args": ["<实测flag>"] }, "protocolVersion": 1 },
  { "id": "codex",    "transport": "local", "spawn": { "command": "codex",    "args": ["<实测flag>"] }, "protocolVersion": 1 }
]
```

- [ ] **Step 4: 选一个"最干净"的 agent 作为 Task 5 smoke 目标**

在 seed 文件顶部或 commit message 记一句：`"P1 smoke 目标: <id>（initialize 成功且无报错）"`。若全部 unsupported，停下来报告（BLOCKED）——说明本地 agent 版本不支持 ACP，需先升级 agent 或改方案。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml src/server/agent/acp/agentCatalog.seed.json scripts/probe-acp.mjs
git commit -m "chore(acp): 安装 @agentclientprotocol/sdk + 探测各 agent ACP 入口

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ACP → AgentEvent 映射器（纯函数，TDD）

**Files:**
- Create: `src/server/agent/acp/agentEventMapper.ts`
- Test: `src/server/agent/acp/agentEventMapper.test.ts`

**Interfaces:**
- Consumes: 框架现有 `AgentEvent` 类型（`src/server/agent/types.ts`，字段 `type: 'text'|'thinking'|'tool_use'|'tool_result'|'error'|'done'` + 各自 payload）
- Produces: `mapAcpUpdate(update: AcpSessionUpdate): AgentEvent | null`（Task 4 用）

- [ ] **Step 1: 写失败测试 `agentEventMapper.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { mapAcpUpdate } from "./agentEventMapper";

describe("mapAcpUpdate — ACP session/update → AgentEvent", () => {
  it("agent_message_chunk(text) → text", () => {
    const e = mapAcpUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } as any);
    expect(e).toMatchObject({ type: "text", text: "hi" });
  });
  it("agent_thought_chunk → thinking", () => {
    const e = mapAcpUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } } as any);
    expect(e).toMatchObject({ type: "thinking" });
  });
  it("tool_call → tool_use", () => {
    const e = mapAcpUpdate({ sessionUpdate: "tool_call", toolCallId: "c1", title: "read", kind: "read", status: "pending" } as any);
    expect(e).toMatchObject({ type: "tool_use", toolCallId: "c1" });
  });
  it("tool_call_update → tool_result", () => {
    const e = mapAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" } as any);
    expect(e).toMatchObject({ type: "tool_result", toolCallId: "c1" });
  });
  it("plan / 未知类型 → null（P1 忽略）", () => {
    expect(mapAcpUpdate({ sessionUpdate: "plan" } as any)).toBeNull();
    expect(mapAcpUpdate({ sessionUpdate: "user_message_chunk" } as any)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/server/agent/acp/agentEventMapper.test.ts`
Expected: FAIL（`mapAcpUpdate is not defined`）

- [ ] **Step 3: 写实现 `agentEventMapper.ts`**

```typescript
// ACP session/update → 框架 AgentEvent。设计依据: acp-adoption-design.md §6.3
// 未知/未处理类型返回 null（调用方丢弃）。

type AnyUpdate = { sessionUpdate: string;[k: string]: any };

export interface AgentEventLike {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "done";
  [k: string]: any;
}

export function mapAcpUpdate(update: AnyUpdate): AgentEventLike | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return { type: "text", text: update.content?.text ?? "" };
    case "agent_thought_chunk":
      return { type: "thinking", text: update.content?.text ?? "" };
    case "tool_call":
      return { type: "tool_use", toolCallId: update.toolCallId, title: update.title, status: update.status };
    case "tool_call_update":
      return { type: "tool_result", toolCallId: update.toolCallId, status: update.status };
    default:
      return null; // plan / user_message_chunk / mode_change / ... P1 忽略
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/server/agent/acp/agentEventMapper.test.ts`
Expected: PASS（5/5）

- [ ] **Step 5: 类型检查 + 提交**

Run: `npx tsc --noEmit` → 0 错。

```bash
git add src/server/agent/acp/agentEventMapper.ts src/server/agent/acp/agentEventMapper.test.ts
git commit -m "feat(acp): ACP session/update → AgentEvent 映射器

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Mock ACP agent（测试对打用）

**Files:**
- Create: `src/server/agent/acp/mockAcpAgent.ts`

**Interfaces:**
- Produces: 一个可 `npx tsx` 启动的 ACP agent 子进程（Task 4 spawn 它测试）；按固定脚本 emit：text → tool_call → tool_call_update → text → `end_turn`。

- [ ] **Step 1: 写 `mockAcpAgent.ts`（基于 SDK `agent.ts` 示例）**

```typescript
#!/usr/bin/env node
// 测试用 ACP agent：stdin/stdout JSON-RPC，按脚本 emit 事件后 end_turn。
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class MockAgent implements acp.Agent {
  private conn: acp.AgentSideConnection;
  constructor(conn: acp.AgentSideConnection) { this.conn = conn; }
  async initialize(): Promise<acp.InitializeResponse> {
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
  }
  async newSession(): Promise<acp.NewSessionResponse> {
    return { sessionId: "mock-session-1" };
  }
  async authenticate(): Promise<acp.AuthenticateResponse> { return {}; }
  async setSessionMode(): Promise<acp.SetSessionModeResponse> { return {}; }
  async cancel(): Promise<void> {}
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const sid = params.sessionId;
    await this.conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "开始处理" } } });
    await this.conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "读文件", kind: "read", status: "pending" } });
    await this.conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } });
    await this.conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "完成" } } });
    return { stopReason: "end_turn" };
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
new acp.AgentSideConnection((c) => new MockAgent(c), acp.ndJsonStream(input, output));
```

- [ ] **Step 2: 手动冒烟（可选但推荐）—— 用 SDK 示例 client 对打**

Run: `npx tsx src/server/agent/acp/mockAcpAgent.ts`（应阻塞等输入；Ctrl+C 退）。再用 SDK 自带 examples/client.ts 指向它，确认 emit 4 条事件 + end_turn。（若不便，跳过——Task 4 的集成测试会覆盖。）

- [ ] **Step 3: 提交**

```bash
git add src/server/agent/acp/mockAcpAgent.ts
git commit -m "feat(acp): Mock ACP agent（测试对打）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: AcpBackend（ClientSideConnection，对打 Mock 集成测试）

**Files:**
- Create: `src/server/agent/acp/acpBackend.ts`
- Test: `src/server/agent/acp/acpBackend.test.ts`

**Interfaces:**
- Consumes: `mapAcpUpdate`（Task 2）；`AgentBackend` 接口（`src/server/agent/types.ts`）；`@agentclientprotocol/sdk`
- Produces: `class AcpBackend implements AgentBackend`（`execute(prompt, opts) → AsyncGenerator<AgentEvent>`）；构造器接 `{ command, args }`（local spawn）

- [ ] **Step 1: 写实现 `acpBackend.ts`**

```typescript
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { mapAcpUpdate } from "./agentEventMapper";
import type { AgentBackend, AgentEvent, ExecOptions } from "../types";

export interface AcpBackendOpts {
  command: string;
  args: string[];
  cwd?: string;
}

export class AcpBackend implements AgentBackend {
  constructor(private opts: AcpBackendOpts) {}
  async *execute(prompt: string, _opts: ExecOptions): AsyncGenerator<AgentEvent> {
    const proc = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "inherit"],
    });
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
    const queue: AgentEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let finished = false;
    const push = (e: AgentEvent | null) => { if (e) { queue.push(e); resolveWait?.(); } };
    const wake = () => { finished = true; resolveWait?.(); };

    const client: acp.Client = {
      async sessionUpdate(p: acp.SessionNotification) { push(mapAcpUpdate(p.update as any) as AgentEvent); },
      async requestPermission(p: acp.RequestPermissionRequest) {
        // P1 自动选第一个 option（auto-grant）
        return { outcome: { outcome: "selected", optionId: p.options[0]?.optionId ?? "" } };
      },
    } as acp.Client;

    const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(input, output));
    try {
      await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      const session = await conn.newSession({ cwd: this.opts.cwd ?? process.cwd(), mcpServers: [] });
      // 后台跑 prompt，完成时 wake
      conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: prompt }] })
        .then(() => wake())
        .catch((e) => { push({ type: "error", message: String(e) } as AgentEvent); wake(); });

      while (!finished || queue.length) {
        if (queue.length) yield queue.shift()!;
        else await new Promise<void>((r) => (resolveWait = r));
      }
      yield { type: "done" } as AgentEvent;
    } finally {
      try { proc.kill(); } catch {}
    }
  }
}
```

> ⚠️ 若 `src/server/agent/types.ts` 的 `AgentBackend`/`AgentEvent`/`ExecOptions` 形状与上面 import 不完全一致，**以现有 types.ts 为准**调整字段名（先 Read `types.ts` 确认）。`AgentEvent` 的 `error`/`done` 字段名按现有定义对齐。

- [ ] **Step 2: 写集成测试 `acpBackend.test.ts`（spawn MockAcpAgent 对打）**

```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { AcpBackend } from "./acpBackend";

describe("AcpBackend 对打 MockAcpAgent", () => {
  it("驱动 mock agent，收到 text→tool_use→tool_result→text→done", async () => {
    const backend = new AcpBackend({
      // 用 tsx 跑 mockAcpAgent.ts 作为 ACP agent 子进程
      command: "npx",
      args: ["tsx", join(__dirname, "mockAcpAgent.ts")],
    });
    const events: string[] = [];
    for await (const e of backend.execute("hello", {} as any)) {
      events.push((e as any).type);
    }
    expect(events).toEqual(["text", "tool_use", "tool_result", "text", "done"]);
  }, 15000);
});
```

- [ ] **Step 3: 运行，确认通过**

Run: `npx vitest run src/server/agent/acp/acpBackend.test.ts`
Expected: PASS（事件序列 text→tool_use→tool_result→text→done）。若 mock 脚本/字段名有出入，按实测调整（先 Read mockAcpAgent.ts 核对）。

- [ ] **Step 4: 类型检查 + 提交**

Run: `npx tsc --noEmit` → 0 错。

```bash
git add src/server/agent/acp/acpBackend.ts src/server/agent/acp/acpBackend.test.ts
git commit -m "feat(acp): AcpBackend (ClientSideConnection) 对打 mock 端到端打通

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: AgentCatalog + createBackend + 真实 agent smoke

**Files:**
- Create: `src/server/agent/acp/catalog.ts`
- Test: `src/server/agent/acp/catalog.test.ts`

**Interfaces:**
- Consumes: `agentCatalog.seed.json`（Task 1 产出）；`AcpBackend`（Task 4）
- Produces: `AgentCatalogEntry` 类型、`loadCatalog(): AgentCatalogEntry[]`、`createBackend(entry): AgentBackend`

- [ ] **Step 1: 写 `catalog.ts`**

```typescript
import { AcpBackend } from "./acpBackend";
import type { AgentBackend } from "../types";
import seed from "./agentCatalog.seed.json";

export interface AgentCatalogEntry {
  id: string;
  transport: "local" | "remote";
  spawn?: { command: string; args: string[] };
  url?: string;
  cwd?: string;
  protocolVersion?: number;
}

export function loadCatalog(): AgentCatalogEntry[] {
  return seed as AgentCatalogEntry[];
}

export function createBackend(entry: AgentCatalogEntry): AgentBackend {
  if (entry.transport === "local" && entry.spawn) {
    return new AcpBackend({ command: entry.spawn.command, args: entry.spawn.args, cwd: entry.cwd });
  }
  throw new Error(`P1 仅支持 local spawn；remote(${entry.url}) 留 P2`); // remote transport 在 P2
}
```

- [ ] **Step 2: 写测试 `catalog.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { loadCatalog, createBackend } from "./catalog";
import { AcpBackend } from "./acpBackend";

describe("catalog", () => {
  it("loadCatalog 返回 seed 条目", () => {
    const c = loadCatalog();
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((e) => e.id && e.transport)).toBe(true);
  });
  it("createBackend(local) → AcpBackend", () => {
    const b = createBackend({ id: "x", transport: "local", spawn: { command: "echo", args: [] } });
    expect(b).toBeInstanceOf(AcpBackend);
  });
  it("createBackend(remote) → P1 抛错（remote 留 P2）", () => {
    expect(() => createBackend({ id: "r", transport: "remote", url: "http://x" } as any)).toThrow();
  });
});
```

- [ ] **Step 3: 运行 + 类型检查**

Run: `npx vitest run src/server/agent/acp/catalog.test.ts` → PASS；`npx tsc --noEmit` → 0 错。

- [ ] **Step 4: 真实 agent smoke（用 Task 1 选定的目标）**

写一个临时脚本（不提交，或提交为 `scripts/acp-smoke.mjs`）驱动 Task 1 选定的真实 agent：
```javascript
import { loadCatalog, createBackend } from "./src/server/agent/acp/catalog.ts"; // 经 tsx 跑
const entry = loadCatalog().find(e => e.id === "<Task1选定的id>");
const backend = createBackend(entry);
for await (const e of backend.execute("说一句 hello", {})) console.log(e.type);
```
Run: `npx tsx scripts/acp-smoke.mjs`
Expected: 看到真实 agent 经 ACP 回的事件序列（至少 text + done）。**这一步证明 ACP 对真实 runtime 端到端 work——P1 的核心验收。** 失败则记录现象（agent ACP 模式缺什么），不阻断 P1 代码（mock 路径已证明 backend 正确）。

- [ ] **Step 5: 提交**

```bash
git add src/server/agent/acp/catalog.ts src/server/agent/acp/catalog.test.ts [scripts/acp-smoke.mjs]
git commit -m "feat(acp): AgentCatalog + createBackend + 真实 agent smoke

P1 验收: AcpBackend 经 ACP 驱动真实 agent 端到端打通

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**（对照 spec §5–§7）：
- §5 架构（ACP 线，AcpBackend 唯一） → Task 4 AcpBackend ✓；catalog 取代 factory → Task 5 ✓
- §6.2 AcpBackend 流程（initialize/newSession/prompt/映射） → Task 4 ✓
- §6.3 ACP↔AgentEvent 映射 → Task 2 ✓
- §6.5 AgentCatalog → Task 5 ✓
- §7.1 transport local/remote → Task 4(local spawn) ✓；remote 留 P2（Task 5 显式抛错）✓
- §7.2 回调 P1 策略（不声明 fs/terminal；auto-grant） → Task 4 clientCapabilities:{} + requestPermission ✓
- §7.3 mock ACP agent → Task 3 ✓
- §7.4 P1「证明」+ probe → Task 1 ✓

**未覆盖（有意，P2/P3，gated）**：
- daemon 接线（旗标路由到 AcpBackend）→ **P2**（P1 故意不碰 54KB daemon）
- 全局 `CapabilitySet` 重定义（从握手）→ **P2**（P1 AcpBackend 自带能力形状，不动 types.ts）
- 迁移所有 agent + 删 bespoke（claude/opencode/codex.ts + factory switch）→ **P3**
- remote transport（HTTP/WS）→ **P2**

**2. Placeholder scan**：Task 1 的 catalog seed args 标"实测填"——这是**经验性产出**（探测脚本跑出来填），非 TBD 占位；脚本与产出格式都给了。其余步骤完整代码。✓

**3. Type consistency**：`mapAcpUpdate`（Task 2）签名 `(AnyUpdate)=>AgentEvent|null` 与 Task 4 调用 `mapAcpUpdate(p.update)` 一致；`AcpBackendOpts`（Task 4）与 `createBackend`（Task 5）传参 `{command,args,cwd}` 一致；`AgentCatalogEntry`（Task 5）字段与 seed.json（Task 1）一致。`AgentEvent` 字段名标注"以现有 types.ts 为准"，避免与真实定义冲突。✓

---

## P2 / P3 后续（gated，本计划不含）

**P2（集成 + 迁移）**：
- daemon 旗标路由：`engine`/catalog → `createBackend(entry)`；AcpBackend 接入 daemon 的 execute + 持久化。
- 全局 `CapabilitySet` 重定义（从 `initialize` 握手 `agentCapabilities`）；更新 daemon/capabilityRouter 消费方。
- remote transport（HTTP/WS，`acp` SDK 的远程 stream）。
- catalog 补齐所有 agent；逐个验证 ACP 模式覆盖原 bespoke（resume/systemPrompt/permissions/maxTurns/事件完整度——maxTurns 查 `session-config-options.mdx`）。

**P3（删 bespoke）**：
- 删 `claude.ts`/`opencode.ts`/`codex.ts` + factory switch；`CliBridge` 保留通用化；mock backend → mock ACP agent。
- daemon/ContextManager 全程不动。
