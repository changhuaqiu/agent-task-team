# Tasks

- [x] Task 1: 盘点现有文档与代码现状差异
  - [x] 收集需要对齐的“事实清单”：端口/启动方式/daemon 形态/设置页配置/Bridge/Mock Runner
  - [x] 标注过时内容来源（docs/wiki 与 docs/plans 中的具体段落）

- [x] Task 2: 更新整体架构文档（docs/wiki/01-architecture.md）
  - [x] 刷新“形态与边界”：Next + 内置 daemon + 终端/事件桥接
  - [x] 刷新“运行时拓扑”：移除过时端口假设，补充 /api/daemon/init 与 Socket path
  - [x] 增加“配置体系”概览（UI/localStorage/env/scripts）
  - [x] 增加“架构演进路线”章节（阶段、目标、验证）

- [x] Task 3: 更新 daemon 文档（docs/wiki/04-backend-daemon.md）
  - [x] 以 src/server/daemon.ts 为主线重写：输入/输出事件、opencode run/bridge 的行为
  - [x] 明确 backend/server.js 的定位（历史/可选），避免与默认路径混淆
  - [x] 增加“安全/认证建议”（CORS、token、allowlist）

- [x] Task 4: 更新运行与开发文档（docs/wiki/05-run-and-dev.md）
  - [x] 改为“单进程 Next 开发模式”为默认；说明何时需要额外服务
  - [x] 增加“Opencode Bridge 本机安装/启动”说明（macOS/Linux/Windows）
  - [x] 增加“Web 设置页配置步骤”（Bridge 检测/启用、Mock Runner 开关、一键清空）

- [x] Task 5: 补齐文档导航与读者路径（docs/wiki/README.md 或 README.md 的文档导读）
  - [x] 增加“从 0 到可执行”的最短路径（启动 → 设置 → Bridge → 运行）
  - [x] 增加“架构演进路线”入口链接

- [x] Task 6: 校验与验收
  - [x] 文档中的命令/端口/路径与代码一致（至少抽查：taskHubStore.ts、daemon.ts、SettingsDrawer.tsx、bridge 脚本）
  - [x] 文档中不包含任何敏感信息示例（token/key 仅用占位符）
  - [x] 运行 `pnpm build` 通过（确保文档修改未引入构建问题）

# Task Dependencies
- Task 2/3/4/5 依赖 Task 1 的事实清单
- Task 6 依赖 Task 2/3/4/5
