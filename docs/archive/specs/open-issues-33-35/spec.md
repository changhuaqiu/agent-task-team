# 线上 Issues #33–#35 修复规格

> 状态：implemented
> 范围：A2A 分派意图、首次交接上下文、默认 TeamPack 升级、上下文分层去重
> 关联 issue：#33、#34、#35

## 1. 目标

本规格把当前开放的三个线上 issue 收敛为可复现、可验证的修复闭环：

1. 明确的「分派/拆给 @agent 做某项工作」必须产生可执行 A2A pass，不能降级为纯通知。
2. 首次进入项目的 A2A 接收方必须同时获得身份 bootstrap 与 A2A 交接包。
3. 默认 TeamPack 的源码预设升级后，已有数据库副本必须可重复、无损地收敛到新结构。
4. prompt 中每项职责和资源定位只保留一个权威表达，避免错误路径与重复指令。

## 2. 问题真实性结论

| Issue | 结论 | 复现依据 |
| --- | --- | --- |
| #35 | 真实运行时 bug | `context-planner` 对所有 A2A 固定选择 handoff；`scenarioResolver` 又让 handoff 优先于首次唤醒，导致无 active session 时仍省略 identity/system prompt。 |
| #34 B1/B2 | 真实持久化升级 bug | 静态预设已是 4 人，但 `seedTeamPacks()` 不更新 workflow、communication matrix、roles/snapshots，线上 DB 仍保留 toad/yoshi 和旧 persona。 |
| #34 B3 | 真实设计缺陷 | protocol layer 硬编码相对 `.ath/TASKS.md`，与 runtime 注入的绝对会话路径冲突。 |
| #34 B4/B5 | 真实分层缺陷 | 分派职责分散在 role/teamPack/protocol，A2A 使用判断同时存在于 collaboration/protocol/behavior。 |
| #33 R2/R4 | 真实运行时 bug | pass-intent 缺少“分派/拆给/安排”等高频表达且只扫描 mention 后片段；协议没有限定自动 wakeup 仅适用于已建模 Task Graph。 |
| #33 R1 | 真实能力缺口 | 平台没有把显式 `PR #N` 解析为上下文 artifact，也没有结构化记录解析不可用/失败。 |
| #33 R3 | 真实语义缺口，但不新增 possession 状态 | “知会/准备”属于群聊通知平面，不代表持球或执行；正式建模为 informational notification，不能伪装成 A2A pass。 |

## 3. 设计契约

### 3.1 首次 A2A = bootstrap 场景 + handoff 来源

- `trigger` 描述输入来源，`scenario` 描述注入策略，两者不得强绑定。
- 任意来源只要目标 agent 在项目内没有 active session，就属于 `init` 注入场景。
- A2A 来源仍保留 `a2aHandoff` artifact；因此首次 A2A 同时包含 system prompt 与交接 focus。
- 已有 active session 的 A2A 仍走 `handoff`，不重复注入身份。

### 3.2 默认 TeamPack 是受管预设

- `PRESET_TEAM_PACKS` 是默认预设结构的权威来源。
- seed 必须是幂等 reconciliation，而不是只在不存在时创建。
- reconciliation 更新 workflow、communication matrix、角色文案和 role-card snapshot，并删除已从预设移除的角色。
- 用户绑定的 `accountIds` / `skillIds` 按同名角色保留，避免升级清空配置。
- metadata 与 roles 的替换必须处于同一数据库事务；任一角色写入失败时整体回滚，受管数据保持 `isPreset=true`。
- communication matrix 的所有引用必须属于当前 roles 集合。

### 3.3 Prompt 分层唯一职责

- role layer：只描述角色身份、职责和角色特有的工作边界。
- teamPack layer：只描述团队结构、workflow 与通信权限；不重复角色分派步骤。
- protocol layer：只描述 Task Graph/TASKS 格式、状态规则和平台边界；不声明相对资源路径，不重复 planner 职责。
- collaboration layer：唯一负责解释“状态更新 / 信息通知 / A2A 执行动作”的选择。
- behavior layer：只保留通用收尾与用户确认要求，不重复 A2A 判断。
- runtime 是会话文件绝对路径的唯一提供者。

### 3.4 明确分派、通知与自动 wakeup

- intent 扫描必须支持动作位于 mention 前或后的局部语句，并覆盖“分派、分发、安排、拆给”等高频词；逗号、分号和句末标点是动作绑定边界，不能跨分句借用动作词。
- 同一语句内的动作可绑定多个目标 mention；纯花名册、完成态、“知会”或针对该目标的前置/后置明确否定（如“不要”“不用执行”“请勿”）不得唤醒。
- informational notification 属于 chat plane，状态为“已通知但未执行”；它不得创建 possession pass，也不得承诺后续自动执行。即使“并知会/然后知会 @agent”前没有标点，通知目标也不能借用前面的分派动作。
- 自动 wakeup 只适用于已经存在于 Task Graph、拥有明确 owner/reviewer 且依赖状态可计算的任务。

### 3.5 外部引用解析与降级

- 只对显式 `PR #N` / `pull request #N` 触发 GitHub PR 解析，裸 `#N` 不猜测。
- resolver 在项目 git remote 可识别且 GitHub CLI 可用时生成紧凑 artifact（标题、状态、分支、URL、变更文件摘要）。
- PR 字段是外部不可信数据，必须经过长度/控制字符清理并放入明确的 JSON 证据边界，禁止被解释为指令。
- remote 探测最多 3 秒；最多 5 个 PR 并发解析且单个最多 5 秒，避免引用解析串行阻塞 dispatch。
- 不可用、权限拒绝、未找到与超时必须返回稳定 reason code，并写入可观测 proof；解析失败不阻断 dispatch。
- 失败 artifact 明确告诉 agent 引用未解析及下一步，不允许声称“系统会自动调度”。

## 4. 非目标

- 不为所有外部平台实现通用连接器。
- 不把 notification 加入 A2A possession 状态机。
- 不自动修改或关闭 GitHub issue；先以本地实现和验证证据完成交付。

## 5. 验收

- 每个问题至少有一个先失败后通过的自动化测试。
- 定向单测、完整测试、类型/构建通过。
- 在真实 Web 页面验证：测试现场创建一次首次 A2A，通过 daemon 共用的 prompt capture 边界写入观测数据，并按其精确 conversation/trace 验证观测面板的 system/assembled prompt 证据；页面与消息写入链路同时保持可用。
