# Project Context 当前实现

> 状态：已实现
> 更新：2026-07-21
> 长期设计：`docs/technical/execution/project-context-bootstrap.md`
> 评测：`docs/technical/evaluation/2026-07-20-project-context-bootstrap-evaluation.md`

## 入口与职责

`src/server/project-context/` 是真实代码目录与 ContextManager 之间的项目理解模块。外部调用只使用：

```ts
projectContextService.prepare(input)
```

- `inspect`：只读识别 codebase、empty、existing context 或容器目录。
- `initialize`：项目创建时建立/复用共享索引并注册当前 workstream。
- `load`：Harness 每次 dispatch 的热路径；命中 freshness checkpoint 时不重读源文件。
- `refresh`：显式重建，也用于从损坏或不兼容的 manifest 恢复。
- `rollback`：创建链失败后的内部补偿，移除幽灵 workstream。

`src/server/project-context/context-contributor.ts` 是唯一 Harness 注入点。没有项目路径时，它返回 required 约束，禁止 Agent 扫描宿主 cwd。

## 生成布局

每个 codebase 使用 `<root>/.ath/context/`：

```text
manifest.json                 共享 revision、catalog、freshness、topology digest
.manifest-checkpoint.json     完整 manifest digest；独立发布的恢复门
.project-context-owner.json   生成器 ownership；防止覆盖用户已有内容
topology.json                 有界机器代码图
INDEX.md                      六层阅读入口
project/*.md                  identity、architecture、topology、development 投影
knowledge/catalog.md          owner 文档元数据
workstreams/*.json            conversation 白名单投影
workstreams/INDEX.md          未受信任的冲突标签
```

这些文件都是可删除重建的 read model。README、AGENTS、standards、spec、架构文档和源代码始终是 owner source。

## 每次 dispatch 如何工作

```text
conversation.project_path
  → inspect root
  → 验证独立 manifest integrity checkpoint 与 topology digest
  → 完整 freshness 覆盖且未变化：warm load
  → 否则：有界扫描并最后提交 manifest
  → 按 request 选择 repo map、适用规范与 Top-K 知识
  → ContextManager 记录 project-context fragment revision/evidenceRefs
```

同路径的 conversation 共享 codebase revision，但只看到其他 active workstream 的净化后标题、状态和短目标。聊天、任务、session、handoff body 和 Agent 轨迹不进入共享投影。

## 安全与一致性边界

- 不向所选 root 的父目录搜索，不跟随扫描树中的链接。
- `.ath/context` 任一级不得是符号链接或 junction；生成目标同时校验 lexical path 与 realpath。
- inspect/warm read 同样校验祖先目录和父目录 realpath，不能借链接读取项目外 manifest。
- 首次只认领空 context 目录；缺少有效 ownership marker 时不覆盖任何已有文件。
- 文件以 no-follow handle 读取，并核对读取前后身份。
- 同 root 更新使用进程内 single-flight 与跨进程锁；topology/投影先写，manifest 次之，独立 integrity checkpoint 最后写。
- 磁盘 manifest 必须通过独立的完整内容 SHA-256 checkpoint，防止 command、summary、applyTo 等派生字段脱离 owner source 后仍被标记为 explicit/trusted；owner-source 路径还必须是规范化仓库内相对路径并与 file freshness 对应。checkpoint 缺失/不一致、绝对路径、`..`、drive-relative、反斜杠、symlink/junction 或 realpath 越界都拒绝。
- workstream 文本移除控制字符并限长，放入显式 untrusted JSON envelope。
- 路径级 instruction 的 `applyTo` 同时约束规范段与知识 Top-K。
- freshness 无法完整覆盖时不允许 warm cache，下一次继续有界刷新。
- 同一服务进程只有在 ownership/manifest/integrity-checkpoint 文件签名未变时才可用已验证缓存跳过大 manifest 的重复分类读取；签名 metadata checks 仍计数，签名变化或进程重启首次恢复仍执行完整读取与校验。
- root 目录本身纳入 freshness，根目录新增源码也会刷新 topology。

## 客户端首轮派发门

页面正常路径只有在 conversation、accounts、Agent roster、当前 Team Pack、active roles 与 runtime profile 全部完成解析后才设置 `hasHydrated=true`。整个 `loadFromServer()` 是 single-flight，Strict Mode 风格的重叠调用复用同一个 Promise，不能互相覆盖。这个门保证新开页面的第一条消息不会在 Harness 之前被误判为 `no_runtime_profile`。gate 内所有被等待的远程请求都把 fetch、状态验证和 JSON body 解析统一纳入 15 秒超时与 AbortController；即使 headers 已返回但 body 永久 pending，也会退出 skeleton、设置 `runtimeHydrationError` 并显示可重试告警。因此 `hasHydrated` 表示“本轮尝试已结束”，不是单独的 runtime-ready 证明；重试会重新关闭交互门并执行同一原子水合流程。

开发态修改 daemon contributor 或 Context Planner 后，必须使用全新服务进程做 live E2E。Next.js 热更新不会替换已经挂在 Socket.IO server 上的旧 daemon 单例；继续复用旧进程可能出现“API 已生成 context，但真实 Agent prompt 没有 capsule”的假成功。

## 验证

```bash
node node_modules/vitest/vitest.mjs run src/server/project-context
npm run eval:project-context
npm run eval:project-context:live -- <candidate/baseline paths and conversation ids>
```

benchmark 的确定性主指标是 files/bytes read、prompt chars、Recall@5、revision reuse 与 owner hash；其中 I/O 必须覆盖完整 `prepare()`，包含前置 inspect 的 owner/manifest/checkpoint/workstream 读取，不能只统计 lock 内阶段。耗时只作受机器环境影响的次要指标。它不能替代真实 Agent 的 E 级成对实验。

2026-07-21 的 live verification 在隔离服务上通过两个真实 Claude invocation：空目录 `empty/r1/0 modules`，已有代码目录 `codebase/r1/11 modules/15 edges`。验收同时核对 canonical project path、manifest、invocation prompt、完整 `context.assemble` snapshot/ref、持久化 tool-use 消息、observation spans 和 Agent 结构化回答；原始证据见 `docs/technical/evaluation/data/project-context-live-e2e-20260721.json`。
