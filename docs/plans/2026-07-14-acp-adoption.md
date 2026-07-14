# ACP 运行时统一接入 — 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。
> **事实源**：`specs/acp-runtime-integration/spec.md`（团队 spec，权威）。本计划是其 §7 迁移策略的 **TDD 逐步执行细节**，补 `tasks.md`（看板视角）之所缺。二者互补：spec=契约/策略，本计划=怎么一步步落地。
> **重要**：本仓库有活跃 agent 团队并发迁移文档（staged 未提交）。本计划**只编辑、不提交**；提交时机由用户/团队在迁移落定后统一处理。

**Goal:** 一次交付完成 OpenCode/Claude/Codex 三运行时经统一 `AcpBackend`（`@agentclientprotocol/sdk`）接入，验收后删除 bespoke backend，daemon 只剩 ACP 路径。

**Architecture:** 见 spec §4。`AcpBackend`（唯一 `AgentBackend` 实现）用 SDK `ClientSideConnection` 经 stdio JSON-RPC 驱动 agent；OpenCode 原生（`opencode acp`），Claude/Codex 经适配器（`@agentclientprotocol/claude-agent-acp` / `codex-acp`）。Catalog 是启动事实源。权限走统一策略（**不自动授权**）。

**Tech Stack:** TypeScript / Next.js / Vitest；`@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp` + `@agentclientprotocol/codex-acp`（**全部锁版本**）；`node:child_process`。

## Global Constraints（抄自 spec，逐条）

- **一次完整交付**，内部按 spec §7 顺序降回归风险；**每个运行时独立验收通过后才删其 legacy backend**（spec §7.4 / §8）。临时 legacy 不得在规格完成后保留。
- **`AgentBackend` 内部契约不变**；daemon/ContextManager/A2A/编排只依赖它。
- **Catalog 是启动事实源**（spec §5.1）：`delivery: 'native'|'adapter'`、`launcher{command,args,package,version}`、`legacyBackend?`、`verifiedCapabilities`。factory 不再 `switch(engine)`。
- **权限不自动授权**（spec §6）：permission request → 统一策略（允许/拒绝/需确认）；无交互执行只能用预授权策略。**禁止"选第一个 option 静默授权"**。
- **适配器/SDK 锁版本**；能力以握手 + 实测为准，不按运行时名猜。
- 凭据复用现有账号存储，不写进 Catalog/日志/spec。
- TDD：先红后绿；测试 `npx vitest run <file>`，类型 `npx tsc --noEmit`（tsconfig exclude test，靠 vitest）。
- **协议事实**（已核对 SDK 示例）：`new acp.ClientSideConnection(()=>clientImpl, acp.ndJsonStream(input,output))`；`initialize({protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities})`→`newSession({cwd,mcpServers:[]})`→`prompt({sessionId,prompt:[{type:'text',text}]})`；事件经 `clientImpl.sessionUpdate(params)` 回调；`params.update.sessionUpdate ∈ agent_message_chunk/agent_thought_chunk/tool_call/tool_call_update/plan/…`。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `package.json` | 改 | + `@agentclientprotocol/sdk`（+ claude/codex 适配器，Task 6/7 装） |
| `src/server/agent/acp/agentEventMapper.ts`(+test) | 新 | ACP update→AgentEvent（spec §5.3），未知事件安全忽略 |
| `src/server/agent/acp/permissionPolicy.ts`(+test) | 新 | 统一权限策略（允许/拒绝/需确认），**不自动授权** |
| `src/server/agent/acp/mockAcpAgent.ts` | 新 | 测试用 ACP agent（`AgentSideConnection`） |
| `src/server/agent/acp/acpBackend.ts`(+test) | 新 | `AcpBackend implements AgentBackend`（spec §5.2） |
| `src/server/agent/acp/catalog.ts`(+test) | 新 | `AgentCatalogEntry`（spec §5.1）+ loadCatalog + createBackend |
| `src/server/agent/acp/agentCatalog.seed.json` | 新（Task 1 产出） | 三运行时实测 launcher |
| `src/server/daemon.ts` | 改（Task 8） | 按 catalog 路由 AcpBackend；legacy 仅迁移期 |
| `src/server/agent/{claude,opencode,codex}.ts` + `factory.ts` | 删（Task 10，验收后） | bespoke backend |

