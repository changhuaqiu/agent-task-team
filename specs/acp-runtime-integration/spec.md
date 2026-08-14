# ACP 运行时统一接入

> 状态：active
> 日期：2026-07-14
> 事实源：本目录
> 替代：`docs/archive/specs/cli-bridge-layer/` 中按 CLI 分别适配的方案

## 1. 目标

Agent Task Team 使用一个 ACP 客户端驱动 OpenCode、Claude 和 Codex，停止在 daemon 中长期维护三套私有 CLI 输出解析与能力判断。

本规格一次完成三种目标运行时的接入，但每种运行时必须独立通过兼容性验收后才能删除对应旧 backend。

## 2. 已确认事实

| 运行时 | ACP 交付方式 | 启动入口 | 所有权说明 |
| --- | --- | --- | --- |
| OpenCode | 原生 | `opencode acp` | OpenCode 自带 ACP server |
| Claude | 适配器 | `npx -y @agentclientprotocol/claude-agent-acp` | ACP 组织维护，基于 Anthropic Claude Agent SDK；不是 Claude Code CLI 原生 ACP |
| Codex | 适配器 | `npx -y @agentclientprotocol/codex-acp` | ACP 组织维护，内部启动 Codex App Server；不是 Codex CLI 原生 ACP |

ACP 官方 Agents 列表将 Claude Agent 与 Codex CLI 明确标为通过 adapter 接入。适配器属于额外依赖，不能在产品或技术文档中描述成厂商 CLI 原生能力。

参考：

- <https://agentclientprotocol.com/get-started/agents>
- <https://github.com/agentclientprotocol/claude-agent-acp>
- <https://github.com/agentclientprotocol/codex-acp>

## 3. 范围

### 包含

- 引入并固定 ACP TypeScript SDK 版本。
- 实现统一 `AcpBackend`、stdio transport、ACP client callback 和事件映射。
- 建立声明式 Agent Catalog，记录 launcher、原生/适配器交付方式、版本与已验证能力。
- 接入 OpenCode、Claude 和 Codex。
- 支持新会话、可用时恢复会话、流式文本、思考、工具事件、计划、权限请求、取消、错误和完成状态。
- 保持 daemon、ContextManager、A2A 与任务编排只依赖内部 `AgentBackend` 契约。
- 为三种运行时分别完成安装、认证、会话、取消、权限、工具与错误恢复验证。
- 验收通过后删除三个 bespoke backend 及手工能力矩阵。

### 不包含

- 改写 A2A 协作语义。
- 改写 ContextManager 的上下文分层。
- 把 MCP 当成运行时控制协议；MCP 仅作为 agent 可使用的工具能力。
- 首次迭代建设远程 ACP 托管平台。
- 在用户主界面暴露“adapter/bridge/runtime/channel”等实现术语。

## 4. 目标架构

```text
daemon / dispatch / A2A / ContextManager
                    │
                    ▼
           AgentBackend（内部稳定契约）
                    │
                    ▼
              AcpBackend（唯一实现）
                    │
          ACP JSON-RPC over stdio
          ┌─────────┼──────────┐
          ▼         ▼          ▼
   opencode acp  claude-     codex-acp
      原生        agent-acp    适配器
                    │          │
                    ▼          ▼
              Claude SDK   Codex App Server
```

框架只理解 ACP 与内部 `AgentEvent`。启动差异只存在于 Catalog，不进入 daemon 分支。

## 5. 核心契约

### 5.1 Catalog

```ts
interface AgentCatalogEntry {
  id: 'opencode' | 'claude' | 'codex';
  protocol: 'acp';
  delivery: 'native' | 'adapter';
  launcher: {
    command: string;
    args: string[];
    package?: string;
    version?: string;
  };
  verifiedCapabilities: string[];
}
```

约束：

- Catalog 是启动事实源，factory 不再按 engine 写 `switch`。
- 适配器和 SDK 必须锁定版本，不使用未记录版本的隐式漂移。
- Catalog 只接受当前已验收的 runtime id；新增 runtime 必须先扩展内部 `EngineId` 并通过兼容套件。
- 能力以 ACP 初始化握手与实测结果为准，不按运行时名称猜测。

### 5.2 AcpBackend

`AcpBackend` 负责：

1. 根据 Catalog 通过 `cross-spawn` 直接启动 ACP agent；跨平台 shim 解析属于该唯一 backend 的内部实现，不另设透传 wrapper。
2. 完成初始化与认证协商。
3. 创建或恢复 session。
4. 提交 ContextManager 产出的 prompt/context。
5. 将 ACP update 映射为内部 `AgentEvent`。
6. 在 backend 边界保证事件流恰好包含一个终止 `done`；daemon 只消费该统一事件，不再次包装或补写终止事件。
7. 处理 permission、cancel、进程退出、超时和协议错误。
8. 关闭连接并回收子进程。

