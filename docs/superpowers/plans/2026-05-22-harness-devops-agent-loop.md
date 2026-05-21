# Harness DevOps Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Harness DevOps Agent Loop standard operational by creating 4 role-specific skills, a DevOps team pack, and the knowledge base layer structure.

**Architecture:** Each DevOps role (BA, Architect, Developer, Tester) gets a dedicated Skill file that defines its AI prompt, knowledge base read layers, and output format. A new `harness-devops` team pack wires the 4 roles together with a state_machine workflow (planning → designing → implementing → testing → done). Knowledge base layers are scaffolded as directories under `docs/knowledge/layers/`.

**Tech Stack:** TypeScript, existing `CreateSkillInput` / `CreateTeamPackInput` interfaces, Zustand stores, SQLite (test DB)

**Spec:** `docs/superpowers/specs/2026-05-21-harness-devops-agent-loop-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/data/presetSkills/prdGeneration.ts` | BA skill — PRD generation with rule-id binding |
| Create | `src/data/presetSkills/architectureDesign.ts` | Architect skill — architecture doc + US + Task decomposition |
| Create | `src/data/presetSkills/devImplement.ts` | Developer skill — code implementation with KB-driven patterns |
| Create | `src/data/presetSkills/testGeneration.ts` | Tester skill — test case generation with traceability matrix |
| Modify | `src/data/presetSkills.ts` | Register 4 new skills in PRESET_SKILLS array |
| Modify | `src/data/presetTeamPacks.ts` | Add `harness-devops` team pack with 4 roles |
| Modify | `src/server/seed-skills.ts` | Auto-assign Harness skills to DevOps role IDs |
| Create | `docs/knowledge/layers/L0-P/README.md` | Personal knowledge layer description |
| Create | `docs/knowledge/layers/L0-T/README.md` | Team conventions layer description |
| Create | `docs/knowledge/layers/L1-tech-wiki/README.md` | Technical wiki layer description |
| Create | `docs/knowledge/layers/L2-biz-wiki/README.md` | Business wiki layer description |
| Create | `docs/knowledge/layers/L3-project/README.md` | Project knowledge layer description |
| Create | `src/__tests__/data/harness-devops.test.ts` | Integration tests for skills + team pack structure |

---

### Task 1: Knowledge Base Layer Structure

**Files:**
- Create: `docs/knowledge/layers/L0-P/README.md`
- Create: `docs/knowledge/layers/L0-T/README.md`
- Create: `docs/knowledge/layers/L1-tech-wiki/README.md`
- Create: `docs/knowledge/layers/L2-biz-wiki/README.md`
- Create: `docs/knowledge/layers/L3-project/README.md`

- [ ] **Step 1: Create layer directories**

```bash
mkdir -p docs/knowledge/layers/{L0-P,L0-T,L1-tech-wiki,L2-biz-wiki,L3-project}
```

- [ ] **Step 2: Create L0-P README**

Write `docs/knowledge/layers/L0-P/README.md`:

```markdown
# Layer 0-P: Personal Knowledge

个人偏好、工作习惯、常用工具配置。

- **持久性**: 跟人走，不随项目迁移
- **贡献者**: 个人维护
- **成熟度**: 无强制要求
- **命名规范**: `{username}/{topic}.md`
- **示例**: IDE 配置偏好、常用 alias、个人调试技巧
```

- [ ] **Step 3: Create L0-T README**

Write `docs/knowledge/layers/L0-T/README.md`:

```markdown
# Layer 0-T: Team Conventions

团队级编码规范、Git 规范、流程规范、命名约定。

- **持久性**: 跨项目共享
- **贡献者**: 全员（pending staging → async merge）
- **知识类型**: guideline, process
- **成熟度**: draft → verified → proven
- **命名规范**: `{type}/{topic}.md`（如 `guideline/api-design.md`）
- **示例**: API 设计规范、Git commit 规范、Code Review 流程
```

- [ ] **Step 4: Create L1-tech-wiki README**

Write `docs/knowledge/layers/L1-tech-wiki/README.md`:

