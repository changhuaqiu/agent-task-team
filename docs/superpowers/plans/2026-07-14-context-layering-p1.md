# Context Layering P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不触碰在审的 `ContextManager.ts` 的前提下，落地上下文分层 P1 的两个机制——BudgetGuard 的 `tier + importance` 裁剪语义、`scope/private` 可见性过滤——作为向后兼容、独立可测的单元，为 P1.5 接线（TASK-006 收口后）铺路。

**Architecture:** 三个独立任务，各产出一个自包含、可测的交付物。Task 1 把 `BudgetPart` 的 `priority` 升级为 `tier+importance`（priority 作 legacy 自动映射，调用方 `composeWithBudget(parts, budget)` 签名不变 → `ContextManager.ts` 零改动）。Task 2 新建 `ContextRecord` 数据模型 + `filterVisible`（§9 recall 规则）。Task 3 给 `scopeGuard` 加 `assertVisibility` 防御性断言（私有轨迹泄漏的安全网）。三者均不触碰在审文件。

**Tech Stack:** TypeScript（`tsconfig.json`，严格模式）、Vitest、Next.js 16 项目。token 估算沿用 `Math.ceil(len/4)`。

## Global Constraints

- **不触碰在审文件**：`src/lib/agent-context/ContextManager.ts`、`src/lib/agent-context/PromptComposer.ts`、`promptComposer.test.ts`、`src/store/*`——TASK-006 正在 review（retro D4），本计划不改它们。
- **向后兼容**：`composeWithBudget(parts: BudgetPart[], budget: ContextBudget)` 的**签名与返回结构不变**；`BudgetPart` 仅**新增可选字段**（`tier`/`importance`/`scope`/`private`），`priority` 保留为 legacy。
- **`ContextBudget` 不改**：`maxTokens`/`reserveRatio`/`availableTokens()` 维持现状。
- **TDD**：每个任务先写失败测试，再写最小实现，全绿后提交。
- **测试运行**：`npx vitest run <file>`；类型检查 `npx tsc --noEmit`（注意 `tsconfig.json:33` exclude `*.test.ts`，测试正确性靠 vitest 不靠 tsc——retro G2）。
- **设计依据**：`docs/superpowers/specs/2026-07-14-context-layering-design.md` §3（标签）、§8（BudgetGuard 改造）、§9（可见性）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/agent-context/BudgetGuard.ts` | 修改 | `BudgetPart` 加 tier/importance；`composeWithBudget` 改稳定性分层裁剪 |
| `src/lib/agent-context/BudgetGuard.test.ts` | 修改 | 更新 P0 硬上限相关用例为新语义；加 tier+importance 用例 |
| `src/lib/agent-context/contextRecord.ts` | 新建 | `ContextRecord` 类型 + `filterVisible`（可见性过滤） |
| `src/lib/agent-context/contextRecord.test.ts` | 新建 | `filterVisible` 单测 |
| `src/lib/agent-context/scopeGuard.ts` | 修改 | 加 `assertVisibility`（私有泄漏防御断言） |
| `src/lib/agent-context/scopeGuard.test.ts` | 修改 | `assertVisibility` 单测 |

依赖顺序：Task 1（BudgetGuard，独立）‖ Task 2（contextRecord，独立）→ Task 3（scopeGuard 消费 Task 2 的 `ContextRecord`）。Task 1、2 可并行。

---

### Task 1: BudgetGuard — tier + importance 裁剪语义

**Files:**
- Modify: `src/lib/agent-context/BudgetGuard.ts`
- Test: `src/lib/agent-context/BudgetGuard.test.ts`

**Interfaces:**
- Consumes: `ContextBudget`（不变，`availableTokens()`）
- Produces: `BudgetPart`（新增可选 `tier`/`importance`/`scope`/`private`，`priority` 标 deprecated 但保留）、`ContextTier` 类型、`composeWithBudget` 签名不变；`BudgetReport` 新增可选 `systemOverflow`

- [ ] **Step 1: 写失败测试 — 系统层永不裁**

替换 `BudgetGuard.test.ts` 全文为：

```typescript
import { describe, it, expect } from 'vitest';
import { composeWithBudget } from './BudgetGuard';
import { ContextBudget } from './ContextBudget';