依赖：T2(map)→T5(backend)；T3(mock)→T5；T4(permission)→T5；T1(probe)→T6/7；T5→T6/7/8。

---

### Task 1: 装 SDK + 探测三运行时 ACP launcher（经验性）

**Files:** `package.json`；`scripts/probe-acp.mjs`（新）；`src/server/agent/acp/agentCatalog.seed.json`（产出）
**Interfaces-Produces:** `agentCatalog.seed.json`（Task 6 catalog 读它）

- [ ] **Step 1: 装 SDK** — `pnpm add @agentclientprotocol/sdk`
- [ ] **Step 2: 写探测脚本 `scripts/probe-acp.mjs`** — 对每个候选 launcher 用 `ClientSideConnection.initialize` 试连，记录成功者：
```javascript
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
const CANDIDATES = [
  { id: "opencode", delivery: "native",   command: "opencode", args: ["acp"] },
  { id: "claude",   delivery: "adapter",  command: "npx", args: ["-y","@agentclientprotocol/claude-agent-acp"] },
  { id: "codex",    delivery: "adapter",  command: "npx", args: ["-y","@agentclientprotocol/codex-acp"] },
];
async function tryOne(c){return new Promise(res=>{let p=spawn(c.command,c.args,{stdio:["pipe","pipe","inherit"]});const cli={async sessionUpdate(){},async requestPermission(){return{outcome:{outcome:"cancelled"}};}};const conn=new acp.ClientSideConnection(()=>cli,acp.ndJsonStream(Writable.toWeb(p.stdin),Readable.toWeb(p.stdout)));let ok=false;conn.initialize({protocolVersion:acp.PROTOCOL_VERSION,clientCapabilities:{}}).then(r=>{ok=true;res({ok:true,...r});p.kill();}).catch(e=>res({ok:false,err:String(e)}));setTimeout(()=>{if(!ok){try{p.kill();}catch{}res({ok:false,err:"timeout"});}},15000);});}
const out=[];for(const c of CANDIDATES){const r=await tryOne(c);out.push({...c,...r});}console.log(JSON.stringify(out,null,2));
```
- [ ] **Step 3: 跑探测** — `node scripts/probe-acp.mjs`（npx 首次拉适配器可能慢，timeout 给足）。**若某运行时 `ok:false` 记录原因**（认证缺失/版本/超时），不阻断其余。
- [ ] **Step 4: 写 seed** — `src/server/agent/acp/agentCatalog.seed.json`，**用实测结果填**（成功的标 launcher+protocolVersion+agentInfo；失败的标 `unsupported:true`+原因）：
```json
[{ "id":"opencode","protocol":"acp","delivery":"native","launcher":{"command":"opencode","args":["acp"]},"verifiedCapabilities":[]},
 { "id":"claude","protocol":"acp","delivery":"adapter","launcher":{"command":"npx","args":["-y","@agentclientprotocol/claude-agent-acp"],"package":"@agentclientprotocol/claude-agent-acp"},"legacyBackend":"claude","verifiedCapabilities":[]},
 { "id":"codex","protocol":"acp","delivery":"adapter","launcher":{"command":"npx","args":["-y","@agentclientprotocol/codex-acp"],"package":"@agentclientprotocol/codex-acp"},"legacyBackend":"codex","verifiedCapabilities":[]}]
```
- [ ] **Step 5: 提交（由用户/团队统一）** — 不自行提交。

---

### Task 2: ACP→AgentEvent 映射器（纯，TDD）

