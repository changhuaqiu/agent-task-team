# 结构化上下文管理架构

> 日期：2026-07-17  
> 状态：有效·C0 已落地；后续阶段保持迭代，不替代 `specs/context-manager/`  
> 范围：Agent Team 平台 Harness 的上下文控制面；面向 ACP runtime，但不绑定 Claude / Codex / OpenCode  
> 配套方框图：[`structured-context-management-architecture.html`](structured-context-management-architecture.html)

## 1. 结论

当前方向是对的，但抽象还少一层。

已经成立的基础包括：

- `ContextManager` 是统一组装入口；
- `scenario × archetype × cluster` 能区分 init、handoff、wakeup、closure 等执行场景；
- `ContextFragment/ContextArtifact` 的结构化 `scope/visibility/delivery` 已有类型与 Registry 边界测试；
- Team Log 已使用游标提供按 Agent 的增量上下文；
- A2A 已有结构化交接包，而不是只依赖完整聊天历史。

真正的缺口不是“再加几个 Layer”，而是当前模型仍把以下问题混在一起：

1. 这是什么内容；
2. 谁拥有这条事实；
3. 多久变化一次；
4. 什么时候需要交给模型；
5. 旧内容如何失效；
6. 多 Agent 并发时要求强一致、因果一致还是最终一致。

建议保留现有场景矩阵，但把上下文核心升级为：

> **Context Artifact（结构化事实） → Policy（选择策略） → Context Compiler（编译） → Runtime Envelope（交付）**

其中“静态 / 稍微变化 / 一直变化”属于生命周期维度，不应继续和 identity、tool、task、dialog 等语义类别绑死。

## 2. 外部实践给出的共同信号

### 2.1 最小高信号上下文，而不是尽量装满

Anthropic 将 context engineering 定义为每次推理前持续选择最有用 token，并强调上下文越长并不等于效果越好。其长期 Agent 实践主要使用：压缩、结构化笔记、子 Agent 隔离，以及 just-in-time 检索。

对本项目的含义：

- ContextManager 应做编译和选择，不应只是把多个字符串拼起来；
- 大正文、历史工具输出和探索轨迹应留在外部存储，以引用和按需读取进入上下文；
- 子 Agent 返回的是凝练结果与证据引用，不是完整轨迹。

参考：

- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

### 2.2 工具定义不是普通 Prompt 文本

Anthropic 的工具上下文方案把工具定义、system、messages 视为不同前缀；大量工具推荐按需发现，而不是全部注入。MCP 则通过 `tools/list`、分页与 `tools/list_changed` 明确表达工具目录及变更。

对本项目的含义：

- 工具可调用性的事实源必须是 ACP/MCP runtime 注册结果；
- Prompt 只提供能力选择提示，不能虚构工具已注册；
- 工具目录需要稳定排序、revision/hash 和变更事件；
- Skill 应优先注入摘要或索引，正文按需加载。

参考：

