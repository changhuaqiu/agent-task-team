# Project Context Bootstrap：代码库发现、分层知识索引与增量上下文

> 日期：2026-07-20
> 状态：已实现
> 已归档规格：`docs/archive/specs/project-context-bootstrap/`
> 依赖：`docs/technical/execution/context-layering.md`
> 最近 live E2E：2026-07-21

## 1. 背景证据

当前执行链：

```text
ProjectCreateDialog
  → taskHubStore.createConversation
  → POST /api/mutations conversation.create
  → conversationRepo.create

InvocationPlanner
  → conversation.project_path
  → ContextManager(project={id,name,path})
  → projectLayer 只渲染项目名和路径
```

`task-file-service.initProjectDir()` 只在 `ath.initBreakdown` 时写平台 workspace 下的 `.ath/PROJECT.md` 等文件，不会为 `conversation.project_path` 对应的真实代码库建立知识入口。A2A handoff packet 只承载任务级 requestedAction/decisions/evidence，不承载共享代码库版本。

## 2. 文章分析与架构映射

用户提供的文章《从 Prompt 到 Harness：企业级 Agent 工程的完整演进之路》给出四个与本方案直接相关的判断：

1. 大上下文不等于高有效容量；噪音会稀释注意力。
2. 单次执行内的 Context 管理不能解决跨执行知识丢失。
3. Harness 需要“文件系统”式持久知识和显式 IPC，而不是更长 prompt。
4. 知识按稳定性分层，存储结构化资产，再由 compiler 按场景编译。

因此本方案不把目录内容塞入 system prompt，而是新增位于文件系统事实与 ContextManager 之间的 Project Context module：

```text
Codebase filesystem
  → ProjectContextService.prepare()
      ├─ discovery / bounded scan
      ├─ versioned manifest
      ├─ six-layer knowledge catalog
      ├─ bounded code topology
      ├─ workstream projection
      └─ request-aware capsule
  → project-context ContextContributor
  → ContextManager
  → ContextSnapshot
  → runtime
```

## 3. 模块深度与 seam

外部 seam 只有一个：

```ts
prepare(input: ProjectContextPrepareInput): Promise<ProjectContextResult>
```

调用方不需要知道：

- 如何识别代码库或容器目录；
- 哪些目录应忽略；
- 如何提取语言、命令、拓扑和文档摘要；
- manifest 何时刷新；
- workstream 文件如何命名；
- 相关知识如何排序；
- 生成文件如何原子写入；
- 诊断指标如何计数。

删除该 module 后，这些复杂度会重新散落到创建 API、harness、A2A 和评测调用方，满足深模块的 deletion test。

文件系统是 local-substitutable dependency。测试通过临时目录跨同一 seam 验证，不暴露额外 filesystem port。

## 4. 目录发现

### 4.1 Root marker

首版识别：

- JavaScript/TypeScript：`package.json`
- Python：`pyproject.toml`、`requirements.txt`
- Go：`go.mod`
- Rust：`Cargo.toml`
- Java：`pom.xml`、`build.gradle`、`build.gradle.kts`
- .NET：`*.sln`、`*.csproj`
- Git：`.git`

所选目录自身含 marker 时，它就是 codebase root；即使内部还有 package manifest，也按 monorepo 处理，不判为 ambiguous。

所选目录自身无 marker 时，在有限深度内发现独立候选根：

- 0 个候选：`empty`
- 1 个候选：返回候选并要求调用方把具体根作为 project path
- 多个候选：`ambiguous_workspace`

系统不向父目录搜索，避免把宿主 repo 或用户主目录误当项目。

### 4.2 扫描边界

默认跳过：

```text
.git .ath node_modules .next dist build out coverage target vendor
.venv venv __pycache__ .cache .turbo .pnpm-store
```

并设置：

- 最大深度；
- 最大目录条目数；
- 最大知识文档数；
- 单文档摘要读取上限；
- 不跟随符号链接；
- 不读取 `.env`、凭据、密钥和二进制内容。

扫描达到上限时 manifest 标记 `truncated=true`，而不是无界继续。

## 5. 六层知识方法论

项目初始化采用“Source → Index → Capsule”三阶段和六层知识模型：

```text
Owner sources
  → bounded compiler/indexer
      → versioned shared index
          → request-aware capsule
              → Agent 按引用渐进展开
```