daemon 不解析任何厂商专有 stdout，不判断某个厂商支持哪些参数。

### 5.3 事件映射

| ACP 事件 | 内部事件 |
| --- | --- |
| agent message chunk | `text` |
| thought chunk | `thinking` |
| tool call / update | `tool_use` / `tool_result` |
| plan | `plan` 或等价结构化事件 |
| permission request | 进入统一权限策略，不得无条件静默授权 |
| prompt response | `done`，包含 stop reason |
| transport/protocol failure | `error`，包含 runtime、阶段和可定位原因 |

未知 ACP update 必须记录并安全忽略，不能导致整个 daemon 崩溃。

ACP `tool_call_update` 可以只携带 `toolCallId`，不重复 `tool_call` 中的 title/kind。`AcpBackend` 必须在单次 execute 生命周期内维护 `toolCallId → tool name`，让同一调用的 `tool_use` 与所有 `tool_result` 使用一致名称；该映射不得跨 Invocation 或 Session 共享。只有从未见过的 call id 才使用中性 `Tool` 回退，不向 UI 输出 `unknown`。

`tool_call_update.status` 必须保留到内部 `AgentEvent.tool.status`。`pending` 与
`in_progress` 只是中间状态，不得生成工具终态；`completed` 与 `failed` 必须分别
归一化为成功和失败事实，禁止把失败调用记录为完成。

ACP 文本更新是流式增量，不是独立聊天消息。daemon 可以逐 chunk 广播以保持实时反馈，但持久化时必须在单次 Invocation 内合并连续 `text` chunk；`tool_use`、`tool_result`、`error` 与 `done` 构成文本段边界，禁止把每个汉字或 token 写成一条 `chat_message`。

## 6. 权限与安全

- 复用现有账号与凭据存储，不把 token、API Key 或登录态写入 Catalog、日志和 spec。
- permission request 必须经过统一策略：允许、拒绝或请求用户确认。
- 无交互执行只能使用用户预先授权的策略；默认不采用“选择第一个选项自动授权”。
- 自主交付的 `GoalContract.authorization.allowCodeChanges=true` 是一次显式、项目范围内的预授权。平台必须把该授权冻结进当前 `WorkContract`，并可据此对项目内 ACP `edit`、Claude 原生委派和严格白名单内的本地 test/build/lint `execute` 请求选择 `allow_once`；每次决策前必须重新验证当前 Work Authority 的 contract、epoch 与 active 状态。不得选择 `allow_always`，也不得在没有有效 WorkContract、无法识别授权或策略异常时放行。
- 通用 shell 不承担外部交付动作：`git`、`gh`、网络命令、命令串联、重定向和任意解释器执行均不从 `allowCodeChanges` 获得权限。push、创建 PR、合并必须分别通过受信平台动作消费 `allowPush`、`allowPullRequest`、`allowAutoMerge`。
- 文件修改必须通过真实路径确认其最近已存在祖先仍位于 Invocation 工作目录内；符号链接或 junction 不得把授权带出项目边界。
- `allowCodeChanges` 是对受信 Agent 与当前项目代码的本地执行授权，不是针对恶意仓库代码的 OS 沙箱；测试/构建本身可以执行项目脚本。`allowPush`、`allowPullRequest`、`allowAutoMerge` 约束平台拥有的一等 Provider 动作。需要把不受信项目代码与宿主机、网络完全隔离的部署，必须另行配置平台执行沙箱，不能把 ACP 命令匹配当作安全沙箱。
- 每个 ACP permission request 及最终 allowed/denied 决策必须写入同一 Invocation 的 Runtime Event 流，以便区分“Agent 没有执行”与“平台策略拒绝”。已结束或已替换 Invocation 不得继续消费旧授权。
- Claude ACP 会话必须保留运行时原生的 `Task` / `Agent` 子代理能力，并通过 session 元数据启用 `forwardSubagentText`。ACP adapter 负责让父 turn 等待其原生子代理收敛，平台负责转发子代理输出，并按同一 `toolCallId` 的 `tool_call` / `tool_call_update` 配对将活动状态从 `awaiting_children` 恢复到 `running`；不得用“曾经调用过子代理”的粘滞布尔值阻塞 Invocation。
- 子进程继承的环境变量采用白名单或现有安全环境策略。
- 日志记录协议阶段、运行时、session/invocation 关联与错误码，不记录敏感请求正文。

