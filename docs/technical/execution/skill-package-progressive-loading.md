# Skill 包安装与渐进加载架构

> 日期：2026-07-18 ｜ 状态：第一阶段目标设计
> 关联：`specs/skill-package-progressive-loading/`、`docs/technical/execution/structured-context-management-architecture.md`

## 1. 当前事实

当前实现已经具备：

- 从仓库根目录或 `skills/` 下扫描 `<name>/SKILL.md`；
- 把正文写入 `skill`，把附属文件写入 `skill_file`；
- 用 `agent_skill` 建立 Agent 绑定；
- Harness 从数据库组装 `RuntimeSkillSummary[]`；
- ContextManager 把所有已绑定 Skill 的正文和每个不超过 10KB 的文件拼入 capability 层；
- ContextReport 记录 `loadedSkills` 名称。

当前缺口：

1. 导入后目录结构被压平成可变数据库内容，缺少不可变包 revision；
2. 附属文件被全量拼入 Prompt，不符合渐进披露；
3. `loadedSkills` 只记录名称，无法证明加载的是哪个版本、哪段正文；
4. OpenCode 可以挂载项目 Skill 路径，但 Claude/Codex ACP 路径不能依赖相同原生发现行为；
5. Skill 绑定、激活和资源读取没有被区分。

## 2. 决策

### 2.1 标准目录作为包格式

使用 `SKILL.md + agents/ + references/ + scripts/ + assets/`。平台不引入另一个必须维护的私有 manifest。

### 2.2 已安装 revision 是运行时事实源

源仓库目录是作者事实源；导入后生成的不可变 installed revision 是执行事实源。两者不是两个可同时编辑的真相：

- 更新源目录后必须重新安装并产生新 revision；
- 一次 Invocation 必须固定一个 revision；
- 执行中不得读取“最新可变内容”替换已选 revision；
- 数据库保存索引、绑定和 revision 元数据，包文件保存在受管包存储中。

建议受管路径：

```text
.ath/skill-packages/<skill-name>/<content-hash>/
```

运行时可使用绝对只读路径引用该目录，不要求复制进每个 worktree。

### 2.3 SkillRuntime 是深模块

目录扫描、校验、安装、选择、加载和证据生成收进一个模块。调用方只学习一个小接口：

```ts
interface SkillRuntime {
  install(source: SkillPackageSource): Promise<InstalledSkillRevision>;
  compile(input: SkillCompileRequest): Promise<SkillCompileResult>;
}
```

`compile()` 内部负责：

- 从 Agent 绑定解析候选 Skill；
- 第一阶段把绑定 Skill 解析为已激活 Skill；
- 读取固定 revision 的 `SKILL.md`；
- 生成要编入上下文的正文；
- 生成附属资源引用；
- 计算 hash、token 和 reason code。

ContextManager 不理解目录、不读取数据库，也不自行选择 Skill，只消费 `SkillCompileResult`。

### 2.4 第一阶段：绑定即激活

第一阶段优先保证确定性：

```text
AgentSkillBinding
  → SkillRuntime.compile()
  → SKILL.md body + resource refs + revision evidence
  → ContextManager
  → BudgetGuard
  → Runtime Envelope
```

- `SKILL.md` 正文由平台直接编入上下文；
- `references/`、`scripts/`、`assets/` 只生成路径索引，不自动展开正文；
- 超预算时按现有 capability policy 裁剪，但必须在 report 中记录；
- 包缺失、hash 不一致或 `SKILL.md` 无法解析时，dispatch fail closed，不得静默假装 Skill 已加载。

### 2.5 第二阶段：候选与激活分离

第二阶段把 Agent 绑定解释为候选集合，通过以下强信号生成本轮激活集合：

1. 用户显式 `$skill-name`；
2. Task 或 handoff 的结构化 required skill；
3. 角色/场景的确定性规则；
4. description 驱动的语义选择。

语义选择未达到置信阈值时不得伪造确定性；应保留候选目录并记录 `selection_ambiguous`，由后续交互或评测改进。

## 3. 包校验

安装必须校验：

- 文件夹名和 frontmatter `name` 使用同一个 lowercase hyphen-case 名称；
- 必须存在且只能存在一个 `SKILL.md`；
- frontmatter 具有 `name`、`description`，description 非空；
- 相对路径不能越过包根目录，符号链接不能逃逸；
- 文本资源与二进制 assets 分开处理；
- `SKILL.md` 中声明的本地引用必须存在；
- 计算整个包的稳定 content hash；
- 同名同 hash 安装幂等，同名不同 hash 产生新 revision。

## 4. 编译结果与证据