**Files:** `src/server/agent/acp/agentEventMapper.ts`(+test)  **Consumes:** 现有 `AgentEvent`（`src/server/agent/types.ts`，先 Read 对齐字段） **Produces:** `mapAcpUpdate(update): AgentEvent|null`

- [ ] **Step 1: Read `src/server/agent/types.ts`** 确认 `AgentEvent` 各 type 的真实字段名（text/thinking/tool_use/tool_result/plan/error/done），映射对齐之。
- [ ] **Step 2: 写失败测试**（覆盖 spec §5.3 全行 + 未知事件忽略 + plan 映射）：
```typescript
import { describe,it,expect } from "vitest";
import { mapAcpUpdate } from "./agentEventMapper";
describe("mapAcpUpdate",()=>{
  it("agent_message_chunk(text)→text",()=>{expect(mapAcpUpdate({sessionUpdate:"agent_message_chunk",content:{type:"text",text:"hi"}}as any)).toMatchObject({type:"text",text:"hi"});});
  it("agent_thought_chunk→thinking",()=>{expect(mapAcpUpdate({sessionUpdate:"agent_thought_chunk",content:{type:"text",text:"h"}}as any)).toMatchObject({type:"thinking"});});
  it("tool_call→tool_use / tool_call_update→tool_result",()=>{expect(mapAcpUpdate({sessionUpdate:"tool_call",toolCallId:"c1"}as any)).toMatchObject({type:"tool_use",toolCallId:"c1"});expect(mapAcpUpdate({sessionUpdate:"tool_call_update",toolCallId:"c1",status:"completed"}as any)).toMatchObject({type:"tool_result"});});
  it("plan→plan(等价结构)",()=>{expect(mapAcpUpdate({sessionUpdate:"plan"}as any)?.type==="plan"||mapAcpUpdate({sessionUpdate:"plan"}as any)===null).toBe(true);});
  it("未知→null(安全忽略)",()=>{expect(mapAcpUpdate({sessionUpdate:"user_message_chunk"}as any)).toBeNull();expect(mapAcpUpdate({sessionUpdate:"whatever_new"}as any)).toBeNull();});
});
```
- [ ] **Step 3: 跑确认失败** — `npx vitest run src/server/agent/acp/agentEventMapper.test.ts` → FAIL
- [ ] **Step 4: 写实现**（switch sessionUpdate；default 返回 null；plan 按 AgentEvent 有无 plan type 决定映射或 null）
- [ ] **Step 5: 跑通过 + tsc 0 错**

---

### Task 3: Mock ACP agent（测试对打）

**Files:** `src/server/agent/acp/mockAcpAgent.ts`  **Produces:** `npx tsx` 可启的 ACP agent 子进程

- [ ] **Step 1: 写 `mockAcpAgent.ts`**（基于 SDK `agent.ts` 示例；按脚本 emit：text→tool_call(pending)→**触发 request_permission**→tool_call_update(done)→text→`end_turn`；**permission 用以测 Task 4 的权限策略**）
```typescript
#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
class MockAgent implements acp.Agent {
  constructor(private conn: acp.AgentSideConnection) {}
  async initialize(): Promise<acp.InitializeResponse> { return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } }; }
  async newSession(): Promise<acp.NewSessionResponse> { return { sessionId: "mock-1" }; }
  async authenticate(): Promise<acp.AuthenticateResponse> { return {}; }
  async setSessionMode(): Promise<acp.SetSessionModeResponse> { return {}; }
  async cancel(): Promise<void> {}
  async prompt(p: acp.PromptRequest): Promise<acp.PromptResponse> {
    const s = p.sessionId;
    await this.conn.sessionUpdate({ sessionId:s, update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"开始"}}});
    await this.conn.sessionUpdate({ sessionId:s, update:{sessionUpdate:"tool_call",toolCallId:"t1",title:"改文件",kind:"edit",status:"pending"}});
    const perm = await this.conn.requestPermission({ sessionId:s, toolCall:{toolCallId:"t1",title:"改文件",kind:"edit",status:"pending"}, options:[{kind:"allow_once",name:"允许",optionId:"allow"},{kind:"reject_once",name:"拒绝",optionId:"reject"}]});
    await this.conn.sessionUpdate({ sessionId:s, update:{sessionUpdate:"tool_call_update",toolCallId:"t1",status: perm.outcome.outcome==="selected"&&perm.outcome.optionId==="allow"?"completed":"cancelled"}});
    await this.conn.sessionUpdate({ sessionId:s, update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"完成"}}});
    return { stopReason:"end_turn" };
  }
}
new acp.AgentSideConnection((c)=>new MockAgent(c), acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
```
- [ ] **Step 2: 手动冒烟（可选）** — `npx tsx src/server/agent/acp/mockAcpAgent.ts` 阻塞等输入即正常。

