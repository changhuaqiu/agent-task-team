# Project Context Bootstrap：代码库发现、分层知识索引与增量上下文

> 日期：2026-07-20
> 状态：实施中
> 规格：`specs/project-context-bootstrap/`
> 依赖：`docs/technical/execution/context-layering.md`

## 1. 背景证据

当前执行链：

```text
ProjectCreateDialog
  → taskHubStore.createConversation
  → POST /api/mutations conversation.create
  → conversationRepo.create

RepositoryHarnessPlanner
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

- TypeScript/JavaScript：提取静态 import/export、CommonJS require、导出声明和相对模块边；
- Python：提取 import/from、顶层 class/def 和可解析模块边；
- 其他语言：通过 root manifest 与源目录形成 module-level fallback。

这是导航索引，不是编译器证明。请求排序借鉴小预算 repository map：`query overlap + entrypoint boost + normalized inbound centrality`，稳定取 Top-K，再输出相邻边。未命中时回退到入口点和高中心性模块；绝不把完整图或源文件正文塞进 prompt。

## 6. Manifest 与分层投影

`manifest.json` 是生成索引的唯一机器事实源：

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
  };
  knowledge: KnowledgeEntry[];
  freshnessInputs: Array<{ path: string; mtimeMs: number; size: number }>;
  diagnostics: ScanDiagnostics;
}
```

生成投影：

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

1. 读取 manifest；
2. 只 stat `freshnessInputs`；
3. 无变化：cache hit，不递归扫描；
4. 有变化：单飞执行 bounded scan；
5. source fingerprint 不变：保持 revision；
6. fingerprint 变化：revision + 1，原子替换 manifest 和 Markdown 投影。

freshness inputs 优先选择：

- `.git/HEAD`、`.git/index`；
- 根 marker；
- 指令文件；
- 已索引知识文档；
- 关键拓扑目录。

这是 O(k) 变更探测，k 由 manifest 限制；它不是每轮全目录搜索。

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
3. 失败则删除刚创建的 row；
4. 返回带 reason code 的失败。

创建弹窗复用当前 FolderPicker，在现有 Git 状态旁展示一行项目上下文状态，不增加新的卡片或配置区。

## 12. 安全与可观察

- 所有路径先 `resolve()` 并验证为目录。
- 所有生成目标必须位于 `<resolved-root>/.ath/context/`。
- workstream filename 使用净化 id + hash，防路径穿越和碰撞。
- 写文件使用同目录临时文件 + rename。
- 错误不包含文件内容或凭据。
- 诊断记录 cacheHit、entriesVisited、filesRead、bytesRead、selectedKnowledgeCount、durationMs、truncated。
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

旧的内部 helper 不单独形成公共 interface，也不为实现细节堆测试。

## 14. 评测设计

### 13.1 确定性代理指标

在固定 fixture 上比较：

| 指标 | 落地前 baseline | 落地后 |
| --- | --- | --- |
| entries visited | 每个 Agent 递归枚举 | 首次一次 + 后续有限 stat |
| files read | 每个 Agent 重读入口资料 | 首次建 catalog + Top-K |
| bytes read | 全量候选资料 | manifest + capsule |
| prompt chars / estimated tokens | 目录树和文档摘要堆叠 | 有预算的 capsule |
| handoff rescan | 接收方重复 | 相同 revision 直接加载 |
| relevant doc Recall@K | 不限制但高噪音 | Top-K 精确入口 |

### 13.2 时间指标

记录 cold init、warm load、stale refresh 的多次运行中位数。时间受机器缓存影响，只作次要指标；I/O 计数是主要可重复证据。

### 13.3 局限

- fixture 不等价于真实大型仓库；
- token 使用为字符/4 估算；
- Recall@K 证明入口选择，不证明最终代码质量；
- 真实模型任务成功率应在后续 application snapshot 回归集中持续跟踪。

## 15. 迁移

- 既有 conversation 无需数据库迁移；首次 dispatch lazy initialize。
- 既有 `.ath/PROJECT.md`、`TASKS.md`、`PROTOCOLS.md` 保持原职责。
- `.ath/context/` 采用独立 schemaVersion；不兼容时显式刷新。
- 删除 `.ath/context/` 可安全回到未初始化状态并重建。
