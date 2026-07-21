# 项目上下文初始化：从“选一个目录”到“接手一个可理解的项目”

> 日期：2026-07-20
> 状态：已决策，已实现
> 已归档规格：`docs/archive/specs/project-context-bootstrap/`

## 用户问题

用户在同一个本地目录创建工作项目时有两种常见情况：

1. 该目录已经有其他工作项目在推进；
2. 该目录还没有任何工作项目，甚至还没有形成代码结构。

当前产品只保存目录路径。Agent 接到任务后不知道该目录的项目边界、文档入口、技术栈、命令、当前工作项目，也不知道是否有其他团队正在修改同一代码库，于是每次都从递归搜索开始。交接给另一个 Agent 后，同样的探索再次发生。

这不是“让 Agent 搜索得更快”的问题，而是项目创建没有完成真正的项目初始化。

## 目标用户与核心场景

- 用户：把一个软件目标交给 Agent 团队持续推进的开发者或项目负责人。
- 核心场景：新建工作项目、复用已有代码库、空目录起新项目、同一代码库多目标并行、Agent 间交接。
- 成功标准：用户仍只需选择目录并描述目标；系统自动建立或复用项目上下文，Agent 直接从正确入口开始工作。

## 产品对象

### 代码库

用户选择的物理代码目录。它拥有共享的结构、规范、命令和知识入口。

### 工作项目

Agent Task Hub 中的一次目标推进，对应一个 conversation。多个工作项目可以共享同一个代码库，但任务、消息、责任和交接轨迹彼此隔离。

### 项目上下文

系统为代码库生成的紧凑索引。它不是新的权威文档，而是帮助 Agent 找到权威事实的入口。

对代码项目，它必须按六层组织：范围与身份、规范与约束、架构与代码 Topology、开发与运行、当前工作与交接、知识与证据。每一层都记录来源和失效条件，不能把“整理了几个 Markdown”当作初始化完成。

### 知识条目

已有 README、AGENTS、架构文档、开发说明、活动 spec 等资料的元数据索引。Agent 先看到相关条目，再按需打开原文。

## 采用方案

项目创建时自动执行目录检查：

- 已有项目上下文：直接复用，并注册新的工作项目；
- 没有项目上下文：自动初始化；
- 空目录：以“尚无代码结构”的明确状态初始化；
- 所选目录只是多个独立代码项目的容器：阻止创建，提示选择具体项目目录。

创建弹窗不增加复杂配置，只在目录下方展示一行状态。用户不需要理解 manifest、fingerprint、runtime 或 contributor 等实现概念。

## 同目录并行的共享边界

同一代码库的工作项目共享：

- 入口、模块、符号和依赖边组成的代码 Topology；
- 带作用域和优先级的项目规范、硬约束和文档入口；
- 构建、测试、开发命令；
- 其他 active 工作项目的标题、状态和短目标摘要。

不共享：

- 聊天内容；
- 任务明细；
- Agent 私有轨迹；
- 未经交接的中间推理；
- 其他工作项目的完整验收材料。

目的不是合并多个项目，而是让团队知道“同一块代码区还有谁在工作”，减少冲突。

## 主流程

```text
选择代码目录
  → 系统检查目录
  → 展示“将自动初始化”或“已找到并复用”
  → 创建工作项目
  → Agent 获得紧凑项目入口
  → 按任务只读取相关权威文档
```

## 放弃的方案

### 每次任务都递归搜索

重复 I/O、重复 token、重复判断，且不同 Agent 可能得出不同项目边界。

### 自动生成并覆盖 README/AGENTS/docs

会制造第二事实源，也可能破坏用户维护的文档。生成内容只能是可重建索引。

### 把所有文档一次性注入

与文章指出的注意力稀释问题相同：上下文更大不等于有效信息更多。

### 把其他工作项目的完整上下文共享

会破坏 conversation 隔离并扩大泄漏和误修改风险。只共享最小冲突信号。

## 外部实现参考

- [OpenAI 对 Codex agent loop 的说明](https://openai.com/index/unrolling-the-codex-agent-loop/)：从 Git root 到 cwd 分层加载 AGENTS 指令，并设置总量上限。
- [Claude Code memory](https://docs.anthropic.com/zh-CN/docs/claude-code/memory)：项目、用户和局部层级记忆，以及文件导入机制。
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)：仓库级、路径级与最近 AGENTS 指令组合。
- [AGENTS.md 开放格式](https://agents.md/)：大型仓库使用嵌套 AGENTS.md 给子项目提供更近的指令。
- [Aider repository map](https://aider.chat/docs/repomap.html)：在小 token 预算内提供相关代码库地图，而不是加载所有文件。
- [Sourcegraph code navigation](https://sourcegraph.com/docs/code-navigation)：用定义、引用和依赖关系导航代码，并明确启发式搜索与精确索引的能力边界。
- [Backstage TechDocs](https://backstage.io/docs/features/techdocs/creating-and-publishing/)：文档与代码共同演进，生成/发布视图不替代仓库中的 owner docs。

## 对技术实现的约束

- 项目上下文只能指向权威事实，不能替代权威事实。
- 初始化与加载必须有稳定 reason code。
- 同一路径共享只允许最小代码库事实和冲突摘要。
- Agent 的正确路径应是“先读入口，再按需展开”；全量搜索是最后手段。
- Topology 必须表达入口、模块、导出符号与依赖边，并在 prompt 中按任务压缩；单纯目录树不算代码地图。
- 效率提升必须通过可重复评测证明，不能只凭主观感受。
- 同目录工作项目的标题和目标属于未受信任的冲突标签，不能变成 Agent 指令；系统必须清理控制字符并显示信任边界。
- 目录内已有损坏上下文、生成目录指向外部位置或 freshness 无法完整覆盖时，系统优先报错/重建，不把“看似快速”置于正确性之前。