```markdown
# Layer 1: tech-wiki

技术模型、架构决策、技术踩坑记录。

- **持久性**: 跨项目共享
- **贡献者**: 架构师（主要）、开发、测试
- **知识类型**: model, decision, pitfall
- **成熟度**: draft → verified → proven
- **衰减**: proven 12mo → verified 6mo → draft → archive
- **命名规范**: `{type}/{topic}.md`（如 `decision/react-vs-vue.md`、`pitfall/memory-leak-xyz.md`）
- **示例**: 为什么选 React 而非 Vue、某库在特定版本的内存泄漏、用户模型定义
```

- [ ] **Step 5: Create L2-biz-wiki README**

Write `docs/knowledge/layers/L2-biz-wiki/README.md`:

```markdown
# Layer 2: biz-wiki/{domain}

业务模型、业务规则、领域知识。按业务领域组织子目录。

- **持久性**: 跨项目共享
- **贡献者**: BA（主要）、测试
- **知识类型**: model, guideline
- **成熟度**: draft → verified → proven
- **衰减**: proven 12mo → verified 6mo → draft → archive
- **命名规范**: `{domain}/{type}/{topic}.md`（如 `order/model/order-state-machine.md`）
- **示例**: 订单状态机、用户权限模型、支付规则

## 当前领域

（按需创建子目录，如 `order/`、`user/`、`payment/`）
```

- [ ] **Step 6: Create L3-project README**

Write `docs/knowledge/layers/L3-project/README.md`:

```markdown
# Layer 3: Project Knowledge

项目级知识：PRD、User Story、Task、会议纪要、Sprint 记录。

- **持久性**: 项目级，项目结束后归档
- **贡献者**: 全员
- **知识类型**: process
- **成熟度**: draft（项目产出物通常不设成熟度）
- **命名规范**: `{sprint}/{type}/{topic}.md`（如 `sprint-12/prd/user-login.md`）
- **示例**: Sprint 12 PRD、架构设计文档、会议纪要

## 追溯链

每个 PRD 条目携带唯一 rule-id，贯穿 US → Task → Test Case:

PRD 条目 ──rule-id──→ US ──rule-id──→ Task ──rule-id──→ Test Case
```

- [ ] **Step 7: Commit**

```bash
git add docs/knowledge/layers/
git commit -m "feat(kb): scaffold 5-layer knowledge base directory structure"
```

---

### Task 2: BA Skill — prd-generation

**Files:**
- Create: `src/data/presetSkills/prdGeneration.ts`

- [ ] **Step 1: Create the skill file**

Write `src/data/presetSkills/prdGeneration.ts`:

```typescript
import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const PRD_GENERATION_SKILL: CreateSkillInput = {
  name: 'prd-generation',
  description: 'BA 需求分析：基于业务规则生成 PRD，绑定 rule-id 和验收标准',
  content: `# PRD Generation Skill

## 角色定位
你是 BA 的 AI 助手。BA 是需求分析的主体，你辅助生成和打磨 PRD 文档。

## 知识库读取
- **L2 biz-wiki**: 读取 model（业务模型）和 guideline（业务规则），确保 PRD 符合现有业务规则
- **L0-T**: 读取 process（PRD 模板和流程规范），确保 PRD 格式符合团队标准

## 工作流程

### 1. 接收需求
BA 下达业务需求后，先从 L2 biz-wiki 查询相关的业务模型和规则。

### 2. 生成 PRD 草稿
基于业务规则和模型，按以下结构生成 PRD：

\`\`\`markdown
# PRD: {需求标题}

## 背景
{业务背景说明}

## 需求条目

### REQ-{id}: {条目标题}

- **rule-id**: `{domain}-{seq}`（如 order-001）
- **描述**: {具体需求描述}
- **验收标准**:
  1. {可验证的标准 1}
  2. {可验证的标准 2}
- **关联业务规则**: {引用 L2 biz-wiki 中的规则}

### REQ-{id}: {下一条目}
...
\`\`\`

### 3. 审阅循环
BA 审阅 PRD 草稿后：
- **不满意**: BA 提出修改意见，你基于反馈修正后重新生成
- **满意**: BA 确认，PRD 交接给架构师

## 规则
- 每个需求条目必须携带唯一 rule-id
- 每个需求条目必须有至少 2 条可验证的验收标准
- 验收标准必须具体到可以判断 pass/fail
- 关联业务规则时引用 L2 biz-wiki 中的具体条目
- 不确定的内容标注 [待确认]，由 BA 补充
- 不要凭空编造业务规则，未在 L2 biz-wiki 中找到的规则需向 BA 确认

## 输出
- PRD 文档（含 rule-id + 验收标准）`,
  isPreset: true,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetSkills/prdGeneration.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetSkills/prdGeneration.ts
