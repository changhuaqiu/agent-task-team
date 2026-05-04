# 智能分派系统设计

**Status**: Draft
**Date**: 2026-05-04
**Depends on**: PromptComposer 7-layer architecture, RoleCard system, @mention routing

## Problem

当前 Mario（planner）在任务分解和分派时存在四个核心问题：

1. **分派不准** — TASK 输出经常不指定 `@agentId`，或指定错误（前端活分给后端）
2. **角色能力描述不够** — RoleCard 7 维度缺少结构化的能力标签，Mario 无法精准匹配
3. **缺少团队视图** — TeamLayer 输出信息不足，Mario 不清楚每个角色的具体能力边界
4. **分解粒度不对** — TASK 粒度过大或过小，无法合理分派给单角色独立完成

## Solution Overview

Mario 作为项目统筹，基于可配置的角色能力图谱 + 程序化匹配引擎，实现精准的任务分解和角色分派。

```
用户目标 → Mario 分解 → DispatchAdvisor 匹配
→ Mario 确认/调整 → 按 @agentId 分派 → 各角色执行
```

## Hard Constraints

- 6 个现有 Agent ID（mario/luigi/toad/peach/dk/yoshi）不可变更
- `@mention` 路由机制（`mention-parser.ts`、`agent-router.ts`）不可破坏
- PromptComposer 7 层架构不可重构，仅在现有层内增强

## Module 1: 可配置角色系统

### RoleCard 能力图谱（第 8 维度）

在现有 7 维度基础上新增 `CapabilityProfile`：

```typescript
interface CapabilityProfile {
  domains: string[]          // 领域：['frontend', 'backend', 'qa', 'review', 'devops']
  skills: string[]           // 具体技能：['react', 'typescript', 'sql', 'testing']
  seniority: 'junior' | 'mid' | 'senior' | 'lead'
  maxConcurrentTasks: number  // 最大并行任务数（默认 1）
}
```

### 存储

- 扩展现有 `role_cards` SQLite 表，新增 `capabilities_json TEXT` 字段存储 JSON 序列化的 CapabilityProfile
- `agents` 表通过 `roleCardId` 关联角色，不再依赖硬编码 `AGENT_ROSTER`
- 6 个预设角色作为种子数据保留，不可删除，可编辑能力图谱

### 可配置角色

- 用户可通过 UI 新增自定义角色，系统生成 slug 化 ID
- 自定义角色加入 `mention-parser` 的动态 ID 池，自动支持 `@mention` 路由
- 角色增删改后，PromptComposer 下次调用时自动拿到最新数据

### 预设角色能力图谱

| Agent ID | Domains | Skills | Seniority | Max Concurrent |
|----------|---------|--------|-----------|----------------|
| mario | planning | wbs, task-decomposition, project-management | lead | 2 |
| luigi | frontend | react, typescript, css, tailwind | senior | 2 |
| toad | backend | node, sql, api-design, drizzle | senior | 2 |
| peach | review | code-review, architecture, quality | senior | 3 |
| dk | review | system-design, performance, scalability | senior | 2 |
| yoshi | qa | testing, e2e, coverage, vitest | mid | 2 |

## Module 2: DispatchAdvisor（分派建议引擎）

### 插入位置

在 Mario 完成 PHASE/TASK 分解后、执行分派前，插入程序化匹配层。

### 流程

```
Mario 输出 TASK 列表
       ↓
DispatchAdvisor.match(taskList, availableAgents)
       ↓
对每个 TASK：
  1. 从 title + description 提取关键词
  2. 与所有可用角色的 domains + skills 做交集匹配
  3. 惩罚 forbiddenActions 命中的角色
  4. 考虑当前负载（已占用 / maxConcurrentTasks）
  5. 输出 rankedAgentList: { agentId, score, reason }[]
       ↓
匹配结果嵌入 Mario prompt，Mario 确认或调整
       ↓
最终确认后执行分派
```

### 匹配算法

```typescript
interface RankedMatch {
  agentId: string
  score: number       // 0-1
  reason: string      // "领域匹配: frontend, 技能匹配: react(2)"
}

function matchTaskToAgent(
  task: { title: string; description: string },
  agents: Agent[],
  currentLoad: Record<string, number>
): RankedMatch[]
```

匹配逻辑：

1. **领域匹配**（权重 0.5）：task 关键词与 `domains` 的 `DOMAIN_KEYWORDS` 映射匹配
2. **技能匹配**（权重 0.3）：task 关键词与 `skills` 直接匹配
3. **禁忌惩罚**（权重 -0.5）：命中 `forbiddenActions` 的角色降权
4. **负载因子**（权重 0.2）：已满载角色 score 归零

### 领域关键词映射表

