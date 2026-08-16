# Skill 包安装与渐进加载规格

> 状态：active
> 日期：2026-07-18
> 依赖：`context-manager`、`agent-observability`、`acp-runtime-integration`

## 1. 目标

建立可验证的 Skill 执行闭环：标准目录可安装、Agent 绑定可解析、`SKILL.md` 正文确定性进入上下文、附属资源按需读取、调试面可证明实际加载版本。

## 2. 第一阶段范围

- 支持 `skills/<name>/SKILL.md` 标准包目录；
- 支持可选 `agents/`、`references/`、`scripts/`、`assets/`；
- 安装时校验路径、frontmatter、引用和 content hash；
- 生成不可变 installed revision；
- 第一阶段采用“Agent 绑定即激活”；
- 平台编译 `SKILL.md` 正文，不依赖 runtime 自行发现；
- 附属资源只提供受管路径，不全量注入 Prompt；
- ContextReport/observability 记录 revision、hash、activation reason、token 和结果；
- required Skill 未加载时 fail closed。

## 3. 非目标

- description 语义路由、向量检索、Skill 市场；
- 自动修改 Skill；
- 跨 Skill 共享知识底座；
- 让所有 runtime 使用同一套原生 Skill 配置；
- 第一阶段实现完整二进制资产编辑体验。

## 4. 核心契约

### 4.1 包契约

- 目录名、frontmatter name 均为 lowercase hyphen-case；
- frontmatter 必须包含非空 `name` 和 `description`；
- `SKILL.md` 是核心流程正文；
- 详细知识直接位于一层 `references/`；
- 所有相对路径必须位于包根目录内；
- installed revision 由完整包 content hash 标识且不可变。

### 4.2 事实源

- 作者事实源：源仓库 Skill 目录；
- 执行事实源：已安装的不可变 revision；
- 绑定事实源：`agent_skill` 或其后续兼容仓储；
- 本轮加载事实源：ContextReport 中的 Skill delivery decision；
- Runtime 原生 Skill 发现不是平台事实源。

### 4.3 模块 seam

新增深模块 `SkillRuntime`，外部接口只暴露 `install()` 和 `compile()`。ContextManager 不解析目录或查询 Skill 仓储。

所有浏览器 Human/Task Command 只携带原始用户意图并进入服务端 Harness planner；客户端组装的 prompt、system prompt、Skill 列表或 revision 证据均不具权威性。只有 planner 成功后，daemon runtime port 才能执行。

### 4.4 第一阶段激活

Agent 绑定的全部 Skill 进入本轮 activation plan。`SKILL.md` 正文编入 capability context，资源目录只作为 references。后续规格再拆分 eligible 与 activated。

### 4.5 可验证性

每次 context assembly 必须产生：

- eligible/activated/loaded 三组 Skill；
- revision 与 content hash；
- activation reason；
- 最终正文 token；
- omitted/trimmed/failed reason code。

`loadedSkills: string[]` 保留为兼容显示字段，但不能作为加载完成的唯一证据。

## 5. 兼容与迁移

- 现有 `skill.content + skill_file` 数据必须可迁移为兼容包 revision；
- Skill Library 和绑定 UI 第一阶段保持现有用户流程；
- 旧导入 API 保持兼容，但内部改走 `SkillRuntime.install()`；
- Runtime profile 不再长期携带全量 Skill 正文；
- OpenCode 原生 `skillPaths` 必须与平台注入去重，不能双份加载。
- 兼容迁移使用独立、稳定且防碰撞的 package slug；用户可见 Skill 名称及既有 ID/绑定保持不变，空格、大写、Unicode 名称均可迁移。
- Skill 的 config 参与 revision hash；config-only 修改也必须使 active revision 失效并在下次编译时生成新 revision。

## 6. 安全

- 防止 `..`、绝对路径、符号链接逃逸和重复覆盖；
- scripts 不因安装而自动执行；
- assets 不进入 Prompt；
- 日志只记录路径、hash 和有界摘要，不记录敏感正文；
- 安装失败不得留下可被绑定的半成品 revision。

### 6.1 失败证据

required Skill 在 package 校验、revision/hash 检查或预算门禁失败时，planner 必须在返回 blocked/failed 前写入有界 context failure span/proof。证据包含 Skill ID、已知 revision、reason code 与失败 decision，不保存 Skill 正文；调试页通过同一 observability projection 展示。

## 7. 退出条件

- 目录包、现有数据库 Skill 都能安装为 revision；
- 绑定 Skill 的正文可在三种 ACP runtime 的统一 context assembly 证据中确认；
- 附属文件不再被 `buildSkillLayer()` 全量拼接；
- required Skill 缺失或 hash 不一致会阻止 dispatch；
- 调试页能显示绑定、激活、最终加载和失败原因；
- 相关单测、集成测试、类型检查和生产构建通过；
- 长期产品与技术结论已同步到 `docs/`。