## 7. 迁移策略

本规格作为一次完整实施交付，内部按以下顺序降低回归风险：

1. 建立 ACP 基础设施与 mock agent 测试。
2. 接入 OpenCode、Claude、Codex Catalog launcher。
3. 让 daemon 通过同一选择器路由 ACP/legacy，并逐个运行兼容性套件。
4. 某运行时通过验收后移除其 legacy 路径。
5. 三者全部通过后删除 factory 分支、私有解析器与手工 CapabilitySet（Architecture Subtraction Round 17 完成最终清理）。

这不是三期产品方案；所有步骤属于同一活动规格和同一次交付。临时 legacy 路径不得在规格完成后保留。

## 8. 退出条件

规格完成必须同时满足：

- OpenCode、Claude、Codex 均通过各自真实运行时 smoke test。
- daemon 对三者只有 ACP 路径。
- bespoke `claude.ts`、`opencode.ts`、`codex.ts` 及其 factory 分支已删除。
- session、cancel、permission、tool event、失败回收和进程退出有自动化测试。
- Catalog 中记录实际安装方式、固定版本和验证能力。
- `architecture/cli-integration.md` 与 `docs/wiki/04-backend-daemon.md` 已同步。
- 安装、类型检查、构建和相关测试通过。

## 8.1 健壮性加固契约

ACP 是长生命周期 daemon 启动的外部进程边界，不能假设 adapter、SDK、stdio 或消费者始终正常。运行时必须满足：

1. **启动可复现**：adapter 的实际 launcher 参数必须包含精确版本，不能只在 Catalog 元数据中记录版本后仍让 `npx` 拉取 latest；Catalog 加载时必须校验重复 id、空命令、协议类型和 adapter 版本一致性。
2. **权限 fail-closed**：默认权限策略为拒绝。只有服务端显式配置 `allow_once` 或提供策略函数时才能授权；不得选择 `allow_always` 作为隐式降级，也不得在策略异常或超时时继续执行。
3. **一次性终结**：每轮执行只有一个 finalize owner。成功、协议失败、spawn 失败、超时、调用方取消、输出过载和进程异常退出都必须在有界时间内解析 `result`、关闭事件流并释放并发配额，不能依赖子进程必然触发 `close`。
4. **分级取消**：先发送 ACP `session/cancel`，再发送进程树 `SIGTERM`；宽限期后升级为强制终止。daemon shutdown 必须取消全部在途 run。
5. **资源有界**：限制全局并发 run 数、待消费事件数、单事件字符数、累计文本输出和 stderr tail；超过上限时以稳定 reason code 失败并回收进程。
6. **诊断不泄密**：stderr 只保留有界、脱敏的尾部用于失败定位；正常执行不把原始 stderr 逐块写入日志。
7. **临时状态可回收**：OpenCode fallback config 和 Codex 隔离 home 均写入受控临时目录，权限尽可能收紧，cleanup 幂等；不得修改用户项目中的 `opencode.json`。
8. **重试不重复副作用**：已有 runtime session id 时必须尝试 `session/load`；握手不支持或加载失败均失败关闭，不得静默 fresh-session 重放 prompt。
9. **空闲与总时长分离**：`ExecOptions.timeout` 表示无 ACP 协议活动的 idle timeout，任意 session update（包括不展示的 usage/plan update）均续期；另设独立 hard max turn timeout，防止持续产生无效更新的进程无限占用资源。
10. **原生工具不重复拦截**：daemon 判断 runtime 原生工具时大小写无关；`Read/Write/Bash` 与 `read/write/bash` 语义相同，不得作为平台自定义工具再次调用。
11. **流式增量不是消息边界**：实时 socket 保留增量，聊天持久化按 Invocation 合并连续文本；工具和终止事件会关闭当前文本段。

该契约参考 OpenClaw 的工程原则：活跃 run 使用可取消控制器、会话/并发有上限、超时后执行 bounded cleanup、流式输出设置字符上限、权限与配置异常 fail-closed。这里复用原则，不引入 OpenClaw 的 Gateway 或 session store 实现。

## 9. 风险

| 风险 | 处理方式 |
| --- | --- |
| Claude/Codex 适配器随上游变化 | 锁版本；兼容升级必须重新运行该运行时套件 |
| ACP 能力与旧 CLI 行为不完全等价 | 以能力握手和真实 smoke test 为准；未过门禁不删除该 legacy backend |
| permission 语义差异 | 统一映射到项目权限策略并覆盖拒绝、确认和无交互场景 |
| 子进程泄漏或取消失效 | 为 cancel、超时、异常退出与 daemon shutdown 建立集成测试 |