```typescript
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  frontend: ['ui', '页面', '组件', 'css', 'react', '样式', 'layout', 'button', '前端', 'frontend'],
  backend:  ['api', '接口', '数据库', 'sql', 'server', '路由', 'endpoint', '后端', 'backend'],
  qa:       ['测试', 'test', 'e2e', '单元测试', '覆盖率', 'bug', '质量'],
  review:   ['审查', 'review', '质量', '代码审查', 'pr', 'cr'],
  devops:   ['部署', 'deploy', 'ci', 'pipeline', 'docker', '运维'],
  planning: ['规划', '分解', '计划', 'plan', '方案', '设计', '架构'],
}
```

用户可通过角色管理 UI 扩展此映射表。

### Mario 的确认角色

Advisor 给出建议后，Mario 可以：
- 直接采纳最高分建议
- 调整并说明理由
- 拒绝并重新分配

LLM 灵活性 + 程序化兜底，双重保障。

## Module 3: 增强 TeamLayer + Planner Prompt

### TeamLayer 增强输出

从当前的简单 markdown 表格，增强为包含能力图谱和负载信息的完整花名册：

```markdown
## 团队花名册

| @mention | 角色 | 领域 | 核心技能 | 资历 | 并行上限 | 当前负载 |
|----------|------|------|---------|------|---------|---------|
| @mario   | 项目统筹 | planning | wbs, 任务分解 | lead | 2 | 0/2 |
| @luigi   | 前端开发 | frontend | react, ts, css | senior | 2 | 1/2 |
| ...      | ... | ... | ... | ... | ... | ... |

## 分派规则
- 严格按领域匹配：前端任务 → frontend 域角色
- 负载已满的角色不可分派
- 无精确领域匹配时，选择 skills 交集最大的角色
- 每个 TASK 必须指定 @agentId，不允许空缺
```

### Planner Prompt 增强

在 Mario 的 RoleLayer 中增加分派职责：

```
## 分派职责
你是项目统筹，核心职责：
1. 将用户目标分解为 PHASE → TASK，每个 TASK 粒度控制在单角色可独立完成
2. 分派时参考团队花名册的领域和技能匹配
3. 如果 Advisor 给出了建议分派，优先采纳；有异议时说明理由
4. 每个 TASK 输出格式：TASK: <描述> @<agentId>
```

### TASK 粒度标准

```
## TASK 粒度标准
- 一个 TASK = 一个角色的一次独立交付
- 涉及两个领域的 TASK 必须拆成两个
- 单个 TASK 预估工作量不超过项目总量的 1/5
- 有依赖关系的 TASK 放在同一 PHASE 内，按顺序排列
```

## Module 4: 角色管理 UI

### 角色列表页

- 展示所有角色卡片（头像 + 名字 + 领域标签 + 负载状态）
- 6 个预设角色标记"预设"标签，不可删除，可编辑能力图谱
- 用户自定义角色可删除
- 新增角色按钮

### 新建/编辑角色字段

| 用户看到的 | 内部字段 | 必填 |
|-----------|---------|------|
| 角色名称 | `name` | 是 |
| 角色定位 | `persona.introduction` | 是 |
| 擅长领域（多选） | `capabilities.domains` | 是 |
| 具体技能（标签输入） | `capabilities.skills` | 否 |
| 资历等级 | `capabilities.seniority` | 否（默认 mid） |
| 最大并行任务数 | `capabilities.maxConcurrentTasks` | 否（默认 1） |
| 关联 AI 账户 | `accountIds` | 是 |
| 工作风格 | `workStyle` 维度 | 否 |

### 领域关键词词典管理

- 角色管理页提供"关键词词典"编辑入口
- 用户可给每个领域添加更多关键词，提升匹配准确度

## Impact on Existing System

| 组件 | 变更类型 | 说明 |
|------|---------|------|
| `RoleCard` 类型 | 扩展 | 新增 `capabilities` 字段，现有 7 维度不变 |
| `role_cards` 表 | 扩展 | 新增 `capabilities_json` 列，现有列不变 |
| `AGENT_ROSTER` | 替换 | 改为从 DB 读取，6 个预设 ID 不变 |
| `mention-parser.ts` | 扩展 | `AGENT_IDS` 改为动态加载，现有 ID 不变 |
| `TeamLayer` | 增强 | 输出内容增强，调用接口不变 |
| `RoleLayer` | 增强 | Mario 的 planner prompt 增加分派职责 |
| `breakdownParser.ts` | 不变 | 继续解析 `TASK: ... @agentId` 格式 |
| `agent-router.ts` | 不变 | 路由逻辑不变 |
| 新增 `DispatchAdvisor` | 新增 | 独立模块，插入分解流程中间 |
| 新增角色管理 UI | 新增 | 新页面 |

## Out of Scope

- 多级分派（链条式 agent-to-agent 转派）
- 基于历史表现的动态权重调整
- embedding/向量匹配（当前用关键词匹配）
- 自动负载均衡重调度