describe('BudgetGuard — tier + importance 语义', () => {
  it('系统层（priority 0 → system）永不裁，即使自身超预算', () => {
    const parts = [
      { layer: 'role', content: 'R'.repeat(1000), priority: 0 }, // → system, 250 tokens
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 100, reserveRatio: 0 }),
    );
    expect(prompt).toContain('R'.repeat(1000)); // 不裁
    expect(report.trimmed).not.toContain('role');
    expect(report.systemOverflow).toBe(true); // 但标记溢出
  });

  it('超预算时 project 层先于 system/tool 被裁', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },          // system
      { layer: 'tool', content: 'TOOL', priority: 2 },          // tool
      { layer: 'history', content: 'H'.repeat(500), priority: 4 }, // project
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 20, reserveRatio: 0 }),
    );
    expect(prompt).toContain('ROLE');            // system 保留
    expect(prompt).toContain('TOOL');            // tool 保留（小）
    expect(prompt).not.toContain('H'.repeat(500)); // project 被裁
  });

  it('project 层内按 importance 升序裁剪（低 imp 先丢）', () => {
    const parts = [
      { layer: 'task', content: 'TASK', tier: 'project' as const, importance: 0.8 },
      { layer: 'history', content: 'H'.repeat(500), tier: 'project' as const, importance: 0.3 },
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 40, reserveRatio: 0 }),
    );
    expect(prompt).toContain('TASK');             // 高 imp 保留
    expect(prompt).not.toContain('H'.repeat(500)); // 低 imp 先裁
    expect(report.trimmed).toContain('history');
    expect(report.trimmed).not.toContain('task');
  });

  it('tool 层在 system 之后、project 之前被裁', () => {
    const parts = [
      { layer: 'role', content: 'R', tier: 'system' as const, importance: 0.9 },
      { layer: 'tool', content: 'T'.repeat(200), tier: 'tool' as const, importance: 0.6 },
      { layer: 'task', content: 'TASK', tier: 'project' as const, importance: 0.8 },
    ];
    const { prompt, report } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 30, reserveRatio: 0 }),
    );
    expect(prompt).toContain('R');                  // system 保留（永不裁）
    expect(prompt).toContain('TASK');               // project 高 imp，1 token，预算够 → 保留
    // tool 200 字符=50 tokens > 剩余预算 → 裁
    expect(report.trimmed).toContain('tool');
  });

  it('未超预算时所有层保留（legacy priority 调用方）', () => {
    const parts = [
      { layer: 'role', content: 'ROLE', priority: 0 },
      { layer: 'history', content: 'HIST', priority: 4 },
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 1000, reserveRatio: 0 }),
    );
    expect(prompt).toContain('ROLE');
    expect(prompt).toContain('HIST');
  });

  it('保持原始 parts 呈现顺序（不按 tier 重排输出）', () => {
    const parts = [
      { layer: 'history', content: 'H', tier: 'project' as const, importance: 0.3 },
      { layer: 'role', content: 'R', tier: 'system' as const, importance: 0.9 },
    ];
    const { prompt } = composeWithBudget(
      parts,
      new ContextBudget({ maxTokens: 1000, reserveRatio: 0 }),
    );
    expect(prompt.indexOf('H')).toBeLessThan(prompt.indexOf('R')); // 按 parts 原序
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/agent-context/BudgetGuard.test.ts`
Expected: FAIL（`report.systemOverflow` 为 undefined；旧逻辑 P0 有硬上限会裁 role；新断言不通过）

- [ ] **Step 3: 写最小实现 — 替换 `BudgetGuard.ts` 全文**

```typescript
// src/lib/agent-context/BudgetGuard.ts
import type { ContextBudget } from './ContextBudget';

export type ContextTier = 'system' | 'tool' | 'project';

export interface BudgetPart {
  layer: string;
  content: string;
  /** @deprecated legacy 0=P0(保留)..4=P4(先丢)。无 tier+importance 时自动映射。 */
  priority?: number;
  tier?: ContextTier;
  importance?: number; // 0..1，越大越后裁
  scope?: string;
  private?: boolean;
}

export interface BudgetReport {
  totalTokens: number;
  trimmed: string[];
  /** system 层自身超过可用预算（健康信号，不阻断） */
  systemOverflow?: boolean;
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Ranked {
  part: BudgetPart;
  tier: ContextTier;
  imp: number;
}

/** 把 legacy priority 映射成 tier + importance；有 tier+importance 则直用。 */
function rank(part: BudgetPart): Ranked {
  if (part.tier !== undefined && part.importance !== undefined) {
    return { part, tier: part.tier, imp: part.importance };
  }
  const pr = part.priority ?? 4;
  const tier: ContextTier = pr <= 1 ? 'system' : pr === 2 ? 'tool' : 'project';
  const imp = 1 - pr / 4; // P0→1.0 … P4→0.0
  return { part, tier, imp };
}

// 包含顺序：system → tool → project；同层内高 importance 优先包含（=后裁）
const INCLUDE_ORDER: Record<ContextTier, number> = { system: 0, tool: 1, project: 2 };

export function composeWithBudget(
  parts: BudgetPart[],
  budget: ContextBudget,
): { prompt: string; report: BudgetReport } {
  const available = budget.availableTokens();
  const ranked = parts.map(rank);
  const sorted = [...ranked].sort((a, b) => {
    if (INCLUDE_ORDER[a.tier] !== INCLUDE_ORDER[b.tier]) {
      return INCLUDE_ORDER[a.tier] - INCLUDE_ORDER[b.tier];
    }
    return b.imp - a.imp; // 高 importance 先包含
  });

  const included: BudgetPart[] = [];
  const trimmed: string[] = [];
  let usedTokens = 0;
  let systemOverflow = false;

  for (const r of sorted) {
    const tokens = countTokens(r.part.content);
    if (r.tier === 'system') {
      // 系统层永不裁（spec §8）
      included.push(r.part);
      usedTokens += tokens;
      if (tokens > available) systemOverflow = true;
    } else if (usedTokens + tokens <= available) {
      included.push(r.part);
      usedTokens += tokens;
    } else {
      trimmed.push(r.part.layer);
    }
  }

  // 按原始 parts 顺序组装（不改变呈现顺序）
  const includedSet = new Set(included);
  const ordered = parts.filter((p) => includedSet.has(p));
  const prompt = ordered.map((p) => p.content).join('\n\n---\n\n');

  return { prompt, report: { totalTokens: usedTokens, trimmed, systemOverflow } };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/agent-context/BudgetGuard.test.ts`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 类型检查 + 全量回归**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 错；全量 vitest 绿（确认未破坏 `ContextManager.test.ts` 等调用方——`composeWithBudget` 签名不变，`priority` 仍可传）

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent-context/BudgetGuard.ts src/lib/agent-context/BudgetGuard.test.ts
git commit -m "feat(agent-context): BudgetGuard 改 tier+importance 裁剪语义（priority legacy 兼容）

- BudgetPart 加 tier/importance/scope/private 可选字段，priority 标 deprecated
- composeWithBudget: system 永不裁 → tool → project(按 importance 升序裁)
- BudgetReport 加 systemOverflow 健康信号
- composeWithBudget 签名不变，ContextManager.ts 零改动
- 设计依据: docs/superpowers/specs/2026-07-14-context-layering-design.md §8

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ContextRecord 类型 + filterVisible（可见性过滤）

**Files:**
- Create: `src/lib/agent-context/contextRecord.ts`
- Test: `src/lib/agent-context/contextRecord.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ContextRecord`、`ContextCategory`、`VisibilityCtx`、`filterVisible(records, ctx) → ContextRecord[]`（Task 3 消费 `ContextRecord`/`VisibilityCtx`）

- [ ] **Step 1: 写失败测试 — `contextRecord.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { filterVisible } from './contextRecord';
import type { ContextRecord, VisibilityCtx } from './contextRecord';

const shared = (overrides: Partial<ContextRecord> = {}): ContextRecord => ({
  content: 'x',
  scope: '/project',
  private: false,
  importance: 0.5,
  category: 'decision',
  ...overrides,
});

describe('filterVisible — §9 recall 规则', () => {
  const luigi: VisibilityCtx = { agentId: 'luigi', allowedScopes: ['/project', '/project/luigi'] };
  const mario: VisibilityCtx = { agentId: 'mario', allowedScopes: ['/project', '/project/mario'] };

  it('共享记录（private=false, scope=/project）对所有允许 /project 的 agent 可见', () => {
    const records = [shared({ content: 'goal' })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
    expect(filterVisible(records, mario)).toHaveLength(1);
  });

  it('自己的私有轨迹（source=自己）可见', () => {
    const records = [shared({
      content: 'my trace', scope: '/project/luigi', private: true,
      source: 'luigi', category: 'trajectory', importance: 0.3,
    })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
  });

  it('别人的私有轨迹（source≠自己）不可见——即使 scope 前缀匹配', () => {
    const records = [shared({
      content: 'mario trace', scope: '/project/mario', private: true,
      source: 'mario', category: 'trajectory', importance: 0.3,
    })];
    // luigi 的 allowedScopes 含 /project，/project/mario 前缀匹配 → scopeOk，
    // 但 private=true 且 source=mario≠luigi → 过滤掉
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('scope 不在任何 allowedScope 前缀下 → 不可见', () => {
    const records = [shared({ content: 'x', scope: '/other-project' })];
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('scope 恰等于 allowedScope → 可见', () => {
    const records = [shared({ content: 'x', scope: '/project/luigi', private: false })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
  });

  it('前缀匹配以路径段为单位（/project 不误匹配 /project-x）', () => {
    const records = [shared({ content: 'x', scope: '/project-x' })];
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('空记录列表 → 空', () => {
    expect(filterVisible([], luigi)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/agent-context/contextRecord.test.ts`
Expected: FAIL（`Cannot find module './contextRecord'`）

- [ ] **Step 3: 写最小实现 — `contextRecord.ts`**

```typescript
// src/lib/agent-context/contextRecord.ts
// 上下文记录数据模型 + 可见性过滤。设计依据:
// docs/superpowers/specs/2026-07-14-context-layering-design.md §3, §9

export type ContextCategory =
  | 'identity' | 'protocol' | 'capability' | 'project' | 'kanban'
  | 'roster' | 'norms' | 'task' | 'handoff-goal' | 'trajectory'
  | 'user-input' | 'acceptance' | 'decision' | 'reflection';

export interface ContextRecord {
  content: string;
  /** 层级路径："/project"（共享）或 "/project/<agentId>"（私有） */
  scope: string;
  /** true=仅同源可见（轨迹隔离）；false=共享 */
  private: boolean;
  /** 0..1，裁剪排序键（取代 P0-P4） */
  importance: number;
  category: ContextCategory;
  /** 产生该记录的 agentId，用于隐私过滤；私有记录须带 */
  source?: string;
}

export interface VisibilityCtx {
  agentId: string;
  /** 该 agent 允许看到的 scope 前缀，如 ['/project', '/project/luigi'] */
  allowedScopes: string[];
}

/**
 * §9 recall 过滤规则：一条记录对 agent 可见 ⟺
 *   (scope 以某 allowedScope 为路径段前缀) 且 (private=false 或 source===agentId)
 */
export function filterVisible(
  records: ContextRecord[],
  ctx: VisibilityCtx,
): ContextRecord[] {
  return records.filter((r) => {
    const scopeOk = ctx.allowedScopes.some(
      (s) => r.scope === s || r.scope.startsWith(s + '/'),
    );
    if (!scopeOk) return false;
    if (r.private) return r.source === ctx.agentId;
    return true;
  });
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/agent-context/contextRecord.test.ts`
Expected: PASS（7 个用例全绿）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 错

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent-context/contextRecord.ts src/lib/agent-context/contextRecord.test.ts
git commit -m "feat(agent-context): ContextRecord 数据模型 + filterVisible 可见性过滤

- ContextRecord: scope/private/importance/category/source（CrewAI MemoryRecord 校准）
- filterVisible 落地 §9 recall 规则：scope 路径段前缀 + private 同源
- 轨迹隔离: 别人的 private 记录即使 scope 前缀匹配也不可见
- 设计依据: docs/superpowers/specs/2026-07-14-context-layering-design.md §3, §9

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: scopeGuard — assertVisibility 私有泄漏防御断言

**Files:**
- Modify: `src/lib/agent-context/scopeGuard.ts`
- Test: `src/lib/agent-context/scopeGuard.test.ts`

**Interfaces:**
- Consumes: `ContextRecord`、`VisibilityCtx`（来自 Task 2 `./contextRecord`）
- Produces: `assertVisibility(records, ctx): void`、`VisibilityViolationError`

- [ ] **Step 1: 写失败测试 — 在 `scopeGuard.test.ts` 末尾追加**

```typescript
import { assertVisibility } from './scopeGuard';
import type { ContextRecord, VisibilityCtx } from './contextRecord';

describe('assertVisibility — 私有泄漏防御', () => {
  const luigi: VisibilityCtx = { agentId: 'luigi', allowedScopes: ['/project', '/project/luigi'] };

  const rec = (o: Partial<ContextRecord>): ContextRecord => ({
    content: 'x', scope: '/project', private: false, importance: 0.5, category: 'task', ...o,
  });

  it('全是自己的私有记录 + 共享记录 → 不抛', () => {
    expect(() =>
      assertVisibility(
        [
          rec({ private: true, source: 'luigi', scope: '/project/luigi' }),
          rec({ private: false }),
        ],
        luigi,
      ),
    ).not.toThrow();
  });

  it('混入别人的私有记录 → 抛 private_leak', () => {
    try {
      assertVisibility(
        [rec({ private: true, source: 'mario', scope: '/project/mario' })],
        luigi,
      );
      expect.fail('应抛 private_leak');
    } catch (e) {
      expect((e as any).type).toBe('private_leak');
      expect((e as any).details.agentId).toBe('luigi');
      expect((e as any).details.record.source).toBe('mario');
    }
  });

  it('私有但 source 缺省 → 不抛（无法判定归属，放行给 filterVisible）', () => {
    expect(() => assertVisibility([rec({ private: true, source: undefined })], luigi)).not.toThrow();
  });

  it('空列表 → 不抛', () => {
    expect(() => assertVisibility([], luigi)).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/agent-context/scopeGuard.test.ts`
Expected: FAIL（`assertVisibility is not exported`）

- [ ] **Step 3: 写最小实现 — 在 `scopeGuard.ts` 顶部加 import，文件末尾追加**

顶部 import 区追加：
```typescript
import type { ContextRecord, VisibilityCtx } from './contextRecord';
```

文件末尾追加：
```typescript
/**
 * 私有泄漏防御断言：intake 中不应出现"别人的私有记录"。
 * 与 filterVisible 互补——filterVisible 做软过滤，本函数在 intake 边界硬拦截 wiring bug。
 * 规则：private=true 且 source 已知 且 source≠ctx.agentId → 抛 private_leak。
 */
export interface VisibilityViolationError extends Error {
  type: 'private_leak';
  details: {
    agentId: string;
    record: { scope: string; source?: string };
  };
}

export function assertVisibility(
  records: ContextRecord[],
  ctx: VisibilityCtx,
): void {
  for (const r of records) {
    if (r.private && r.source !== undefined && r.source !== ctx.agentId) {
      const error = new Error(
        `Private leak: record from '${r.source}' (scope=${r.scope}) 进入 '${ctx.agentId}' 的 intake`,
      ) as VisibilityViolationError;
      error.type = 'private_leak';
      error.details = {
        agentId: ctx.agentId,
        record: { scope: r.scope, source: r.source },
      };
      throw error;
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/agent-context/scopeGuard.test.ts`
Expected: PASS（既有 scopeGuard/legacy/filterByProjectId 用例 + 新增 4 个 assertVisibility 用例全绿）

- [ ] **Step 5: 类型检查 + 全量回归**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 错；全量 vitest 绿

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent-context/scopeGuard.ts src/lib/agent-context/scopeGuard.test.ts
git commit -m "feat(agent-context): scopeGuard 加 assertVisibility 私有泄漏防御

- assertVisibility: intake 出现别人的 private 记录 → 抛 private_leak
- 与 filterVisible 互补：软过滤 + 硬断言双层防轨迹泄漏
- 设计依据: docs/superpowers/specs/2026-07-14-context-layering-design.md §9, §12

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**（对照 spec 各节）：
- §3 标签机制 → Task 2 `ContextRecord`（scope/private/importance/category/source）✓
- §8 BudgetGuard 改造 → Task 1（tier+importance、system 永不裁、priority legacy）✓
- §9 可见性矩阵 → Task 2 `filterVisible`（recall 规则）+ Task 3 `assertVisibility`（防御）✓
- §4 "唯一耦合面=Provider / 纯函数" → Task 1 保持 `composeWithBudget` 签名不变，不改 ContextManager ✓
- §11 "立即可做：BudgetGuard 加字段 + history 标签" → Task 1 落字段；**history 标签属接线，归 P1.5**（因触碰 ContextManager.ts，见下）⚠️ 已显式标注

**未覆盖（有意，属 P1.5 / P2， gated）**：
- history 层打 `private=true` 标签 → 需改 `ContextManager.ts:198` 的 push()，TASK-006 在审 → **P1.5**
- ContextManager 的 11 处 push() 从 priority 切到 tier+importance → 同上 → **P1.5**
- §6 getProtocol() + `.ath/PROTOCOLS.md`、§7.2 OUT 泄漏迁移（roleLayer/protocolLayer）→ **P2**（TASK-006 收口后）
- §4 AGENT_ROSTER 直连改 provider（`ContextManager.ts:23`）→ **P2**

**2. Placeholder scan**：无 TBD/TODO；每个代码步骤含完整代码；测试含真实断言。✓

**3. Type consistency**：`ContextRecord`/`VisibilityCtx` 在 Task 2 定义、Task 3 消费，字段名一致（`scope`/`private`/`source`/`agentId`/`allowedScopes`）；`BudgetPart.tier` 类型 `ContextTier` 与 `INCLUDE_ORDER` key 一致；`BudgetReport.systemOverflow` 定义与测试一致。✓

---

## P1.5 / P2 后续（gated，本计划不含）

**P1.5（TASK-006 收口后即可，低风险接线）**：
- `ContextManager.ts` 的 11 处 `push('layer', content, priority)` → 改传 `{tier, importance, scope, private}`；history/userMessage 打 `private=true, scope=/project/<agentId>`；其余按 §7.1 归位表打标。
- 解耦 `ContextManager.ts:23` 的 `AGENT_ROSTER` 直连 → `providers.getRuntimeRoster()`。

**P2（独立 plan，TASK-006 收口后写）**：
- §6 `getProtocol()` provider + `.ath/PROTOCOLS.md`（基础默认 + 项目覆盖合并）；collaborationLayer/behaviorLayer 内容迁出。
- §7.2 OUT 泄漏迁移：roleLayer 的 `if(category===...)` 块 → RoleCard；protocolLayer 看板 schema → orchestrator `getTaskBoardContract()`。
