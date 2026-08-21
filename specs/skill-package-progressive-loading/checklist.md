# 验收清单

## 包与安装

- [x] 缺少 SKILL.md、name 或 description 时安装失败且有稳定 reason code。
- [x] 非法路径和符号链接逃逸被拒绝。
- [x] 同名同内容安装幂等；同名不同内容产生新 revision。
- [x] 安装过程原子化，不产生半成品可绑定记录。
- [x] 标准 references/scripts/assets 目录能被保留和索引。

## Agent 获得 Skill

- [x] 已绑定 Skill 进入 activation plan。
- [x] 已绑定候选与本轮 activated Skill 分离，未激活正文和工具不进入 Prompt。
- [x] 最终 Prompt 中存在固定 revision 的 SKILL.md 正文。
- [x] references/scripts/assets 正文未被默认拼接。
- [x] required Skill 缺失、损坏或被裁剪时 dispatch 被阻止。
- [x] ContextManager 不直接解释目录结构或查询 Skill 仓储。

## 证据

- [x] ContextReport 包含 eligible、activated、loaded、revision、hash、reason 和 token。
- [x] 最终 context manifest 的 hash 能与 installed revision 复核。
- [ ] 调试 UI 能显示编译前失败的未加载原因而不只显示 Skill 名称。
- [x] 观测数据不保存无界 Skill 正文或敏感内容。

## 兼容

- [x] 现有数据库 Skill 可迁移且绑定关系保留。
- [x] Skill Library 的安装和绑定主流程不增加内部实现概念。
- [x] OpenCode 原生 Skill 与平台 delivery 不重复注入。
- [x] Claude、Codex、OpenCode 均使用相同的 compiled Skill evidence。

## 交付门禁

- [x] 定向单测通过。
- [x] 集成测试通过。
- [x] 类型检查通过。
- [x] 完整测试通过。
- [x] 生产构建通过。
- [x] 设计文档、spec、wiki 与最终代码一致。