git commit -m "feat(skill): add BA prd-generation skill with KB-driven PRD workflow"
```

---

### Task 3: Architect Skill — architecture-design

**Files:**
- Create: `src/data/presetSkills/architectureDesign.ts`

- [ ] **Step 1: Create the skill file**

Write `src/data/presetSkills/architectureDesign.ts`:

```typescript
import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const ARCHITECTURE_DESIGN_SKILL: CreateSkillInput = {
  name: 'architecture-design',
  description: '架构师设计：读 PRD 设计架构文档，拆解 US 和 Task，关联 rule-id',
  content: `# Architecture Design Skill

## 角色定位
你是架构师的 AI 助手。架构师是设计的主体，你辅助生成架构文档、User Story 和 Task 拆解。

## 知识库读取
- **L3 PRD**: 读取 PRD 文档（process），理解需求条目和验收标准
- **L1 tech-wiki**: 读取 model（技术模型）、decision（历史架构决策）、pitfall（技术踩坑），避免重复踩坑
- **L2 biz-wiki**: 读取 model（业务模型），辅助架构设计对齐业务

## 工作流程

### 1. 分析 PRD
从 L3 读取 PRD，逐条分析需求条目和验收标准。

### 2. 查询技术上下文
从 L1 tech-wiki 查询：
- 现有技术模型是否可复用
- 历史架构决策是否适用
- 已知技术踩坑需要规避

### 3. 生成架构文档

\`\`\`markdown
# 架构设计: {标题}

## 概述
{架构概述}

## 架构决策
- **AD-{id}**: {决策描述}
  - 原因: {为什么这样决策}
  - 替代方案: {考虑过的其他方案}
  - 影响: {对系统的影响}

## 模块划分
{模块说明 + 模块间依赖关系}

## 关联 PRD 条目
| PRD 条目 | rule-id | 涉及模块 |
|---------|---------|---------|
| REQ-{id} | {rule-id} | {模块} |
\`\`\`

### 4. 拆解 User Story

\`\`\`markdown
## US-{id}: {User Story 标题}

**作为** {角色}，**我想要** {功能}，**以便** {价值}

- **关联 PRD**: REQ-{id}（rule-id: {rule-id}）
- **验收标准**:
  1. {从 PRD 验收标准继承 + 补充技术维度}
- **技术要点**: {实现时需要注意的技术点}
\`\`\`

### 5. 拆解 Task

\`\`\`markdown
## TASK-{id}: {Task 标题}

- **关联 US**: US-{id}
- **关联 PRD**: REQ-{id}（rule-id: {rule-id}）
- **类型**: {实现 | 配置 | 数据库 | 接口 | 测试}
- **描述**: {具体做什么}
- **预估复杂度**: {S | M | L}
- **依赖**: {依赖的其他 Task}
\`\`\`

### 6. 审阅循环
架构师审阅后：
- **不满意**: 提出修改意见，修正架构/US/Task
- **满意**: 确认后交接给开发

## 规则
- 每个 US 必须关联至少一个 PRD 条目（通过 rule-id）
- 每个 Task 必须关联至少一个 US（通过 rule-id 贯穿）
- Task 拆解粒度：S（半天）、M（1-2天）、L（3-5天），超过 L 需继续拆分
- 架构决策必须说明原因和替代方案
- 引用 L1 tech-wiki 中的历史决策时标注出处
- 发现 L1 中没有覆盖的新技术点时，标注 [需回写 L1]

## 输出
- 架构文档
- User Story 列表（含 rule-id）
- Task 列表（含 rule-id）`,
  isPreset: true,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetSkills/architectureDesign.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetSkills/architectureDesign.ts
git commit -m "feat(skill): add architect architecture-design skill with US+Task decomposition"
```

---

### Task 4: Developer Skill — dev-implement

**Files:**
- Create: `src/data/presetSkills/devImplement.ts`

- [ ] **Step 1: Create the skill file**

Write `src/data/presetSkills/devImplement.ts`:

```typescript
import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const DEV_IMPLEMENT_SKILL: CreateSkillInput = {
  name: 'dev-implement',
  description: '开发实现：按 Task 编码实现，参考团队规范和技术模型，输出代码+单测',
  content: `# Dev Implement Skill

## 角色定位
你是开发的 AI 助手。开发是编码的主体，你辅助实现代码、编写单测、关联 Task。

## 知识库读取
- **L3 Tasks**: 读取 Task 列表（process），理解要实现的具体内容
- **L0-T**: 读取 guideline（团队编码规范），确保代码符合团队标准
- **L1 tech-wiki**: 读取 model（技术模型）和 pitfall（踩坑记录），避免重复踩坑

## 工作流程

### 1. 领取 Task
从 L3 读取分配的 Task，理解关联的 US 和 PRD 条目。

### 2. 查询技术上下文
从 L1 tech-wiki 查询：
- 相关技术模型（数据结构、API 设计模式等）
- 已知踩坑（某个库的特定版本问题等）

从 L0-T 查询：
- 编码规范（命名、目录结构、错误处理等）

### 3. 编码实现
按 Task 描述实现代码，遵循：
- L0-T 中的团队编码规范
- L1 中的技术模型定义
- 规避 L1 中记录的已知踩坑

### 4. 编写单测
为实现的代码编写单元测试：
- 覆盖正常路径和边界条件
- 测试名称描述期望行为
- 引用 Task 的验收标准

### 5. 关联追溯
代码提交信息中关联 Task + US + PRD：

\`\`\`
feat: {简要描述}

Task: TASK-{id}
US: US-{id}
PRD: REQ-{id} (rule-id: {rule-id})
\`\`\`

### 6. Code Review 循环
开发审阅后：
- **不满意**: 提出修改意见，修正代码
- **满意**: 确认后交接给测试

## 规则
- 代码必须符合 L0-T 中定义的团队编码规范
- 发现 L1 中没有记录的新踩坑时，标注 [需回写 L1 pitfall]
- 发现 L0-T 中没有覆盖的新规范时，标注 [需回写 L0-T guideline]
- 每个函数/方法必须有明确的职责
- 不引入不必要的抽象，YAGNI 原则
- 安全：不引入注入、XSS、敏感数据泄露等 OWASP Top 10 漏洞

## 输出
- 代码实现
- 单元测试
- Task 覆盖报告`,
  isPreset: true,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetSkills/devImplement.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetSkills/devImplement.ts
git commit -m "feat(skill): add developer dev-implement skill with KB-driven coding workflow"
```

---

### Task 5: Tester Skill — test-generation

**Files:**
- Create: `src/data/presetSkills/testGeneration.ts`

- [ ] **Step 1: Create the skill file**

Write `src/data/presetSkills/testGeneration.ts`:

```typescript
import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TEST_GENERATION_SKILL: CreateSkillInput = {
  name: 'test-generation',
  description: '测试验证：基于 US+Task 编写测试用例，执行测试，生成追溯矩阵和缺陷反馈',
  content: `# Test Generation Skill

## 角色定位
你是测试的 AI 助手。测试是验证的主体，你辅助编写测试用例、执行测试、生成追溯矩阵。

## 知识库读取
- **L3 PRD+US+Task**: 读取完整的交付物链（process），理解需求→设计→实现的完整上下文
- **L2 biz-wiki**: 读取 model（业务模型），辅助验证业务逻辑正确性
- **L1 tech-wiki**: 读取 pitfall（技术踩坑），针对性设计边界测试

## 工作流程

### 1. 接收交付物
从 L3 读取 PRD + US + Task，理解完整的需求到实现链路。

### 2. 查询业务上下文
从 L2 biz-wiki 查询业务模型，确保测试覆盖关键业务规则。

从 L1 tech-wiki 查询已知踩坑，针对性地设计回归测试。

### 3. 编写测试用例

\`\`\`markdown
## TC-{id}: {测试用例标题}

- **关联 US**: US-{id}
- **关联 Task**: TASK-{id}
- **关联 PRD**: REQ-{id}（rule-id: {rule-id}）
- **类型**: {功能测试 | 边界测试 | 异常测试 | 回归测试}
- **前置条件**: {测试前需要准备什么}
- **步骤**:
  1. {操作步骤}
  2. {操作步骤}
- **预期结果**: {期望的输出/状态}
- **优先级**: {P0 | P1 | P2}
\`\`\`

### 4. 生成追溯矩阵

\`\`\`markdown
## 追溯矩阵

| PRD 条目 | rule-id | US | Task | Test Case | 状态 |
|---------|---------|-----|------|-----------|------|
| REQ-001 | order-001 | US-001 | TASK-001 | TC-001, TC-002 | ✅ 通过 |
| REQ-002 | order-002 | US-002 | TASK-003 | TC-003 | ❌ 失败 |
\`\`\`

### 5. 执行测试 + 缺陷反馈
执行测试用例，记录结果：
- **通过**: 在追溯矩阵中标记 ✅
- **失败**: 生成缺陷反馈，指定回流路径：
  - 实现问题 → 回流到开发
  - 设计问题 → 回流到架构师
  - 需求歧义 → 回流到 BA

### 6. 审阅循环
测试审阅后：
- **不满意**: 提出修改意见，修正测试用例
- **满意**: 确认测试通过

## 规则
- 每个 US 至少覆盖 2 个测试用例（正常路径 + 边界）
- 每个 PRD 条目必须在追溯矩阵中有对应行
- 缺陷反馈必须指明回流路径（开发/架构师/BA）
- 引用 L1 pitfall 中的已知问题时标注出处
- 发现新的踩坑时，标注 [需回写 L1 pitfall]
- AI 辅助生成覆盖报告，人决定如何处理遗漏

## 输出
- 测试用例列表（含 rule-id）
- 测试执行结果
- 追溯矩阵
- 缺陷反馈（如有）`,
  isPreset: true,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetSkills/testGeneration.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetSkills/testGeneration.ts
git commit -m "feat(skill): add tester test-generation skill with traceability matrix"
```

---

### Task 6: Register Skills in PRESET_SKILLS

**Files:**
- Modify: `src/data/presetSkills.ts`

- [ ] **Step 1: Add imports for new skills**

At the top of `src/data/presetSkills.ts`, add after existing imports:

```typescript
import { PRD_GENERATION_SKILL } from './presetSkills/prdGeneration';
import { ARCHITECTURE_DESIGN_SKILL } from './presetSkills/architectureDesign';
import { DEV_IMPLEMENT_SKILL } from './presetSkills/devImplement';
import { TEST_GENERATION_SKILL } from './presetSkills/testGeneration';
```

- [ ] **Step 2: Add skills to PRESET_SKILLS array**

At the end of the `PRESET_SKILLS` array (before the closing `];`), add:

```typescript
  PRD_GENERATION_SKILL,
  ARCHITECTURE_DESIGN_SKILL,
  DEV_IMPLEMENT_SKILL,
  TEST_GENERATION_SKILL,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetSkills.ts
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/data/presetSkills.ts
git commit -m "feat(skills): register 4 Harness DevOps skills in PRESET_SKILLS array"
```

---

### Task 7: Harness DevOps Team Pack

**Files:**
- Modify: `src/data/presetTeamPacks.ts`

- [ ] **Step 1: Add the harness-devops team pack**

At the end of the `PRESET_TEAM_PACKS` array in `src/data/presetTeamPacks.ts`, add:

```typescript
{
    name: 'harness-devops',
    displayName: 'Harness DevOps Team',
    description: 'BA→架构师→开发→测试 Agent Loop 团队标准，基于 Harness Engineering 知识库驱动',
    version: '1.0.0',
    tags: ['devops', 'harness', 'agent-loop'],
    category: 'engineering',
    roles: [
      {
        id: 'ba',
        displayName: 'BA',
        soul: `# BA — 需求分析

你是 BA，负责需求分析和 PRD 文档输出。

## GitNexus Graph-First Protocol
- For any non-trivial code, architecture, review, or testing task, use GitNexus before editing or judging code.
- Before modifying code, inspect the relevant context or impact.
- Review and QA must use GitNexus impact or change detection evidence before approving.

## 职责
- 需求分析 → 输出 PRD
- 使用 prd-generation Skill
- 读取 L2 biz-wiki (model, guideline) + L0-T (process)
- PRD 回写 L3 project

## Agent Loop
1. 👤 人下达需求 → 你调用 prd-generation Skill
2. 🤖 AI 基于业务规则生成 PRD 草稿
3. 👤 人审阅 PRD
4. OK? → YES: 输出 PRD，交接架构师 / NO: 修正后重新生成

## 交接
确认 PRD 后，交接给架构师（👤→👤）。人确认后才交接。`,
        required: true,
        description: '需求分析，PRD 文档输出',
        skillIds: ['prd-generation'],
      },
      {
        id: 'architect',
        displayName: '架构师',
        soul: `# 架构师 — 架构设计 + US/Task 拆解

你是架构师，负责读 PRD → 设计架构文档 → 拆解 US → 拆解 Task。

## GitNexus Graph-First Protocol
- For any non-trivial code, architecture, review, or testing task, use GitNexus before editing or judging code.
- Before modifying code, inspect the relevant context or impact.
- Review and QA must use GitNexus impact or change detection evidence before approving.

## 职责
- 读 PRD → 设计架构文档
- 拆解 User Stories
- 拆解 Tasks
- 使用 architecture-design Skill
- 读取 L3 PRD + L1 tech (model, decision, pitfall) + L2 biz (model)
- 架构决策回写 L1 tech-wiki

## Agent Loop
1. 👤 人下达任务 → 你调用 architecture-design Skill
2. 🤖 AI 基于技术上下文生成架构+US+Task
3. 👤 人审阅架构+US+Task
4. OK? → YES: 输出，交接开发 / NO: 修正后重新生成

## 交接
确认后，交接给开发（👤→👤）。人确认后才交接。`,
        required: true,
        description: '架构设计，US 和 Task 拆解',
        skillIds: ['architecture-design'],
      },
      {
        id: 'developer',
        displayName: '开发',
        soul: `# 开发 — 编码实现

你是开发，负责读 Task → 编码实现 → 自测。

## GitNexus Graph-First Protocol
- For any non-trivial code, architecture, review, or testing task, use GitNexus before editing or judging code.
- Before modifying code, inspect the relevant context or impact.
- Review and QA must use GitNexus impact or change detection evidence before approving.

## 职责
- 读 Task → 编码实现
- 编写单测
- 使用 dev-implement Skill
- 读取 L3 Tasks + L0-T (guideline) + L1 tech (model, pitfall)
- 踩坑回写 L1 tech + 新规范回写 L0-T

## Agent Loop
1. 👤 人领 Task → 你调用 dev-implement Skill
2. 🤖 AI 基于技术模型和规范生成代码
3. 👤 人 Code Review
4. OK? → YES: 输出代码+单测，交接测试 / NO: 修正后重新实现

## 交接
确认后，交接给测试（👤→👤）。人确认后才交接。`,
        required: true,
        description: '按 Task 编码实现 + 单测',
        skillIds: ['dev-implement'],
      },
      {
        id: 'tester',
        displayName: '测试',
        soul: `# 测试 — 测试验证

你是测试，负责读 US+Task → 编写测试用例 → 执行测试 → 缺陷反馈。

## GitNexus Graph-First Protocol
- For any non-trivial code, architecture, review, or testing task, use GitNexus before editing or judging code.
- Before modifying code, inspect the relevant context or impact.
- Review and QA must use GitNexus impact or change detection evidence before approving.

## 职责
- 读 US+Task → 编写测试用例
- 执行测试 → 生成追溯矩阵
- 缺陷反馈（回流到开发/架构师/BA）
- 使用 test-generation Skill
- 读取 L3 PRD+US+Task + L2 biz (model) + L1 (pitfall)
- 踩坑回写 L1 tech + 验证规则回写 L2 biz

## Agent Loop
1. 👤 人领 Task → 你调用 test-generation Skill
2. 🤖 AI 基于业务模型和历史踩坑生成测试用例
3. 👤 人审阅测试结果
4. OK? → YES: 输出测试报告 / NO: 修正后重新测试

## 跨角色反馈
发现缺陷时，按类型回流：
- 实现问题 → 开发
- 设计问题 → 架构师
- 需求歧义 → BA

## 交接
人确认后才交接。`,
        required: true,
        description: '测试用例编写、执行、追溯矩阵、缺陷反馈',
        skillIds: ['test-generation'],
      },
    ],
    teamMode: 'pipeline',
    workflow: {
      type: 'state_machine',
      states: [
        {
          name: 'planning',
          description: 'BA 分析需求，生成 PRD 文档，绑定 rule-id 和验收标准',
          roles: ['ba'],
          transitions: [{ to: 'designing', condition: 'PRD 确认完成' }],
        },
        {
          name: 'designing',
          description: '架构师设计架构文档，拆解 US 和 Task，关联 PRD rule-id',
          roles: ['architect'],
          transitions: [{ to: 'implementing', condition: '架构+US+Task 确认完成' }],
        },
        {
          name: 'implementing',
          description: '开发按 Task 编码实现 + 单测，代码关联 Task+US+PRD',
          roles: ['developer'],
          transitions: [{ to: 'testing', condition: '代码+单测确认完成' }],
        },
        {
          name: 'testing',
          description: '测试基于 US+Task 编写测试用例，执行测试，生成追溯矩阵',
          roles: ['tester'],
          transitions: [
            { to: 'done', condition: '测试全部通过' },
            { to: 'implementing', condition: '发现实现缺陷，回流开发' },
            { to: 'designing', condition: '发现设计问题，回流架构师' },
            { to: 'planning', condition: '发现需求歧义，回流BA' },
          ],
        },
        {
          name: 'done',
          description: '交付完成，Sprint 回顾时提取知识回写 KB',
          roles: [],
          transitions: [],
        },
      ],
    },
    communicationMatrix: {
      ba: {
        canSendTo: ['architect'],
        canReceiveFrom: ['architect', 'tester'],
        canEscalateTo: [],
      },
      architect: {
        canSendTo: ['developer', 'ba'],
        canReceiveFrom: ['ba', 'developer', 'tester'],
        canEscalateTo: [],
      },
      developer: {
        canSendTo: ['tester', 'architect'],
        canReceiveFrom: ['architect', 'tester'],
        canEscalateTo: [],
      },
      tester: {
        canSendTo: ['developer', 'architect', 'ba'],
        canReceiveFrom: ['developer'],
        canEscalateTo: [],
      },
    },
    rules: {
      maxIterations: 3,
      requireEvidence: true,
      autoAssign: true,
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/data/presetTeamPacks.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetTeamPacks.ts
git commit -m "feat(team-pack): add harness-devops team pack with BA/Architect/Dev/Tester roles"
```

---

### Task 8: Update Seed Script for Skill Assignments

**Files:**
- Modify: `src/server/seed-skills.ts`

- [ ] **Step 1: Read current seed-skills.ts**

Read `src/server/seed-skills.ts` to find the section that auto-assigns skills to agent IDs. Currently it assigns `git-collaboration` to all 12 agent IDs and `task-management` to `mario`.

- [ ] **Step 2: Add Harness DevOps skill assignments**

After the existing assignment block, add assignments for the Harness DevOps roles:

```typescript
// Harness DevOps skill assignments
const harnessRoleSkills: Record<string, string[]> = {
  ba: ['prd-generation'],
  architect: ['architecture-design'],
  developer: ['dev-implement'],
  tester: ['test-generation'],
};

for (const [roleId, skillNames] of Object.entries(harnessRoleSkills)) {
  for (const skillName of skillNames) {
    const skill = await skillRepo.getByName(skillName);
    if (skill) {
      await skillRepo.assignSkillToAgent(skill.id, roleId);
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/server/seed-skills.ts
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/seed-skills.ts
git commit -m "feat(seed): auto-assign Harness DevOps skills to role IDs"
```

---

### Task 9: Integration Test for Skills + Team Pack

**Files:**
- Create: `src/__tests__/data/harness-devops.test.ts`

- [ ] **Step 1: Write the test file**

Write `src/__tests__/data/harness-devops.test.ts`:

```typescript
import { PRESET_SKILLS } from '@/data/presetSkills';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

describe('Harness DevOps Skills', () => {
  const skillNames = [
    'prd-generation',
    'architecture-design',
    'dev-implement',
    'test-generation',
  ];

  it('registers all 4 Harness DevOps skills in PRESET_SKILLS', () => {
    for (const name of skillNames) {
      const skill = PRESET_SKILLS.find((s) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill!.isPreset).toBe(true);
    }
  });

  it('each skill has content with KB layer references and Agent Loop steps', () => {
    const contentChecks: Record<string, string[]> = {
      'prd-generation': ['L2 biz-wiki', 'L0-T', 'rule-id', '验收标准', 'Agent Loop'],
      'architecture-design': ['L3 PRD', 'L1 tech-wiki', 'rule-id', 'User Story', 'Task'],
      'dev-implement': ['L3 Tasks', 'L0-T', 'L1 tech-wiki', '单测', 'Code Review'],
      'test-generation': ['L3 PRD+US+Task', 'L2 biz', 'L1', '追溯矩阵', 'rule-id'],
    };

    for (const [name, checks] of Object.entries(contentChecks)) {
      const skill = PRESET_SKILLS.find((s) => s.name === name)!;
      for (const check of checks) {
        expect(skill.content).toContain(check);
      }
    }
  });
});

describe('Harness DevOps Team Pack', () => {
  const pack = PRESET_TEAM_PACKS.find((p) => p.name === 'harness-devops');

  it('exists in PRESET_TEAM_PACKS', () => {
    expect(pack).toBeDefined();
    expect(pack!.displayName).toBe('Harness DevOps Team');
  });

  it('has exactly 4 required roles: ba, architect, developer, tester', () => {
    const roleIds = pack!.roles.map((r) => r.id).sort();
    expect(roleIds).toEqual(['architect', 'ba', 'developer', 'tester']);
    expect(pack!.roles.every((r) => r.required)).toBe(true);
  });

  it('each role references GitNexus Graph-First Protocol', () => {
    for (const role of pack!.roles) {
      expect(role.soul).toContain('GitNexus Graph-First Protocol');
    }
  });

  it('each role has the correct skill assignment', () => {
    const skillMap: Record<string, string> = {
      ba: 'prd-generation',
      architect: 'architecture-design',
      developer: 'dev-implement',
      tester: 'test-generation',
    };

    for (const [roleId, skillId] of Object.entries(skillMap)) {
      const role = pack!.roles.find((r) => r.id === roleId)!;
      expect(role.skillIds).toContain(skillId);
    }
  });

  it('uses state_machine workflow with correct stage order', () => {
    expect(pack!.workflow.type).toBe('state_machine');
    const states = pack!.workflow.states!;
    const stateNames = states.map((s) => s.name);
    expect(stateNames).toEqual(['planning', 'designing', 'implementing', 'testing', 'done']);
  });

  it('testing state can transition back to earlier stages for feedback', () => {
    const testingState = pack!.workflow.states!.find((s) => s.name === 'testing')!;
    const targets = testingState.transitions!.map((t) => t.to);
    expect(targets).toContain('done');
    expect(targets).toContain('implementing');
    expect(targets).toContain('designing');
    expect(targets).toContain('planning');
  });

  it('communication matrix allows tester to feedback to all upstream roles', () => {
    const { communicationMatrix } = pack!;
    expect(communicationMatrix.tester.canSendTo).toEqual(
      expect.arrayContaining(['developer', 'architect', 'ba']),
    );
  });

  it('communication matrix prevents direct BA→Tester shortcut', () => {
    const { communicationMatrix } = pack!;
    expect(communicationMatrix.ba.canSendTo).not.toContain('tester');
    expect(communicationMatrix.ba.canSendTo).not.toContain('developer');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/data/harness-devops.test.ts
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/data/harness-devops.test.ts
git commit -m "test(harness-devops): add integration tests for 4 skills and team pack structure"
```

---

### Task 10: Run Full Test Suite

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests PASS, no regressions

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address any issues found during full test suite run"
```