---

### Task 4: 权限策略（统一，**不自动授权**）

**Files:** `src/server/agent/acp/permissionPolicy.ts`(+test)  **Produces:** `createPermissionHandler(policy): acp.Client['requestPermission']`

- [ ] **Step 1: 写测试**（spec §6：允许/拒绝/需确认；无交互用预授权；**禁止静默全授权**）
```typescript
import { describe,it,expect } from "vitest";
import { decidePermission } from "./permissionPolicy";
describe("permissionPolicy (spec §6 不自动授权)",()=>{
  it("预授权 allow 列表命中→allow",()=>{expect(decidePermission({toolCall:{kind:"read"}}, {preapproved:["read"],onAsk:()=>"confirm"}).outcome).toBe("allowed");});
  it("未预授权→onAsk 决定(confirm→需用户确认)",()=>{const r=decidePermission({toolCall:{kind:"edit"}},{preapproved:[],onAsk:()=>"confirm"}); expect(r.outcome).toBe("needs_confirmation");});
  it("无 onAsk 且未预授权→reject(不静默授权)",()=>{expect(decidePermission({toolCall:{kind:"edit"}},{preapproved:[]}).outcome).toBe("rejected");});
});
```
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 写实现** — `decidePermission(req,{preapproved,onAsk})`：命中预授权→allowed；否则有 onAsk→needs_confirmation(或其返回)；无 onAsk→**rejected**（绝不默认 allow）。再写 `createPermissionHandler` 把 `decidePermission` 结果映射回 ACP `requestPermission` 的 optionId 选择（allow→选 allow option；reject→选 reject 或 cancelled；needs_confirmation→在无交互上下文降级 reject，有交互则交 UI）。
- [ ] **Step 4: 跑通过 + tsc 0 错**

---

### Task 5: AcpBackend（ClientSideConnection，对打 Mock 集成测试）

**Files:** `src/server/agent/acp/acpBackend.ts`(+test)  **Consumes:** `mapAcpUpdate`(T2)、`createPermissionHandler`(T4)、`AgentBackend`(types)、SDK  **Produces:** `class AcpBackend implements AgentBackend`