| 层 | 内容 | 稳定性 | 索引责任 |
| --- | --- | --- | --- |
| L0 Scope | root、项目 identity、revision | 高 | 固定注入，禁止向父目录搜索 |
| L1 Norms & Constraints | instructions、standards、active specs、硬约束 | 高 | 记录作用域、来源和优先级；required 不可裁 |
| L2 Architecture & Topology | entrypoints、modules、symbols、dependency edges | 中 | 完整有界图落盘，按请求压缩 |
| L3 Development & Operations | install/build/test/lint/run、CI 入口、环境变量名 | 中 | 只采信 manifest/docs，不读取 secret 值 |
| L4 Work & Handoff | goal、workstream、collision、handoff revision | 低 | conversation 私有，跨项目只降维冲突信号 |
| L5 Knowledge & Evidence | ADR、领域文档、经验、receipt 引用 | 中低 | owner doc 保持权威，catalog 做 Top-K 选择 |

这套模型把文章中的稳定性分层、OpenAI/AGENTS 的路径级指令、docs-as-code 和 repo map 合并成一个可执行流程。它不是让 Agent 记更多，而是让每条事实都能回答：谁拥有、何时失效、对谁可见、什么时候进入 prompt。

### 5.1 权威与冲突

继续采用本仓库现有优先级，而不是另造一套隐式规则：

```text
current user instruction
  > nearest applicable AGENTS/instruction
  > docs/standards
  > active specs
  > wiki/technical/product owner docs
  > governed knowledge entries
  > generated inference
```

同级按“作用域更近 > 来源更新 > 路径稳定排序”。生成型 inference 必须带 `authority='inferred'`；它可以帮助导航，不能覆盖明示约束。

### 5.2 Code Topology

Topology 使用两个投影：

1. `topology.json`：一次有界扫描生成的机器可读全图；
2. `project/topology.md`：稳定摘要，capsule 再从全图编译 request-aware repo map。

```ts
interface CodeTopology {
  schemaVersion: 1;
  revision: number;
  generatedAt: string;
  precision: 'heuristic';
  entrypoints: string[];
  modules: Array<{
    path: string;
    language: string;
    kind: 'source' | 'test' | 'config' | 'manifest';
    exportedSymbols: string[];
    inbound: number;
    outbound: number;
    entrypoint: boolean;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: 'import' | 'manifest';
  }>;
  unresolvedImports: number;
  truncated: boolean;
}
```

首版 adapter：

- TypeScript/JavaScript：提取静态 import/export、CommonJS require、导出声明和相对模块边；NodeNext 的 `.js` 运行时 specifier 可回指 `.ts/.tsx/.mts/.cts` owner 文件；
- Python：提取 import/from、顶层 class/def，以及仓库内可确认 owner 的相对/绝对模块边；
- 其他语言：通过 root manifest 与源目录形成 module-level fallback。

这是导航索引，不是编译器证明。请求排序借鉴小预算 repository map：`query overlap + entrypoint boost + normalized inbound centrality`，稳定取 Top-K，再输出相邻边。未命中时回退到入口点和高中心性模块；绝不把完整图或源文件正文塞进 prompt。

## 6. Manifest 与分层投影

`manifest.json` 是生成索引的唯一机器事实源；它的完整内容由独立发布的
`.manifest-checkpoint.json` 记录 SHA-256，不允许只凭 manifest 自己声明的
owner path/freshness/topology digest 恢复为可信 read model：

```ts
interface ProjectContextManifest {
  schemaVersion: 1;
  revision: number;
  generatedAt: string;
  sourceFingerprint: string;
  project: {
    root: string;
    name: string;
    kind: 'codebase' | 'empty';
    technologies: string[];
    packageManager?: string;
  };
  instructions: string[];
  commands: Array<{ name: string; command: string; source: string }>;
  layers: Array<{
    id: 'scope' | 'norms-constraints' | 'topology' | 'development' | 'work' | 'knowledge';
    sources: string[];
    freshness: 'stable' | 'structural' | 'volatile';
  }>;
  topology: {
    path: '.ath/context/topology.json';
    moduleCount: number;
    edgeCount: number;
    precision: 'heuristic';
    digest: string;
  };
  knowledge: KnowledgeEntry[];
  freshnessInputs: Array<{ path: string; mtimeMs: number; size: number }>;
  diagnostics: ScanDiagnostics;
}
```

生成投影：

