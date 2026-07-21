# Project Context Bootstrap Tasks

> 状态：active
> 日期：2026-07-20

## Phase 1：契约与设计

- [x] 分析用户文章、现有 ContextManager、项目创建链与 A2A handoff。
- [x] 冻结 Codebase / Workstream / Project Context / Knowledge Entry 对象模型。
- [x] 写入产品决策、技术设计与活动 spec。
- [x] 明确同路径共享事实与 conversation 私有轨迹的边界。
- [x] 冻结六层代码知识方法论、权威优先级与 Topology 契约。

## Phase 2：深模块实现

- [ ] 实现 `ProjectContextService.prepare()` 单一 interface。
- [ ] 实现目录分类、受限扫描、六层知识 catalog 和可信命令提取。
- [ ] 实现 TS/JS、Python 与 generic fallback 的机器可读 Topology，包含入口、符号、依赖边与诊断。
- [ ] 实现 manifest revision、fingerprint、有限 freshness check 与原子投影写入。
- [ ] 实现 workstream 投影和同路径 active workstream 冲突摘要。
- [ ] 实现 request-aware Knowledge Entry + repo map 排序与 Context Capsule 编译。

## Phase 3：产品与 Harness 接线

- [ ] 新增只读目录检查 API。
- [ ] 项目创建时初始化或复用项目上下文，并在失败时回滚新 conversation。
- [ ] 创建弹窗以一行状态展示“将初始化 / 已复用 / 同目录有进行中项目 / 请选择具体项目根”。
- [ ] 新增 required `project-context` contributor 并接入 RepositoryHarnessPlanner。
- [ ] 验证 user、workflow、review 和 A2A 接收方均获得可追溯 capsule。

## Phase 4：测试与评测

- [ ] 添加 ProjectContextService interface 级单测。
- [ ] 添加 API 与创建链测试。
- [ ] 添加 Harness contributor 集成测试。
- [ ] 添加 deterministic benchmark fixture 与可重复执行命令。
- [ ] 运行相关单测、类型检查/构建和必要的 UI 测试。
- [ ] 输出前后效率对比、相关性、交接复用与局限报告。

## Phase 5：收尾

- [ ] 更新 README、docs 导航、架构/wiki 当前实现事实。
- [ ] 执行代码审查并修复发现。
- [ ] 按 iteration-knowledge/knowledge-governance 判断并沉淀可复用知识。
- [ ] 满足退出条件后归档本 spec。