- [ ] **Step 1: 写 `acpBackend.ts`**（spec §5.2 全职责）：
```typescript
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { mapAcpUpdate } from "./agentEventMapper";
import { createPermissionHandler, type PermissionPolicy } from "./permissionPolicy";
import type { AgentBackend, AgentEvent, ExecOptions } from "../types";

export interface AcpBackendOpts { command: string; args: string[]; cwd?: string; permission: PermissionPolicy; timeoutMs?: number; }

export class AcpBackend implements AgentBackend {
  constructor(private o: AcpBackendOpts) {}
  async *execute(prompt: string, _opts: ExecOptions): AsyncGenerator<AgentEvent> {
    const proc = spawn(this.o.command, this.o.args, { cwd:this.o.cwd??process.cwd(), stdio:["pipe","pipe","inherit"] });
    const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>);
    const queue: AgentEvent[] = []; let wake:(()=>void)|null=null; let finished=false; let failed:string|null=null;
    const push=(e:AgentEvent|null)=>{if(e){queue.push(e);wake?.();}};
    const client = { async sessionUpdate(p:acp.SessionNotification){push(mapAcpUpdate(p.update as any) as AgentEvent);},
      async requestPermission(p:acp.RequestPermissionRequest){return createPermissionHandler(this.o.permission)(p);} } as unknown as acp.Client;
    const conn = new acp.ClientSideConnection(()=>client, stream);
    const timer = setTimeout(()=>{failed="timeout";proc.kill();}, this.o.timeoutMs ?? 120000);
    try {
      await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }); // 不声明 fs/terminal（spec §6 最小）
      const sess = await conn.newSession({ cwd:this.o.cwd??process.cwd(), mcpServers:[] });
      conn.prompt({ sessionId:sess.sessionId, prompt:[{type:"text",text:prompt}] }).then(()=>{finished=true;wake?.();}).catch(e=>{failed=String(e);wake?.();});
      while (!finished && !failed) { if (queue.length) yield queue.shift()!; else await new Promise<void>(r=>wake=r); }
      while (queue.length) yield queue.shift()!;
      if (failed) yield { type:"error", message:failed } as AgentEvent;
      else yield { type:"done" } as AgentEvent;
    } finally { clearTimeout(timer); try{proc.kill();}catch{} }
  }
}
```
> 先 Read `src/server/agent/types.ts` 对齐 `AgentEvent`/`ExecOptions`/`AgentBackend` 真实字段名。`createPermissionHandler(policy)` 返回符合 `acp.Client.requestPermission` 签名的函数（Task 4 产出）。
- [ ] **Step 2: 写集成测试**（spawn MockAcpAgent 对打；断言事件序列含 permission 走策略而非静默授权）：
```typescript
import { describe,it,expect } from "vitest";
import { join } from "node:path";
import { AcpBackend } from "./acpBackend";
describe("AcpBackend 对打 MockAcpAgent(预授权 read, edit 走 reject)",()=>{
  it("收到 text→tool_use→(permission reject)→tool_result→text→done", async()=>{
    const b = new AcpBackend({ command:"npx", args:["tsx",join(__dirname,"mockAcpAgent.ts")], permission:{preapproved:["read"],onAsk:()=>"reject"} });
    const types:string[]=[]; for await(const e of b.execute("hi",{} as any)) types.push((e as any).type);
    expect(types).toContain("text"); expect(types[types.length-1]).toBe("done");
  },20000);
});
```
- [ ] **Step 3: 跑通过 + tsc 0 错**

---

### Task 6: AgentCatalog + OpenCode 接入 + smoke（native）

**Files:** `src/server/agent/acp/catalog.ts`(+test)  **Consumes:** seed(T1)、`AcpBackend`(T5)

- [ ] **Step 1: 写 `catalog.ts`**（spec §5.1 契约）：
```typescript
import { AcpBackend } from "./acpBackend";
import type { AgentBackend } from "../types";
import type { PermissionPolicy } from "./permissionPolicy";
import seed from "./agentCatalog.seed.json";
export interface AgentCatalogEntry { id:string; protocol:"acp"; delivery:"native"|"adapter"; launcher:{command:string;args:string[];package?:string;version?:string}; legacyBackend?:"opencode"|"claude"|"codex"; verifiedCapabilities:string[]; }
export function loadCatalog(): AgentCatalogEntry[] { return seed as AgentCatalogEntry[]; }
export function createBackend(entry:AgentCatalogEntry, permission:PermissionPolicy, cwd?:string): AgentBackend {
  return new AcpBackend({ command:entry.launcher.command, args:entry.launcher.args, cwd, permission });
}
```
- [ ] **Step 2: 测试** — loadCatalog 返回 seed；createBackend(native)→AcpBackend。
- [ ] **Step 3: OpenCode 真实 smoke**（spec §8）— 脚本驱动 `loadCatalog().find(id==="opencode")`，发"说一句 hello"，断言收到 text+done。**通过则在 seed 标 `verifiedCapabilities` 记录**。

