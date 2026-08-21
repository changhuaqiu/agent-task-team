# 实施任务

## P0：包契约与安装

- [x] 定义 Skill package、installed revision、compile result 中立类型。
- [x] 实现标准目录校验器和稳定 content hash。
- [x] 建立受管包存储与原子安装流程。
- [x] 将 Git/URL 导入改为调用统一安装 seam。
- [x] 为现有数据库 Skill 提供兼容包迁移。

## P1：确定性编译

- [x] 实现 `SkillRuntime.compile()`，第一阶段按 Agent 绑定激活。
- [x] Runtime profile 改传 binding/revision 引用，不传全量正文。
- [x] ContextManager 消费 compile result。
- [x] `SKILL.md` 正文进入 capability，resource 只生成引用索引。
- [x] required Skill 缺失、revision/hash 错误时 fail closed。
- [x] 处理 OpenCode 原生 skillPaths 与平台注入去重。

## P2：观测与 UX

- [x] 扩展 ContextReport：eligible、activated、loaded、decision。
- [x] observation span 记录 revision、hash、reason、token。
- [ ] 调试页区分“已绑定”“本轮激活”“已编入”，并补充编译前失败的未加载 decision。
- [x] Skill 详情显示 installed revision 和包文件分类。

## P3：验证与收敛

- [x] 单测：目录校验、hash、路径逃逸、幂等安装。
- [x] 单测：绑定激活、正文编译、资源不展开、预算裁剪。
- [x] 集成：导入 → 绑定 → dispatch → ContextReport。
- [x] ACP runtime 契约测试：统一编译结果不依赖 runtime 原生发现。
- [x] 迁移回归、类型检查、完整测试、生产构建。
- [x] 更新 wiki 当前实现事实；规格保留为后续激活路由阶段的活动契约。

## 后续阶段（不属于本规格退出条件）

- [x] eligible 与 activated 分离。
- [ ] `$skill-name`、Task、handoff 强信号路由（已完成 `$skill-name`、Task/场景/Delivery policy；结构化 handoff required-skill 待补）。
- [ ] description 语义路由与歧义消解。
- [ ] Skill Eval 与反馈候选区。
