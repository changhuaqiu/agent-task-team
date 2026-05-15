# 规格目录

`specs/` 是本项目统一的规格目录，也是所有 Agent 在执行前后都必须对齐的正式规格入口。

## 目录职责

- `specs/` 只存放当前仍然有效、仍然指导实现的规格文档
- 每个规格使用独立子目录管理，目录内默认包含：
  - `spec.md`：目标、范围、约束、需求与影响面
  - `tasks.md`：实施任务拆解
  - `checklist.md`：验收与完成标准
- 已完成、失效或仅保留历史参考价值的规格，不继续放在这里，迁入 `docs/archive/specs/`

## Agent 统一约束

- 所有 Agent 开始实现前，必须先阅读相关 `specs/` 文档
- 所有实现完成前，必须同步更新对应规格与设计文档
- 若代码行为已经变化，但 `specs/` 与设计文档未更新，则任务视为未完成
- 不允许再把 `.trae/` 作为正式规格来源

## 当前有效规格

- `unify-integration-config-center/`：统一集成配置中心
- `team-role-card-compatibility/`：Team Pack 动态角色与账号、角色卡、Skill、dispatch 的兼容模型
- `team-runtime-contract/`：项目级团队运行时契约，统一 TeamPack、RoleCard、Account、Skill、Prompt、Dispatch 与 A2A 的事实源
- `git-collaboration-skill-config/`：为内置 Agent 与 TeamPack 角色配置统一 Git 协作 Skill，包括 issue、PR/MR 与 review 工作流
- `a2a-possession-contract/`：下一代 A2A 协作契约，用“持球/传球/交接包”替代原始 @mention 自动派发语义
- `system-control-plane/`：整体控制平面契约，统一跨实例 runtime、dispatch、health、policy、proof 与 execution envelope
- `frontend-runtime-performance-refactor/`：前端 Team Runtime 派生缓存与高订阅组件收敛重构
- `group-chat-task-flow/`：群聊式多 Agent 协作体验与 Task Graph 任务流事实源契约

## 当前草案规格

- `role-card-format/`：角色卡与 Team Pack 文件格式草案
- `a2a-v2/`：链式 A2A 编排草案；核心实现存在，但协作语义将被 `a2a-possession-contract/` 取代
