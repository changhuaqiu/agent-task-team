# 架构演进文档补全 Spec

## Why
当前仓库的运行方式、Opencode 集成与配置入口已发生多次迭代，现有 `docs/wiki/*` 与实际代码存在偏差，导致新加入的开发者无法按文档复现链路、也无法按规划推进架构演进。

## What Changes
- 补齐并统一“现状架构”描述：以代码为准，描述前端、daemon、Socket 协议、设置页、Opencode 运行模式与数据持久化边界。
- 明确“配置体系”入口：哪些配置通过 UI（localStorage 持久化）、哪些通过环境变量、哪些通过脚本（bridge）完成。
- 增加“架构演进路线”章节：按里程碑描述未来 2-3 个阶段的演进目标、边界、风险与验证方式。
- 增加“安全/认证”章节：基于当前实现的风险点（CORS、公网 Bridge、敏感信息）给出最小可行的加固规划。

## Impact
- Affected specs: 文档体系（docs/wiki）、配置体系（Settings Drawer + localStorage）、Opencode 集成（本地/Bridge/Mock Runner）、Daemon 连接链路（/api/daemon/init + Socket.io）。
- Affected code: 不要求新增业务功能；仅要求文档内容与当前代码实现一致，并为后续演进提供可执行的路线图。

## ADDED Requirements
### Requirement: 统一“现状架构”说明
系统 SHALL 在文档中准确描述以下现状，并保持与代码一致：
- UI 入口与主要页面结构（作战室/看板/质量/全局聊天室/设置）。
- Daemon 的启动与连接方式（Next 内置 Socket 服务、初始化路由、客户端连接时机）。
- Socket.io 事件协议（terminal:start / terminal:data / terminal:exit / agent:event / agent:session）。
- Opencode 三种工作模式：
  - 本环境可直接执行 `opencode run`
  - Bridge（本机转发，通过公网 URL）
  - Mock Runner（仅用于无 opencode 的演示/调试；需明确开关语义）

#### Scenario: 新用户按文档复现链路（成功）
- **WHEN** 用户按文档完成“启动 → 打开设置 → 配置 Bridge → 创建任务 → 运行 Opencode”
- **THEN** 用户能看到 Bridge 检测通过、Daemon 连接成功、终端出现输出流、并可在聊天中看到解析后的消息事件（若输出包含 NDJSON）。

### Requirement: 配置与持久化规则清晰可查
系统 SHALL 在文档中列出配置来源与优先级：
- UI（localStorage）配置：Bridge URL、Bridge 启用状态、Mock Runner 开关等。
- 环境变量：如 `ENABLE_MOCK_RUNNER`、Bridge 进程的 `BRIDGE_PORT/OPENCODE_MODE/OPENCODE_ATTACH_URL` 等。
- 脚本入口：macOS/Linux/Windows 的安装检查与启动命令。

#### Scenario: 用户需要迁移/清空配置（成功）
- **WHEN** 用户在设置页执行“一键清空”
- **THEN** 文档明确说明其影响范围（清空本地持久化数据并刷新），并说明不会影响代码仓库文件与远端数据（如有）。

### Requirement: 架构演进路线可执行
系统 SHALL 在文档中提供 2-3 个阶段的演进路线，并为每个阶段定义：
- 目标（Goal）
- 变更范围（Scope）
- 不做的事（Non-goals）
- 风险与回滚策略（Risks & Mitigation）
- 验证步骤（Verification）

#### Scenario: 团队按里程碑推进（成功）
- **WHEN** 团队选择某个里程碑进行开发
- **THEN** 可以直接从文档抽取出可落地的开发任务与验收步骤，避免口头对齐造成的理解偏差。

### Requirement: 安全与认证规划明确
系统 SHALL 在文档中明确当前默认风险与后续加固建议：
- Bridge 暴露公网 URL 的风险与最小安全要求（例如 token、allowlist、TLS）。
- Socket/HTTP 的 CORS 策略（开发态 vs 生产态）。
- 不记录/不回显敏感信息的原则（例如 API key）。

#### Scenario: 生产部署前评审（成功）
- **WHEN** 团队准备将系统部署到共享/公网环境
- **THEN** 文档能作为安全评审清单，明确哪些点必须加固、如何验证加固有效。

## MODIFIED Requirements
### Requirement: 运行与开发文档与实际一致
现有 `docs/wiki/05-run-and-dev.md` SHALL 更新为与当前实现一致，避免误导性端口/进程说明（例如旧的独立 Express daemon、固定 attach 端口等）。

## REMOVED Requirements
### Requirement: “固定 localhost:4096 attach”作为默认路径
**Reason**: 当前默认实现已演进为 `opencode run --format json`（以及可选 Bridge/attach 模式），固定 attach 端口不再适合作为默认前置条件。
**Migration**: 文档改为说明“attach 模式”为可选能力，并明确其配置方式与适用场景。

