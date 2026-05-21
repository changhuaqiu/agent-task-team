# Harness DevOps 团队标准：Agent Loop 协作规范

> **Status**: Draft
> **Date**: 2026-05-21
> **Scope**: 5-15 人 Scrum/Sprint 团队的 Harness Engineering 落地标准
> **Diagram**: [approach-c-prd-live-doc-loop.html](./approach-c-prd-live-doc-loop.html)

---

## 1. 核心定位

本标准定义中型团队（5-15 人）在 Scrum/Sprint 模式下，如何通过 **Harness Engineering** 将 AI 能力嵌入 DevOps 流程。核心原则：

- **人是主体**：所有角色交接、决策、审批均由人完成（👤→👤）
- **AI 是工具**：每个角色通过不同 Skill 使用 AI，AI 辅助但不替代人
- **知识闭环**：Sprint 结束时将经验提取为结构化知识，注入知识库供后续 Sprint 使用

## 2. Agent Loop 模型

Agent Loop 是一个统一概念，贯穿角色内迭代和跨角色协作两个层面：

```
角色内迭代:  ① 👤 人下达任务 → ② 🤖 AI Skill 处理 → ③ 👤 人审阅 → ◇ OK? ─YES→ 输出产物
                                                                  └──NO──→ 回到 ①（1-N 次迭代）

跨角色流转:  BA ──(PRD)──👤──→ 架构师 ──(US+Tasks)──👤──→ 开发 ──(代码)──👤──→ 测试
                    ↑                                                   │
                    └─────────── 👤 反馈（缺陷/歧义/设计问题）←─────────┘

Sprint 闭环:  Sprint 结束 → 各人用 AI 提取规则 → 👤 团队确认 → 写入知识库 → 下一个 Sprint
```

这三个层面不是独立循环，而是 **同一个 Agent Loop 的不同维度**：角色内迭代打磨产物质量，跨角色流转推进交付进度，Sprint 闭环沉淀组织知识。

### 2.1 角色内迭代

每个角色在 Agent Loop 中通过人机协作反复打磨产物：

| 角色 | Skill | 输入 | 输出 | 迭代焦点 |
|------|-------|------|------|---------|
| BA | prd-generation | 业务需求 → L2 biz rules | PRD 文档（含 rule-id + 验收标准） | 需求完整性、验收标准明确性 |
| 架构师 | architecture-design | PRD → L1 tech + L2 biz | 架构文档 + US + Tasks | 架构合理性、拆解粒度 |
| 开发 | implement | Tasks → L0-T 规范 + L1 tech | 代码 + 单测 + Task 覆盖 | 代码质量、测试覆盖 |
| 测试 | test-generation | US+Tasks+PRD → L2 biz | 测试用例 + 追溯矩阵 | 用例覆盖、缺陷发现 |

### 2.2 跨角色协作

角色之间的交接是 **人对人** 的确认流程，构成 Agent Loop 的流转路径：

```
BA ──(PRD)──👤确认──→ 架构师 ──(US+Tasks)──👤确认──→ 开发 ──(代码)──👤确认──→ 测试
```

每个交接点由一个黄色菱形（◇）标记，表示：
- 交接人完成角色内迭代，产物经过自身审阅确认
- 接收人收到产物后，开始自己的角色内迭代
- 如发现问题，接收人可发起跨角色反馈

跨角色反馈路径（Agent Loop 的回流机制）：
- **测试→开发**：实现缺陷、功能遗漏
- **测试→架构师**：设计不合理、拆解遗漏
- **测试→BA**：需求歧义、验收标准不明确
- **开发→架构师**：技术可行性问题

### 2.3 Sprint 知识闭环

每个 Sprint 结束时，Agent Loop 通过知识提取形成闭环：

```
Sprint 回顾 → 各人用 AI 提取规则 → 👤 团队确认
  → 分类为 model/decision/guideline/pitfall
  → 设置成熟度: draft → verified → proven
  → git commit 到知识库对应层
```

角色提取职责：
- **BA**：提取业务规则（model/guideline）
- **架构师**：提取技术决策（decision）
- **开发**：记录实现踩坑（pitfall）
- **测试**：记录验证规则（guideline）

## 3. 角色职责与工作流

### 3.1 BA（需求分析）

**职责**：需求分析 → 输出 PRD