---

### Task 7: Claude + Codex 接入 + smoke（adapter）

**Files:** 复用 catalog；可能需装 `@agentclientprotocol/claude-agent-acp`/`codex-acp`（npx -y 自动拉，或显式 add 锁版本）

- [ ] **Step 1: Claude smoke** — 同 Task 6 Step 3，驱动 claude 条目。**记录认证方式/握手能力/已验证行为**到 seed。若适配器兼容性验收失败，**不删 claude.ts**（保 legacyBackend），记现象。
- [ ] **Step 2: Codex smoke** — 同上驱动 codex 条目。
- [ ] **Step 3: 锁版本** — `pnpm add @agentclientprotocol/claude-agent-acp@<实测版本> @agentclientprotocol/codex-acp@<实测版本>`（spec §5.1 锁版本）。

---

### Task 8: daemon 路由 ACP/legacy（迁移期选择器）

**Files:** `src/server/daemon.ts`（改，54KB——先 grep 定位 `createBackend` 调用点）  **Consumes:** `loadCatalog`/`createBackend`(T6)

- [ ] **Step 1: grep 定位** — `grep -nE "createBackend|new (Claude|OpenCode|Codex)Backend|engine" src/server/daemon.ts`，找到 backend 构造点。
- [ ] **Step 2: 加选择器**（spec §7.3：daemon 经同一选择器路由 ACP/legacy）— 在构造点：catalog 有该 runtime 的 verified ACP 条目 → `createBackend(entry, permission)`；否则走原 legacy factory。**用 feature flag/开关**控制（迁移期）。
- [ ] **Step 3: 端到端** — 经 daemon 实发一次 opencode 任务，确认走 AcpBackend 且事件落库（messageRepo/eventRepo）。
> daemon.ts 大、且属 TASK-006 邻近区域——改前确认未与团队并发改冲突；改动最小化（只加选择器分支）。

---

### Task 9: 三运行时兼容性套件（spec §8 验收）

**Files:** 集成测试 `src/server/agent/acp/<runtime>.compat.test.ts`（每运行时一个，或参数化）

- [ ] 对 OpenCode/Claude/Codex 各覆盖：新会话、可用时恢复、流式文本/thinking、tool 事件、permission(允许/拒绝/确认)、cancel 回收、异常退出/超时、完成 stop reason（spec §8 + checklist §行为）。
- [ ] 每运行时**独立判定通过**；未通过的**保留其 legacy**（spec §7.4）。

---

### Task 10: 删除 bespoke backend（仅三运行时全过后）

**Files:** 删 `src/server/agent/{claude,opencode,codex}.ts`、`factory.ts` 的 switch、手维护 CapabilitySet；`CliBridge` 保留通用化。

- [ ] **前置门禁**：Task 9 三运行时全绿。否则**不执行本任务**（spec §7.4/§8）。
- [ ] 删三个 bespoke backend + factory switch + CapabilitySet；daemon 只剩 `createBackend(catalog entry)`。
- [ ] `npx tsc --noEmit` + 全量 vitest 无回归（除已知 pre-existing）。

---

### Task 11: 文档同步（spec §8）

- [ ] `architecture/cli-integration.md`：factory switch → catalog；三 backend → AcpBackend；bridge 模式 → ACP transport；标注 adapter vs native。
- [ ] `docs/wiki/04-backend-daemon.md`（若存在）同步 ACP 章节。
- [ ] 移除迁移旗标/legacy 残留（spec §8）。

---

## Self-Review