```ts
interface SkillCompileResult {
  catalog: Array<{
    skillId: string;
    name: string;
    description: string;
    revision: string;
  }>;
  activated: Array<{
    skillId: string;
    name: string;
    revision: string;
    contentHash: string;
    body: string;
    resourceRefs: string[];
    reason: 'agent_binding' | 'explicit' | 'task' | 'handoff' | 'rule' | 'semantic';
  }>;
  decisions: Array<{
    skillId: string;
    outcome: 'loaded' | 'omitted' | 'trimmed' | 'failed';
    reasonCode: string;
  }>;
}
```

ContextReport 和 observation span 至少记录：

- eligible skill 名称与 revision；
- activated skill 名称与 activation reason；
- 编入上下文的正文 content hash 和 token 数；
- 被裁剪或失败的 reason code；
- 按需读取的 resource path 对应工具 span（后续读取时）。

只有 `outcome=loaded` 且正文 hash 出现在最终 context manifest 中，平台才可以声明“本轮 Agent 已获得该 Skill”。

## 5. 失败语义

| reason code | 含义 | 行为 |
| --- | --- | --- |
| `skill_package_missing` | installed revision 文件缺失 | 阻止 dispatch |
| `skill_manifest_invalid` | SKILL.md/frontmatter 无效 | 阻止安装或 dispatch |
| `skill_revision_mismatch` | 文件 hash 与 revision 不一致 | 阻止 dispatch |
| `skill_body_trimmed` | BudgetGuard 未保留正文 | 允许无 Skill 执行仅限非 required Skill，并显式记录 |
| `required_skill_not_loaded` | 必需 Skill 未进入最终上下文 | 阻止 dispatch |
| `skill_resource_missing` | Agent 请求的引用不存在 | 工具失败并记录路径与 revision |

## 6. 为什么不依赖 Runtime 原生目录

OpenCode、Claude 和 Codex 的原生 Skill 发现能力与配置方式并不完全相同。平台可以把标准目录提供给支持它的 runtime，但这只能作为 adapter 优化，不能成为事实源。

跨运行时契约是：`SkillRuntime.compile()` 产出相同正文和证据，ContextManager 把它送入统一 Runtime Envelope。Runtime 原生加载不得造成重复注入；若启用，必须在 report 中标注 delivery channel 并去重。

## 7. 迁移

1. 为现有数据库 Skill 生成兼容包：`SKILL.md` 来自 `skill.content`，`skill_file` 按安全路径归档；
2. 建立 installed revision 和受管包路径；
3. Runtime profile 从“携带完整正文”改为“携带绑定和 revision 引用”；
4. ContextManager 改为消费 `SkillCompileResult`；
5. 删除 `buildSkillLayer()` 对附属文件的全量拼接；
6. 观测数据稳定后，再启用候选/激活分离。

迁移期间旧 API 可以继续返回正文用于 Skill 详情展示，但不得继续作为执行路径的可变事实源。

## 8. 当前已落地（2026-07-18）

- `RepositorySkillRuntime` 已统一标准目录安装、旧数据库 Skill 兼容包生成与绑定编译；
- installed revision 以 content hash 存放在 `.ath/skill-packages/<name>/<hash>/`，数据库保存不可变 revision 与资源索引；
- Harness 在选择 runtime 之前按 Agent 绑定编译 Skill，因此 Claude、Codex、OpenCode 共享同一份正文与交付证据；
- `ContextManager` 只消费 compile result，正文以独立 `skill:<id>` budget part 编入 capability，资源仅提供受管绝对路径引用；
- required Skill 缺失、包丢失、manifest 无效、hash 不一致或正文被裁剪时阻断 dispatch；
- 平台托管 dispatch 一律不再挂载 OpenCode 项目原生 skillPaths，避免形成无版本证据的旁路事实源；
- ContextReport 与 observation span 保存 eligible/activated/decision、revision、hash、reason、token，不保存附属资源正文；
- Skill 详情显示活动执行版本与资源分类，Agent 调试页显示已绑定、本轮激活、已编入和未加载结果。

当前兼容策略仍保留旧 Skill API 和 `skill_file` 作为编辑/展示入口；任何正文、描述、名称或文件更新都会清除 active revision，下次编译重新生成版本。会影响工具声明的 config 也纳入 revision hash 并固化到 revision，编译不得读取同一版本之外的可变 config。候选路由、`$skill-name` 强信号和语义激活仍属于后续阶段。

已知观测缺口：包缺失、损坏或 hash 不一致会以稳定 reason code 阻断 dispatch，但失败发生在 ContextReport 创建前，当前调试页尚不能展示该失败 Skill 的完整 decision。后续需把失败 decision 写入 observation/proof projection 后再勾选对应验收项。
