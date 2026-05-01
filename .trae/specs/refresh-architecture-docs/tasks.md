# Tasks

- [ ] Task 1: 盘点现状与差异（以代码为准）
  - [ ] 列出当前默认启动方式、端口与路由
  - [ ] 列出当前 daemon/执行链路的真实入口与协议
  - [ ] 列出当前配置入口与持久化位置（若存在 UI 配置）
  - [ ] 标注 docs/wiki 中的过时描述段落

- [ ] Task 2: 更新整体架构（docs/wiki/01-architecture.md）
  - [ ] 明确系统边界：前端 UI + daemon（桥接器）
  - [ ] 更新运行时拓扑（Ports/Paths）与关键入口文件
  - [ ] 增加“配置体系”概览
  - [ ] 增加“架构演进路线（Milestones）”

- [ ] Task 3: 更新 daemon/执行链路（docs/wiki/04-backend-daemon.md）
  - [ ] 以当前默认实现为主线描述事件协议与执行策略
  - [ ] 明确历史/可选路径，避免与默认路径混淆
  - [ ] 增加“安全/认证规划”章节（最小加固清单）

- [ ] Task 4: 更新运行与开发（docs/wiki/05-run-and-dev.md）
  - [ ] 写清楚“默认启动方式”与“可选/历史启动方式”
  - [ ] 补充“从 0 到可执行”的最短操作路径
  - [ ] 补充配置/探活/排障（daemon 连接、执行链路、bridge 探活）

- [ ] Task 5: 更新依赖与集成点（docs/wiki/06-dependencies.md）
  - [ ] 修正依赖图（以当前真实调用链为准）
  - [ ] 更新外部集成点（opencode、bridge、网络端口）说明

- [ ] Task 6: 更新 Wiki 导航（docs/wiki/README.md）
  - [ ] 增加“最短上手路径”与“架构演进路线”入口
  - [ ] 校正关键入口文件指向

- [ ] Task 7: 验证与收尾
  - [ ] 全量检索 wiki 中过时端口/路径描述并修正
  - [ ] 确保文档不包含任何敏感信息示例（token/key 仅占位符）
  - [ ] 运行 `pnpm build` 通过

# Task Dependencies
- Task 2-6 依赖 Task 1
- Task 7 依赖 Task 2-6