**1. Spec 覆盖**（对 `specs/acp-runtime-integration/spec.md`）：
- §2 事实（native/adapter）→ T1 探测 + seed ✓ ｜ §4 架构 → T5 AcpBackend ✓ ｜ §5.1 Catalog → T6 ✓ ｜ §5.2 AcpBackend 职责 → T5 ✓ ｜ §5.3 映射 → T2 ✓ ｜ §6 权限(不自动授权) → T4 ✓ ｜ §7 迁移(一次交付、验收才删) → T8 选择器+T9 套件+T10 删 ✓ ｜ §8 退出条件 → T9/T10/T11 ✓

**2. Placeholder**：T1 seed args 标"实测填"=经验性产出（脚本跑出），非 TBD；T7/T8/T9 涉及真实 runtime/daemon，给了可执行步骤与门禁，非空泛。✓

**3. 类型一致**：`mapAcpUpdate`(T2)、`PermissionPolicy`(T4)、`AcpBackendOpts`(T5)、`AgentCatalogEntry`(T6) 签名跨任务一致；`AgentEvent` 字段统一标注"先 Read types.ts 对齐"。✓

**4. 与团队 tasks.md 互补**：团队 `tasks.md`=看板高层（基础设施/三 runtime/集成收敛）；本计划=TDD 逐步执行细节 + 门禁 + 文件路径。不重复，互补。

> ⚠️ 本计划**不自行提交**（团队文档迁移 staged 未提交）。每个 Task 完成后由用户/团队统一提交。`docs/plans/` 是团队迁移后的 plan 目录（context-layering plan 已在此）。

---

## 更新 (2026-07-14，参考 OpenClaw 实现)

> 来源：[OpenClaw ACP agents 文档](https://docs.openclaw.ai/zh-CN/tools/acp-agents)。用户 2026-07-14 决策：**权限本期不做**；其余 OpenClaw 模式作参考补入。本节**覆盖**前面相关 Task 的细节。

1. **【覆盖 Task 4】权限：本期搁置（用户决策）**。不建 `permissionPolicy.ts`。`AcpBackend.requestPermission` 用 **auto-approve 占位**——选首个 `allow_*` option（无则 `cancelled`）+ 注释 `TODO: 真实权限策略见 spec §6，后续做 approve-all/deny/confirm profile（参考 OpenClaw permissionMode）`。spec §6"不自动授权"是后续真实策略目标，**本期不实现**。
2. **【加强 Task 1】probe 升级为 `doctor` 健康检查**（参考 OpenClaw `/acp doctor`）：不只一次性 probe，做成可复用——查 runtime 启用否、launcher 能否起、`initialize` 握手健康否、provider 认证否；daemon 启动/运行时可调。seed 仍由它产出。
3. **【加强 Task 5】AcpBackend 进程清理**（参考 OpenClaw 清进程树 + 回收孤儿）：`finally` 里清**整棵进程树**（`npx`→node adapter 是两层，`proc.kill()` 只杀顶层不够——用 `tree-kill` 或 Windows `taskkill /T` / Unix 进程组）；daemon 启动时**回收上次遗留的孤儿 ACP 进程**。
4. **【Task 7 必做】Codex 特殊环境**（参考 OpenClaw）：`codex-acp` 需隔离 `CODEX_HOME`、从主机复制信任项目 + 安全模型/provider 配置——**不能裸 spawn**，否则认证/模型路由不对。
5. **【开放项】model 规范化**（参考 OpenClaw）：model ID 跨 runtime 不通用；ContextManager→ACP 的 model 选择按 runtime 规范化（如 codex 把 `openai/x` 规范化 + `reasoning_effort` 映射）。
6. **【开放项】MCP 桥接**（参考 OpenClaw）：`newSession({mcpServers:[]})` 本期空；后续可把框架 MCP 工具显式桥接给 agent。
7. **【印证，不改】** Catalog/native-vs-adapter、`npx` 首次拉适配器、`session/load` 恢复（claude/codex 均支持）、provider 认证在主机——OpenClaw 与本计划一致，按原 Task 执行。