- `.project-context-owner.json`：生成器、schema、root 与创建时间；首次只认领空 context 目录；
- `.manifest-checkpoint.json`：生成器、root、revision 与完整 manifest digest；独立于 manifest 且最后发布；
- `INDEX.md`：固定入口、六层使用顺序与冲突优先级；
- `project/overview.md`：L0；
- `project/architecture.md` + `topology.json` + `project/topology.md`：L2；
- `project/development.md`：L3；
- `knowledge/catalog.md`：L1/L5 的 owner source 元数据；
- `workstreams/*.json` + `INDEX.md`：L4 易变工作状态。

所有投影都是 read model。原始 README/AGENTS/docs/specs 才是 owner doc。

## 7. 增量刷新

冷初始化执行 bounded scan 并写 revision 1。

热加载：

1. 读取 manifest 与独立 integrity checkpoint，完整 digest 不一致或 checkpoint 缺失则 fail closed；
2. 只 stat `freshnessInputs`；
3. 无变化：cache hit，不递归扫描；
4. 有变化：通过进程内 single-flight 和 `<root>/.ath/context/.prepare.lock` 跨进程串行执行 bounded scan；
5. source fingerprint 不变：保持 revision；
6. fingerprint 变化：revision + 1，先原子替换 topology/Markdown 投影，再写 manifest，最后提交独立 integrity checkpoint。

freshness inputs 优先选择：

- 项目 root 目录本身（捕获根目录新增/删除）；
- `.git/HEAD`、`.git/index`；
- 根 marker；
- 指令文件；
- 已索引知识文档；
- 关键拓扑目录。

这是 O(k) 变更探测，k 由 manifest 限制；它不是每轮全目录搜索。项目 root、source/doc/root marker 与已访问目录必须全部进入 freshness set 才允许命中 warm cache；扫描截断或超过上限时记录 `freshnessCoverage='incomplete'` 并在后续 load 重新做有界扫描，不能用漏检换取漂亮的缓存数字。

显式 `refresh` 可以绕过损坏或版本不兼容的 manifest 重建；普通 `inspect/load` 则 fail closed。内存缓存还会校验 ownership/manifest/integrity-checkpoint 三者的文件身份签名，磁盘 topology 必须通过 manifest 中的 digest 才可复用。同一 service 内签名未变时，preflight 可使用已经完整验证的 cached project name，避免为了分类再次读取大 manifest；仍会验证生成目录、统计签名 metadata checks 并读取 workstream。签名变化或进程重启后的首次恢复必须重读 owner、manifest 与 checkpoint，不能用该优化绕过完整性门。

manifest 不是天然可信输入。每次从磁盘恢复时必须先用独立 checkpoint 验证完整 manifest digest，防止只篡改 `command.command`、knowledge `title/summary/priority` 或 instruction `appliesTo` 等派生文本后冒充 owner source 内容；再验证完整结构，并把 `instructions.path`、`knowledge.path`、`commands.source` 与 `freshnessInputs.path` 约束为规范化的仓库内相对路径：拒绝绝对路径、drive-relative 路径、反斜杠、空路径、`..` 穿越和非规范化分隔；instruction、knowledge 与 command source 还必须对应一个 file freshness owner source。现存 owner source 必须是 project real root 内的普通文件，不能是 symlink/junction。freshness 检查本身使用 no-follow metadata；任何 digest、路径或链接验证失败都使普通 inspect/load fail closed，只允许显式 refresh 重新扫描。这样被篡改但 freshness/topology 仍表面有效的 manifest 也不能作为 explicit/trusted read model 注入 Harness。

## 8. Workstream 隔离

每个 conversation 写一份：

```ts
interface ProjectWorkstream {
  conversationId: string;
  title: string;
  goalSummary: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
```

同路径 capsule 可列出其他 active workstream，但字段白名单固定为：

- title
- status
- 截断后的 goalSummary

禁止读取或投影 message、task、session、handoff body、agent trajectory。

这些字段先去除控制字符、折叠空白并限长，随后放入 `<untrusted-workstream-collision-data>` JSON envelope。该 envelope 只提供修改冲突信号，内容不能升级为 Agent 指令、规范、任务或授权。

Context fragment 的 scope 仍是当前 `conversationId`。跨 conversation 的数据在进入 fragment 前已降维为 workspace collision signal，不改变 ContextManager 的隔离键。

