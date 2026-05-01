# 架构演进文档补全 Spec

## Why
当前仓库的代码实现与 `docs/wiki/*` 文档存在偏差，且对“未来架构演进方向（配置体系、Opencode 集成形态、安全边界）”缺少统一的书面约束，导致团队无法以文档为契约稳定演进。

## What Changes
- 以“代码事实”为准，补齐并修正 Wiki 文档：整体架构、daemon/执行链路、运行方式、依赖与集成点、文档导航。
- 增加“配置体系”说明：哪些配置属于 UI（持久化/作用域）、哪些属于环境变量、哪些属于脚本/外部组件（如本机 bridge）。
- 增加“架构演进路线（Milestones）”：以里程碑方式描述从现状到目标的演进顺序、非目标、风险与验证步骤。
- 增加“安全/认证规划”：明确当前开发态默认风险与生产化前的最小加固清单。

## Impact
- Affected specs: 文档体系（docs/wiki）、Opencode 集成策略（本地执行/bridge/可选 attach）、配置体系（UI/env/scripts）、daemon 形态（内置 vs 独立）。
- Affected code: 本次变更仅更新文档与规格文件，不引入新的业务功能代码。

## ADDED Requirements
### Requirement: 文档必须与代码一致
系统 SHALL 在 `docs/wiki/*` 中准确描述当前实现（端口、路由、事件协议、执行方式），并避免保留过时的默认假设。

#### Scenario: 新成员复现链路（成功）
- **WHEN** 新成员按文档完成“安装依赖 → 启动 → 打开页面 → 验证 daemon/执行链路”
- **THEN** 关键入口/命令/端口与仓库实际行为一致，不出现“按文档操作但跑不起来”的情况。

### Requirement: 配置体系可追溯
系统 SHALL 在文档中明确配置来源、优先级与持久化位置：
- UI 配置（如存在）：持久化位置、清空动作影响范围。
- 环境变量：仅用于运行时/部署的配置项列表与作用范围。
- 脚本/外部组件：本机 bridge（如采用）的安装、启动与探活方式。

#### Scenario: 配置迁移/清空（成功）
- **WHEN** 用户需要重置到“从 0 开始”的状态
- **THEN** 文档说明需要清空哪些本地数据，以及会影响哪些功能。

### Requirement: 架构演进路线可执行
系统 SHALL 在文档中提供 2-3 个阶段的演进路线，并为每个阶段包含：
- Goal / Scope / Non-goals
- Risks & Mitigation
- Verification（可操作的验收步骤）

#### Scenario: 团队按里程碑开发（成功）
- **WHEN** 团队选择某一里程碑推进
- **THEN** 可以从文档直接拆解出可执行任务与验收口径。

### Requirement: 安全与认证规划明确
系统 SHALL 在文档中明确：
- 对外暴露能力（daemon/bridge）在生产环境下的最小安全要求（token、allowlist、CORS 收敛、避免泄露敏感信息）。
- 默认开发态与生产态的差异与开关策略。

#### Scenario: 生产部署前评审（成功）
- **WHEN** 准备部署到共享环境
- **THEN** 文档提供可直接用于评审的安全检查清单。

## MODIFIED Requirements
### Requirement: 运行与开发文档需要对齐现状
`docs/wiki/05-run-and-dev.md` SHALL 更新为“当前默认启动方式”，并把非默认/历史路径标注为可选（避免误导）。

## REMOVED Requirements
### Requirement: 将历史实现当作默认路径
**Reason**: 历史实现（例如独立后端、固定端口假设、固定 attach 地址等）可能仍保留在仓库中，但不应继续作为“默认必需”写进文档。
**Migration**: 文档中将其迁移为“可选/历史”，同时提供与当前默认路径一致的启动与验证步骤。