**工作流**：
1. 接收业务需求（Sprint Planning 或需求池）
2. 使用 prd-generation Skill，基于 L2 biz-wiki 中的业务规则和 model 生成 PRD 草稿
3. 为每个需求条目绑定 rule-id 和验收标准
4. 审阅 PRD，不满意则修正后重新生成
5. 确认后交接给架构师

**产出**：PRD 文档（含 rule-id + 验收标准）

### 3.2 架构师（架构设计 + 拆解）

**职责**：读 PRD → 设计架构文档 → 拆解 US → 拆解 Task

**工作流**：
1. 接收 BA 产出的 PRD
2. 使用 architecture-design Skill，结合 L1 tech-wiki 中的技术模型和决策模式
3. 输出：架构文档 + User Stories + Tasks
4. US 和 Task 关联 PRD 条目 + rule-id，确保追溯链完整
5. 审阅架构+US+Task，不满意则修正
6. 确认后交接给开发

**产出**：架构文档 + US 列表 + Task 列表

### 3.3 开发（编码实现）

**职责**：读 Task → 编码实现 → 自测

**工作流**：
1. 接收架构师产出的 Tasks
2. 使用 implement Skill，参考 L0-T 团队规范和 L1 tech-wiki 中的技术模式
3. 按 Task 编码实现 + 编写单测
4. 代码关联 Task + US + PRD 条目
5. Code Review 后确认
6. 确认后交接给测试

**产出**：代码 + 单测 + Task 覆盖报告

### 3.4 测试（测试验证）

**职责**：读 US+Task → 编写测试用例 → 执行测试 → 缺陷反馈

**工作流**：
1. 接收开发产出的代码和 Tasks
2. 使用 test-generation Skill，参考 L3 PRD+US+Task 和 L2 biz model
3. 基于 US+Task 编写测试用例
4. 执行测试 + 生成追溯矩阵
5. 如发现缺陷，发起跨角色反馈
6. 确认测试通过

**产出**：测试报告 + 追溯矩阵

## 4. 知识库架构

### 4.1 存储分层

| 层级 | 名称 | 内容 | 持久性 |
|------|------|------|--------|
| Layer 0-P | 个人知识 | 个人偏好、工作习惯 | 跟人走 |
| Layer 0-T | 团队规范 | 编码规范、Git 规范、流程规范 | 跨项目 |
| Layer 1 | tech-wiki | 技术模型、架构决策、技术踩坑 | 跨项目 |
| Layer 2 | biz-wiki/{domain} | 业务模型、业务规则、领域知识 | 跨项目 |
| Layer 3 | project | PRD、US、Task、会议纪要 | 项目级 |

### 4.2 知识类型

| 类型 | 含义 | 示例 |
|------|------|------|
| model | 数据/行为模型 | 用户模型、订单状态机 |
| decision | 架构/技术决策 | 为什么选 React 而非 Vue |
| guideline | 指导规范 | API 设计规范、命名规范 |
| pitfall | 踩坑记录 | 某库在特定版本的内存泄漏 |
| process | 流程步骤 | 部署流程、测试流程 |

### 4.3 成熟度与衰减

```
draft → verified → proven
                   ↓ 12个月
             verified
                   ↓ 6个月
               draft
                   ↓
             archive
```

- **draft**：初次记录，未经他人验证
- **verified**：至少一位其他团队成员确认
- **proven**：在多次 Sprint 中反复验证有效
- 自动衰减确保知识库不膨胀

### 4.4 知识生命周期

```
INIT: git pull + 按需注入 → 消费/查询 → ARCHIVE: 提取 + 提升
```

- **INIT 阶段**（Sprint 开始）：git pull 获取最新知识，各 Skill 按需注入对应层
- **消费阶段**（Sprint 执行中）：各角色 Skill 查询对应层的知识
- **ARCHIVE 阶段**（Sprint 结束）：提取新知识，按类型写入对应层

### 4.5 贡献模式

```
pending staging → async merge → conflict resolution
```

- 知识贡献先进入 pending staging 区
- 异步合并到主知识库
- 如有冲突，由团队在 Sprint 回顾中解决

## 5. 各角色知识流映射

### 5.1 BA 知识流

| 方向 | 知识库层 | 知识类型 | 说明 |
|------|---------|---------|------|
| 📥 读 | L2 biz-wiki | model, guideline | 获取业务规则和模型 |
| 📥 读 | L0-T | process | 获取 PRD 模板和流程规范 |
| 📤 写 | L2 biz-wiki | model, guideline | 新发现的业务规则 |

### 5.2 架构师知识流