## 9. Request-aware capsule

编译顺序：

1. 项目身份、revision、cache 状态；
2. 当前 workstream；
3. 按作用域/优先级排序的 norms 与 constraints；
4. commands 与 request-aware repo map；
5. 其他 active workstream 冲突摘要；
6. 当前请求相关的 Top-K Knowledge Entry。

相关性首版使用确定性词项评分：

- query 与 title/path/tags/summary 的规范化 token 重合；
- 指令、docs index、活动 spec index 具有基础权重；
- 路径/标题命中高于摘要命中；
- 分数相同时按 priority、path 稳定排序。

capsule 设字符预算，不包含原文。Agent 只拿到精确路径、摘要和“为什么相关”。

`.github/instructions/*.instructions.md` 的 `applyTo` 会同时约束规范段和知识 Top-K。判定依据是请求相对 neutral topology score 的实际词项命中模块，而不是 repo map 中为导航补齐的低分模块。L1 硬约束为 required section；若所有适用约束无法在预算内完整呈现则拒绝编译，禁止 `.slice()` 或静默裁掉尾部规则。

## 10. ContextManager 接线

Contributor：

```ts
const projectContextContributor: ContextContributor = {
  id: 'project-context',
  required: true,
  contribute(query) { ... }
}
```

- 有 project path：调用 `prepare(mode='load')`，输出 `situation` fragment；current workstream 可额外输出 `focus` fragment。
- 无 project path：输出 required constraint fragment，明确禁止扫描 host cwd。
- fragment `version` 使用 manifest revision + workstream timestamp。
- `evidenceRefs` 包含 manifest 和选中 owner docs。
- `ContextSnapshot.fragmentRefs` 因此能证明每次 dispatch 实际使用的 project-context revision。

Evaluation application snapshot 必须冻结输入，不注册该可变 contributor。

## 11. 创建链与 UI

新增 `/api/project-context` 的只读 inspect action：

- 校验 POST body；
- 返回 classification、existingContext、候选根和 active workstream count；
- 不写文件。

`conversation.create`：

1. 创建 DB row；
2. 对有 project path 的 row 调 `initialize`；
3. DB adapter 以 `resolveWorkstreams` callback 交给 service，在持有 per-root lock 后重新读取权威集合，避免并发创建用旧快照删除新 workstream；
4. 失败则删除刚创建的 row，并用内部 `rollback` 补偿移除已发布的 workstream 投影、重建同路径 index；
5. 返回带 reason code 的失败。

创建弹窗复用当前 FolderPicker，在现有 Git 状态旁展示一行项目上下文状态，不增加新的卡片或配置区。

### 11.1 冷启动运行配置水合门

真实浏览器 E2E 发现：`/api/state` 返回带 `team_pack_id` 的 conversation 后，如果客户端先把页面标记为 hydrated、却没有同时加载账户并解析对应 Team Pack，用户立即发送的首条消息会在 Harness 之前被误判为 `no_runtime_profile`。这会形成“Project Context 已初始化，但真实 Agent 没有启动”的假成功。

因此客户端冷启动必须把整个 `loadFromServer()` 作为 single-flight：React Strict Mode、设置页或其他调用方在上一轮未结束时再次调用，只能复用同一个 Promise，不得启动第二组会覆盖状态的请求。正常路径满足一个可观察的原子水位线后才允许页面进入可交互态：

1. conversation、task、message 与服务端 session 已加载；
2. `/api/accounts` 已完成，账户列表可用于 `resolveRuntimeAgentProfile()`；
3. 当前 conversation 已确定；如果存在 `teamPackId`，对应 Team Pack 已完成加载并成为 `currentTeamPack`；
4. `activeAgentIds` 与 Team Pack roles 同步，当前入口 Agent 能解析到 engine/account；
5. 最后才设置 `hasHydrated=true`，随后建立 daemon 连接。

冷启动选择沿用仍存在的当前 conversation；不存在时选择最近更新的 conversation。原子 readiness gate 中所有被 `await` 的远程依赖——state、phases、accounts、Agent roster 与 Team Pack——都必须把 `fetch + status validation + response body parsing` 整体置于同一个 15 秒超时和 AbortController 生命周期，不能让已返回 headers 但永久 pending 的 body 把页面停在 skeleton。超时、拒绝或无效 Team Pack 都结束 skeleton、写入 `runtimeHydrationError`，在主页面显示“Agent 运行配置暂不可用”的可重试告警；所以 `hasHydrated=true` 表示首次水合尝试已经 settled，不等价于 runtime ready，后者还要求 `runtimeHydrationError=null` 且 profile 可解析。