- [Claude Platform: Manage tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)
- [Claude Platform: Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
- [MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools)

### 2.3 运行态上下文与模型可见上下文必须分开

OpenAI Agents SDK 明确区分本地运行上下文与发送给 LLM 的上下文；handoff 也允许过滤输入历史、只传结构化元数据或摘要。

对本项目的含义：

- 凭据、数据库句柄、调度器对象、审批状态等只能留在 Harness runtime context；
- 模型只接收完成当前动作所需的最小投影；
- A2A packet 是模型上下文投影，不是平台完整状态的复制。

参考：

- [OpenAI Agents SDK: Context management](https://openai.github.io/openai-agents-python/context/)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)

### 2.4 多 Agent 的核心是上下文隔离与产物汇聚

Anthropic 和 LangChain 的多 Agent 实践都强调：子 Agent 使用独立上下文完成深度工作，只把凝练结果返回协调者。A2A 协议也把 `contextId`、Task、Message、Artifact 分开，而不是把“上下文”约等于聊天记录。

对本项目的含义：

- 共享的是目标、任务状态、决策、验收证据和产物；
- 隔离的是 Agent 自身对话、工具轨迹、思考和探索死路；
- Task Graph / Artifact 是共享黑板，聊天只是一类事件源；
- handoff 必须带因果父节点和源 revision，避免接收方读到过期状态。

参考：

- [LangChain: Subagents and context engineering](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)
- [A2A Protocol specification](https://a2a-protocol.org/dev/specification/)

## 3. 建议的六维上下文模型

每条可进入模型的内容都表示为 `ContextArtifact`。六个维度彼此正交。

| 维度 | 回答的问题 | 示例 |
| --- | --- | --- |
| `semantic` | 这是什么 | identity / protocol / capability / task / decision / interaction / artifact-ref |
| `source` | 谁拥有事实 | role-card / task-graph / a2a / message-log / tool-registry / memory |
| `lifecycle` | 多久变化、如何失效 | static / versioned / event / snapshot / ephemeral |
| `visibility` | 谁能看到 | project shared / task scoped / agent private / restricted |
| `consistency` | 多 Agent 需要何种一致性 | strong / causal / eventual |
| `delivery` | 何时、以什么形式交付 | bootstrap / on-change / always / delta / jit-reference |

建议契约：

```ts
interface ContextArtifact {
  id: string;
  semantic: ContextSemantic;
  payload?: unknown;
  reference?: { uri: string; mediaType?: string };

  source: {
    provider: string;
    owner: string;
    revision: string;
    observedAt: string;
    contentHash?: string;
  };

  lifecycle: {
    class: 'static' | 'versioned' | 'event' | 'snapshot' | 'ephemeral';
    expiresAt?: string;
    invalidates?: string[];
  };

  visibility: {
    scope: string;
    private: boolean;
    audience?: string[];
  };

  consistency: 'strong' | 'causal' | 'eventual';

  delivery: {
    mode: 'bootstrap' | 'on_change' | 'always' | 'delta' | 'jit';
    channel: 'tools' | 'system' | 'message' | 'reference';
    required: boolean;
    importance: number;
    maxTokens?: number;
  };
}
```

`category` 仍然可以扩展，但不能再独自承担选择策略。相同的 `task` 语义可能有不同生命周期：任务定义是 versioned，任务状态是 snapshot，任务通知是 event。

## 4. 四类生命周期与交付策略

### 4.1 S0：静态系统态

内容：平台安全边界、角色身份、不可变协作原则、输出契约。

策略：

- 新 session `bootstrap`；
- 使用 `revision + contentHash` 形成稳定前缀；
- revision 未变不重复生成；
- revision 变化时显式失效旧 bootstrap。若 runtime 不支持中途更新，则新建或迁移 session，不能静默沿用旧规则。

注意：静态不等于永远不变，而是“变化必须显式版本化”。

### 4.2 S1：低频版本态

内容：TeamPack、项目规范、Skill 索引、工具目录、DoD、角色能力配置。

策略：

- `on_change` 注入摘要；
- 大正文和 Skill 内容使用 `jit-reference`；
- 工具能力以 runtime/MCP 注册为事实源；
- `tools/list_changed` 或 registry revision 触发重新编译 capability section；
- 稳定排序以提高各 runtime 的缓存命中率。

### 4.3 S2：工作状态快照

内容：Task Graph 当前状态、当前 possession、开放决策、阻塞、验收状态、产物索引。

策略：

- 每次 dispatch 读取一致快照；
- 相同对象按 key 替换，而不是把历次状态持续追加；
- Task/possession 使用 strong consistency；handoff 使用 causal consistency；
- envelope 携带 `sourceRevisions` 和 `watermark`。

这是 Agent 当前“应该做什么”的主要事实面。

### 4.4 S3：高频交互流

内容：当前用户输入、当前 A2A 指令、未消费 Team Log、近期自身对话、短期工具结果。

策略：

- 当前触发 `always`；
- 其他交互按 Agent 游标 `delta`；
- 旧工具结果优先清理或替换为引用；
- 达到阈值后把交互流压缩为结构化 checkpoint，而不是无限保留摘要套摘要。

Team Log 已经是这一策略的第一个正确实现。

## 5. 多 Agent 上下文拓扑

平台需要三个逻辑空间，而不是一个“大共享 Prompt”。

### 5.1 Shared Blackboard

共享目标、Task Graph、决策、验收证据和 Artifact 索引。由各领域仓库拥有，Context Manager 只读投影。

### 5.2 Private Working Set

每个 Agent 的近期对话、工具轨迹、临时笔记和思考。默认不跨 Agent 传播；只有显式提炼出的 decision/evidence/artifact 才能晋升到共享黑板。

### 5.3 Structured Handoff

交接包至少包含：

```ts
interface HandoffEnvelope {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  requestedAction: string;
  acceptanceCriteria: string[];
  decisions: Array<{ id: string; summary: string; revision: string }>;
  evidenceRefs: string[];
  artifactRefs: string[];
  constraints: string[];
  openQuestions: string[];
  causalParent: { chainId: string; passId: string };
  sourceRevisions: Record<string, string>;
}
```

它不携带完整 transcript。接收方如果需要细节，通过引用按需读取。

## 6. Context Compiler 流程

```text
DispatchRequest
   │
   ▼
读取各 Source Manifest（只取 revision / hash / watermark）
   │
   ▼
与 Agent Context Checkpoint 比较，得到 changed / unseen / stale
   │
   ▼
可见性 + authority + consistency 校验
   │
   ▼
Delivery Policy：bootstrap / on-change / snapshot / delta / JIT
   │
   ▼
预算编译：required floor → utility ranking → dedupe → render
   │
   ▼
Runtime Envelope
  ├─ tools：真实注册的工具 schema
  ├─ system：稳定系统态 + 低频变更段
  ├─ message：当前快照 + 交互 delta
  └─ references：可按需读取的文件 / artifact / memory URI
   │
   ▼
ContextReport + CheckpointPatch
```

`ContextManager` 可以继续保持近似纯函数：Checkpoint 由独立 repository 提供，编译结果只返回 `CheckpointPatch`，由 Harness 在成功 dispatch 边界提交。这样既支持状态化增量，又不把存储副作用塞进组装核心。

## 7. 预算策略

当前 `system/tool/project + importance` 是好起点，但需要从“整个 layer 保留或丢弃”演进为配额与效用模型。

建议顺序：

1. `required=true` 的安全边界、当前动作、possession 和验收条件先满足最低配额；
2. 对 versioned 内容去重，只保留变化段；
3. snapshot 替换旧 snapshot；
4. delta 按游标截取；
5. 其余按 `relevance × recency × authority × importance / tokenCost` 排序；
6. 大内容退化为 reference，而不是直接消失；
7. 报告每项为何 included / omitted / referenced / stale。

当前预算编译已落实 required floor：system 层按既有规则处理后，所有 required
tool/project part 先于可选 part 竞争剩余预算；可选工具或项目上下文不得挤掉
required Project Context、当前用户动作或交接内容。若 required 内容自身仍无法装入
预算，则继续 fail closed，并通过 `missing-required` 与 `budget_trimmed` 暴露原因。
required Skill 保留既有 `required_skill_not_loaded` 专用 reason code，但同样先参与
required floor，并在自身无法装入时 fail closed。

不能继续把“system 永不裁”理解为可无限增长。正确约束是：system 必须有独立硬预算，超过预算属于配置错误，应在 dispatch 前失败或降级，而不是带着 overflow 继续运行。

## 8. 当前实现对照

| 当前实现 | 判断 | 目标动作 |
| --- | --- | --- |
| `ContextManager` 单入口 | 保留 | 升级为 compiler facade |
| `scenario × archetype × cluster` | 保留但降级 | 只作为 policy 输入，不直接等同生命周期 |
| `ContextArtifact` | 当前统一模型 | 保留结构化 scope/visibility/source/lifecycle/delivery，并在 Registry 强制执行 |
| Context Registry | 保留 | 已统一 scope、visibility、freshness；继续扩展 authority、consistency 校验 |
| Team Log cursor | 正确样板 | 泛化为 per-agent Context Checkpoint |
| `A2AHandoffPacket` | 正确方向 | 补 acceptance、artifact refs、causal parent、source revisions |
| Skill 全量层 | 可能重复 | 改为摘要索引 + JIT 内容 |
| Tool 文本层 | 已有注册过滤 | 最终由 ACP/MCP 工具目录直接交付 |
| systemPrompt 仅首次注入 | 缺少失效机制 | bootstrap fingerprint + on-change invalidation |
| protocol 每轮重复 | 安全但成本高 | 拆成稳定规则 + 当前场景 hint |
| history 最近 10 条 | 仍是窗口截断 | self delta + structured checkpoint + reference |
| `ContextContributor` | 当前唯一来源扩展 seam | 未来 durable memory 有真实 owner 后复用，不预留专用 NoOp adapter |
| `ContextReport` | 已补 Snapshot id、Artifact revision、omission、missing-required 与 Skill delivery evidence | 后续补 cache key 与 checkpoint |

当前实现以 `ContextFragment` 作为 Contributor 接入格式，在 Registry 边界归一化为六维 `ContextArtifact`，再进入 scenario、预算和 Snapshot 管线。project/global scope、agent/role/team visibility、freshness 和 required 已成为机械门禁；consistency 当前完成分类，强一致读模型与 checkpoint 仍属于后续阶段。

## 9. 可迭代落地路线

### C0：统一 Artifact 契约、选择门禁与可观测（已完成）

- 定义 `ContextArtifact`、`SourceRevision`、`DeliveryDecision`；
- 用 adapter 把现有每个 layer 包装成 artifact；
- `ContextReport` 记录 source、revision、lifecycle、delivery reason；
- 加入上下文清单调试视图：实际给了什么、为什么给、从哪来、是否过期。

完成标志：现有 Agent Loop 行为不变，但每个 token 块都有结构化来源和决策证据。

落地证据：

- `src/lib/agent-context/context-contracts.ts` 定义 Fragment、六维 Artifact、Query、Contributor 与 Snapshot；
- `src/lib/agent-context/context-registry.ts` 负责同步/异步失败隔离、结构校验、归一化、去重、scope/visibility/freshness 门禁；
- `ContextManager` 保持唯一组装入口；四个 Tier renderer 直接产出原生 Fragment，与真实业务 Contributor 统一送入 Artifact 管线；
- Task Graph 上下文从 SQLite read model 读取 `updated_at` 原生 revision，Team Log 使用已消费水位作为 delta revision；
- `context.assemble` observation span 保存完整 `ContextReport`，现有“Agent 调试”执行记录显示来源、revision、生命周期、通道、结果与 reason code；
- 2026-07-19 定向验证覆盖跨项目 Task、全局伪装、私有/角色可见性、过期、重复版本、异常脱敏、场景省略和 required fail-closed；全量结果以当次迭代验证记录为准。

2026-07-19 的生产边界复审进一步冻结以下规则：

- 无 `conversationId` 的历史消息不再作为“可能属于当前项目”的兼容数据注入，而是与跨项目消息一样 fail closed；
- Contributor 的注册 id 是可信生产者身份，Fragment 不能通过自报 `producer` 冒名，未注册的 required Contributor 也必须被报告为缺失；
- ContextManager 先生成 assembly snapshot，Daemon 在 transport、workdir 指令和 system prompt 通道确定后再生成 runtime snapshot；调试 UI 以 runtime snapshot 为本轮实际输入凭证；
- assembly manifest 包含 Fragment 的 `kind / semantic`，runtime manifest 额外包含 prompt、system prompt、transport 与投递通道摘要；
- OpenCode 选择 `instructions` 文件作为 system context 通道后，ACP prompt 不再重复内联同一内容。

### C1：稳定态 / 版本态 / 动态态分流

- 新增 `agent_context_checkpoint`；
- system bootstrap fingerprint；
- TeamPack / protocol / skills / tools 使用 on-change；
- Task Graph 使用 snapshot revision；
- Team Log delta 接入统一 checkpoint。

完成标志：无变更的低频内容不重复编译；规范变化能在下一次 dispatch 被检测并处理。

### C2：Runtime Envelope 正式分通道

- tools 只走 ACP/MCP 注册；
- system 放稳定前缀；
- message 放当前工作快照和交互 delta；
- reference 提供文件、Artifact、记忆的按需入口。

完成标志：Prompt 不再宣称工具能力；工具目录变更可观测且可失效。

### C3：压缩与 JIT

- 清理旧 tool results；
- 对长交互生成结构化 checkpoint；
- Skill / 大 Artifact / 历史正文按需读取；
- durable memory 先在独立规格中确定 owner、持久化与恢复契约，再以普通 `ContextContributor` 接入读取结果并经过 Artifact policy。

Skill 的 C3 落地由 `specs/skill-package-progressive-loading/` 负责。第一阶段先采用“Agent 绑定即激活”，由平台确定性编译 `SKILL.md` 正文并只暴露附属资源引用；在加载证据稳定后，再把候选 Skill 与本轮激活 Skill 分离。

完成标志：长任务中上下文增长趋于有界，压缩前后关键任务状态可回归验证。

### C4：分布式一致性

- Task/possession 强一致读取；
- handoff 携带 causal parent 与 source revision vector；
- stale handoff 拒绝或重新编译；
- 多节点 checkpoint 与投影具备幂等提交。

完成标志：跨节点、并发 Agent 不会因为旧快照重复执行或覆盖新状态。

## 10. 本轮建议冻结与暂不冻结

建议现在冻结：

- 六维 Artifact 元数据；
- 四类生命周期；
- Runtime Envelope 四通道；
- shared blackboard / private working set / structured handoff；
- checkpoint 在成功 dispatch 边界提交。

暂不冻结：

- importance 的具体默认值；
- 何时触发 LLM summary；
- tool search 的数量阈值；
- memory 存储技术；
- 各 runtime 的缓存实现细节。

这些参数必须用 ContextReport、成本、任务成功率和真实多 Agent 回归数据迭代，不能在架构阶段写死。

## 11. 已确认决策与 Task Graph 审计结论（2026-07-17）

1. **已确认**：规范或角色 revision 改变时，必要情况下允许重建底层 ACP session。
2. **已确认**：先实施 C0，只增加结构化清单、source revision 和可观测，不改变现有 prompt 行为。
3. **Task Graph 暂不冻结为唯一事实源**：SQLite `task` 表是当前运行时读取权威；`task_action` 仍是不完整解释日志；`TASKS.md` 仍能双向写入。Context C0 只读 SQLite snapshot。待正式平台任务工具覆盖全部 runtime、所有 mutation 产生完整 action/proof 后，`TASKS.md` 才退为只读投影，Task Graph 再升级为 shared blackboard 的唯一任务事实源。