| 方向 | 知识库层 | 知识类型 | 说明 |
|------|---------|---------|------|
| 📥 读 | L3 PRD | process | 读取 PRD 文档 |
| 📥 读 | L1 tech-wiki | model, decision, pitfall | 技术模型、历史决策、踩坑 |
| 📥 读 | L2 biz-wiki | model | 业务模型辅助架构设计 |
| 📤 写 | L1 tech-wiki | decision, pitfall | 架构决策和技术踩坑 |

### 5.3 开发知识流

| 方向 | 知识库层 | 知识类型 | 说明 |
|------|---------|---------|------|
| 📥 读 | L3 Tasks | process | 读取 Task 列表 |
| 📥 读 | L0-T | guideline | 团队编码规范 |
| 📥 读 | L1 tech-wiki | model, pitfall | 技术模型和踩坑记录 |
| 📤 写 | L1 tech-wiki | pitfall | 实现中发现的踩坑 |
| 📤 写 | L0-T | guideline | 新发现的团队规范 |

### 5.4 测试知识流

| 方向 | 知识库层 | 知识类型 | 说明 |
|------|---------|---------|------|
| 📥 读 | L3 PRD+US+Task | process | 读取完整交付物链 |
| 📥 读 | L2 biz-wiki | model | 业务模型辅助验证 |
| 📥 读 | L1 tech-wiki | pitfall | 历史踩坑辅助测试 |
| 📤 写 | L1 tech-wiki | pitfall | 测试中发现的踩坑 |
| 📤 写 | L2 biz-wiki | guideline | 验证规则 |

## 6. PRD 活文档追溯

PRD 在整个流程中保持可追溯：

```
PRD 条目 ──rule-id──→ US ──rule-id──→ Task ──rule-id──→ Test Case
```

- 每个 PRD 条目携带唯一 rule-id
- 架构师拆解 US/Task 时关联 rule-id
- 开发编码时关联 Task + US + PRD 条目
- 测试生成追溯矩阵，验证每个 PRD 条目是否被 Test Case 覆盖
- AI 辅助生成覆盖报告，人决定如何处理遗漏

## 7. Skill 差异化设计

每个角色的 Skill 遵循不同流程，从知识库中获取不同数据：

| 维度 | BA | 架构师 | 开发 | 测试 |
|------|-----|--------|------|------|
| Skill | prd-generation | architecture-design | implement | test-generation |
| 主要输入 | 业务需求 | PRD | Tasks | US+Tasks+PRD |
| KB 层级 | L2 biz + L0-T | L3 + L1 tech + L2 biz | L3 + L0-T + L1 tech | L3 + L2 biz + L1 |
| KB 类型 | model, guideline, process | model, decision, pitfall, process | guideline, model, pitfall, process | model, pitfall, process |
| 主要输出 | PRD | 架构+US+Tasks | 代码+单测 | 测试报告+追溯矩阵 |
| 回写目标 | L2 biz | L1 tech | L1 tech + L0-T | L1 tech + L2 biz |

## 8. 落地路径

### Phase 1: 基础建设（1-2 Sprint）
- 建立知识库目录结构（5 层）
- 定义首批团队规范（L0-T）
- 配置各角色的 Skill 模板

### Phase 2: 单角色跑通（2-3 Sprint）
- 从 BA 开始，跑通单个 Agent Loop
- 验证知识注入和查询机制
- 逐步扩展到架构师、开发、测试

### Phase 3: 全链路打通（2-3 Sprint）
- 跑通 BA→架构师→开发→测试完整链路
- 建立追溯链和跨角色反馈机制
- 开始 Sprint 知识闭环

### Phase 4: 持续优化
- 根据实际使用调整 Skill 流程
- 积累知识库内容，提升 AI 辅助质量
- 优化知识衰减和贡献流程

---

## Appendix: 术语表

| 术语 | 定义 |
|------|------|
| Harness Engineering | 通过结构化流程、知识注入和治理来引导和约束 AI 能力的工程方法 |
| Agent Loop | 统一的协作循环概念，包含角色内人机迭代、跨角色流转反馈、Sprint 知识闭环三个维度 |
| Skill | 角色使用的 AI 能力单元，包含特定流程和知识库读取规则 |
| rule-id | 贯穿 PRD→US→Task→Test 的唯一标识，确保追溯性 |
| 📥 读 | Skill 从知识库查询/注入的知识层级和类型 |
| 📤 写 | Sprint 回顾时角色向知识库贡献的知识层级和类型 |