`hasHydrated` 是页面生命周期内单调的交互就绪门：首次加载前为 `false`，首次成功或失败 settled 后转为 `true`，此后不得回退。页面已经可交互时再次调用 `loadFromServer()`，包括用户重试或组件重新挂载触发的刷新，只清除上一轮错误并复用 single-flight 加载；`ProjectWorkspace` 必须保持挂载，避免销毁聊天输入框的本地草稿和焦点。后台刷新由 `runtimeRefreshInProgress` 显式标记：输入框保持可编辑，Human Command 发送入口在标记清除前拒绝提交，避免读取分阶段写入的运行配置；草稿不被清空，用户可在刷新完成后原样发送。草稿同时绑定开始输入时的 `conversationId`；若刷新改变或移除选择，发送入口保持关闭，直到用户切回原项目或清空草稿，禁止后台状态变化重定向人的命令。刷新失败更新 `runtimeHydrationError`，刷新成功替换服务端权威状态；两条路径都不能重新展示全屏 skeleton。该修复由 [#67](https://github.com/changhuaqiu/agent-task-team/issues/67) 跟踪。

## 12. 安全与可观察

- 所有路径先 `resolve()` 并验证为普通目录；扫描文件以 no-follow handle 打开，并在读取前后核对文件身份。
- 所有生成目标和生成物读取必须在 lexical path 与 realpath 上均位于 `<resolved-root>/.ath/context/`；`.ath/context` 各级不得是符号链接或 Windows junction/reparse point。
- 首次初始化以 exclusive-create 写 ownership marker，且只允许 context 目录为空；没有有效 marker 的既有 `INDEX.md`/topology/project 等内容一律不覆盖。
- workstream filename 使用净化 id + hash，防路径穿越和碰撞。
- 写文件使用同目录临时文件 + rename；跨进程锁带 owner token、陈旧锁回收和 heartbeat，manifest 写完后再发布独立 integrity checkpoint。
- 错误不包含文件内容或凭据。
- 诊断记录 cacheHit、entriesVisited、filesRead、bytesRead、selectedKnowledgeCount、durationMs、truncated、freshnessCoverage。
- proof/context snapshot 只记录路径、revision、digest 和计数，不复制文档正文。

## 13. 测试策略

以 `ProjectContextService.prepare()` 作为 test surface：

- 临时目录模拟 codebase、empty、ambiguous、已有 manifest；
- 验证二次 load 不再递归扫描；
- 修改 freshness input 验证 revision 刷新；
- 两个 workstream 验证共享白名单与私有数据缺失；
- 查询集验证 Knowledge Entry Recall@K；
- Harness 测试验证 user 与 A2A 使用同一 revision；
- API 测试验证 inspect 只读和创建失败回滚。
- 客户端冷启动测试验证账户、Agent roster 与 Team Pack 在成功路径的 `hasHydrated=true` 前完成，并且首条真实派发能解析运行配置；另覆盖 fetch 永久 pending、headers 已返回但 JSON body 永久 pending、Team Pack reject/timeout 后 15 秒内退出 skeleton、形成可重试错误，以及 Strict Mode 风格重叠调用只复用一个 in-flight Promise/一组请求；
- 浏览器 live E2E 分别使用空目录和已有代码目录，验证创建初始化产物、`invocation`、`context.assemble` span 的 project-context layer 以及真实 Agent 对注入 capsule 的回答；
- 对抗测试验证链接逃逸、跨 service instance 并发、topology digest 篡改、独立 manifest checkpoint 缺失/不一致、只篡改 command/summary/applyTo 等派生字段、manifest 内 freshness/instruction/knowledge/command source 路径穿越、损坏 manifest 恢复、freshness 上限、`applyTo` 作用域、硬约束不丢失、交接提示注入和投影后失败补偿。

旧的内部 helper 不单独形成公共 interface，也不为实现细节堆测试。

live E2E 必须从全新服务进程启动，使用独立 `ATH_DATA_DIR`，避免 Next.js 开发态已存在的 Socket.IO daemon 单例继续持有热更新前的 contributor 集合。验收不能只看 Agent 文本，必须同时核对：

1. `invocation` 使用真实 engine/account 且状态成功；
2. supplied root、`conversation.project_path` 与 `manifest.project.root` 的 canonical identity 完全一致；
3. `context.assemble` span 完整结束，包含未裁剪的精确 conversation-scoped layer；snapshot 中只有一个 `producer=project-context` 的 capsule ref，其 revision/fingerprint 与 manifest 一致，evidence refs 均位于该 root 且包含 manifest/topology；
4. invocation prompt 包含生成 capsule 的项目名、类型、revision 与入口标题；
5. observation span 与持久化 `chat_message.content_type='tool_use'` 两条证据都没有工具调用；
6. Agent 在禁止工具和目录扫描的探针下，回答与 prompt/磁盘 manifest 一致，数值字段使用严格非负整数语法；
7. 空目录和已有代码目录逐例记录，不用平均值隐藏失败。

`scripts/collect-project-context-live-e2e.mjs` 将 manifest、invocation、context span 与 Agent 回答做交叉校验并输出机器可读 artifact。它只收集已由浏览器发起的真实执行，不自行伪造 Agent 结果。

## 14. 评测设计

评测遵循 `docs/technical/evaluation/README.md` 的 C 级 Change Evaluation Record。设计决策与证据的映射固定为：

| 设计决策 | Why | 行业参照 | 本项目验证 |
| --- | --- | --- | --- |
| 路径级规范与最近作用域 | 避免每轮重读/冲突 | AGENTS、Claude memory、Copilot instructions | 指令选择/优先级 fixture |
| 机器全图 + prompt 小图 | 全量代码树噪音高 | Aider repo map、Sourcegraph navigation | Recall@K、capsule 字符、模块/边覆盖 |
| owner doc + 生成 catalog | 避免双事实源 | Backstage docs-as-code | owner 文件 hash 不变、catalog provenance |
| 一次索引 + 有限 freshness | 避免每个 Agent 全量扫描 | Harness filesystem/checkpoint 方法 | cold/warm I/O、耗时、revision |
| 同路径共享 revision、轨迹隔离 | 交接复用但不泄漏 | 项目既有 Context scope 模型 | 第二 Agent revision、私有字段缺失 |

### 14.1 确定性代理指标

在固定 fixture 上比较：

| 指标 | 落地前 baseline | 落地后 |
| --- | --- | --- |
| entries visited | 每个 Agent 递归枚举 | 首次一次 + 后续有限 stat |
| files read | 每个 Agent 重读入口资料 | 首次建 catalog + Top-K |
| bytes read | 全量候选资料 | manifest + capsule |
| prompt chars / estimated tokens | 目录树和文档摘要堆叠 | 有预算的 capsule |
| handoff rescan | 接收方重复 | 相同 revision 直接加载 |
| relevant doc Recall@K | 不限制但高噪音 | Top-K 精确入口 |

`ProjectContextResult.diagnostics` 的计数边界是一次完整 `prepare()` 调用：先计入
`inspectProjectPath()` 的 owner/manifest/checkpoint/workstream 读取，再计入 lock 内
freshness、topology、workstream 同步或扫描成本。两个阶段只能在返回前合并一次；
cold scan 不能重复累计 inspect，warm path 也不能因内存 cache 丢掉 preflight I/O；
cached checkpoint signature 的 lstat 也属于 metadata checks，必须计入 `entriesVisited`。

### 14.2 时间指标

记录 cold init、warm load、stale refresh 的多次运行中位数。时间受机器缓存影响，只作次要指标；I/O 计数是主要可重复证据。

### 14.3 局限

- fixture 不等价于真实大型仓库；
- token 使用为字符/4 估算；
- Recall@K 证明入口选择，不证明最终代码质量；
- 真实模型任务成功率应在后续 application snapshot 回归集中持续跟踪。

## 15. 迁移

- 既有 conversation 无需数据库迁移；首次 dispatch lazy initialize。
- 既有 `.ath/PROJECT.md`、`TASKS.md`、`PROTOCOLS.md` 保持原职责。
- freshness fingerprint 是 scanner 内部实现细节；外部只消费扫描结果与当前 freshness 读取，不暴露无消费者的二次包装。
- `.ath/context/` 采用独立 schemaVersion；不兼容时显式刷新。
- 删除 `.ath/context/` 可安全回到未初始化状态并重建。
