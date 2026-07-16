# Agent Team Loop 真实验收记录（2026-07-16）

## 1. 验收目标

使用真实 ACP runtime 和真实项目文件，验证平台 Harness 能按角色与流程完成：

```text
Mario (planning) -> Luigi (implementing) -> Peach (quality_gate) -> Mario (closure)
```

同时审计上下文注入、Task Graph、A2A possession、OTel-shaped observation、消息与 invocation 关联，以及最终产出是否偏离源文件事实。

## 2. 真实任务与事实基线

- 会话：`conv-1784224452978-8cb6cb3d3b08`（Agent Loop 修复后复验）
- 项目源文件：`C:\Users\qiufa\projects\agent-task-team\package.json`
- 任务事实：`scripts` 共 16 条；`dev` 为 `next dev --webpack`；`test` 为 `vitest run`；`build` 为 `next build`。
- 证据目录：`.ath/workspaces/conv-1784224452978-8cb6cb3d3b08/.ath/evidence/`

连续执行了 `VERIFY_LOOP_20260716` 与 `HOT_LOOP_20260716` 两轮完整 Task Graph 闭环，并在最终 daemon 重启后执行一条独立的 Luigi -> Mario A2A 回归。

## 3. 最终结果

### 3.1 Task Graph 闭环

两轮均满足：

1. Mario 建立实现任务与依赖收口任务。
2. Luigi 读取真实 `package.json`，写实现证据，将任务推进到 `review`。
3. Luigi 不再手工 `@peach`；Task Graph 仅唤醒 TeamPack 默认 `quality_gate` owner Peach，DK 未被启动。
4. Peach 独立读取源文件与实现证据，作出 PASS 决策并将实现任务置为 `done`。
5. 依赖解除只启动 Mario 一次；Mario 写 `closure.md` 并将收口任务置为 `done`。

`VERIFY-001/002` 与 `HOT-001/002` 最终全部为 `done`。实现、评审与收口证据齐全，最终结论与源文件事实一致。

### 3.2 质量门效果

第一轮验收中，Luigi 的数据块完整列出 16 条脚本，但文字结论误写为 15。Peach 独立复核后识别 off-by-one，将其作为非阻塞发现记录；Mario 的 closure 使用正确值 16。修复后两轮均直接产出 16，Peach 复核零偏差。

这证明 reviewer 不是形式节点：它能发现角色产出偏差，并阻止错误口径进入最终结论。

### 3.3 A2A possession

最终热加载回归使用自然语句：

```text
@luigi ... 完成后 @mario 请汇总这条 dev 原文并给出一句结论
```

结果：

- user -> Luigi pass：`completed`
- Luigi -> Mario pass：`completed`
- possession chain：`completed`
- Mario invocation：成功输出汇总结论
- 无 `offer_timeout`、无“未被执行端确认”假失败

当前 holder 在产生下一棒后会先完成自己的 possession 与入站 pass；后续 offer timeout 不再反向污染上游成功事实。

## 4. Prompt 与可观测审计

四类实际 invocation（Mario planning、Luigi implementing、Peach review gate、Mario closure）均满足：

- prompt 包含角色身份、TeamPack workflow、Task Graph / A2A 边界和 runtime-native tool 禁用说明；
- ACP assembled prompt 末尾包含会话级绝对 `TASKS.md` 路径；
- 未出现虚假的 `## Available Tools`；
- tool spans 的 `ath.tool.native=true`、`ath.tool.platform=false` 与实际 ACP 工具一致；
- 实现角色 prompt 明确说明进入 `review/in_review` 后不得手工 `@` 默认 reviewer；
- reviewer prompt 包含受限 PASS/REJECT 裁决权，不能修改实现内容、标题、负责人或无关任务；
- agent 文本、tool message 均写入精确 `chat_message.invocation_id`。

观测数据覆盖 root agent span、message span、context span、tool span，以及按需 payload：`system_prompt`、`assembled_prompt`、`thinking`、`completion`、`tool_input`、`tool_output`。最终完整 Task loop 未出现 observation 写入中断执行的情况。

## 5. 本轮发现并修复的问题

| Issue | 问题 | 验收结果 |
|---|---|---|
| #18 | 用户正文下游 mention 被并行派发 | 用户入口只启动首个有效角色 |
| #19 | runtime-native Task/SendMessage 冒充平台工具 | prompt 明确平台/原生边界；无虚假 Available Tools |
| #20 | 非 worktree cwd 指向空 scratch | runtime 可读取真实项目文件与绝对证据路径 |
| #21 | TASKS.md 首次 add 未投影 | 首次建表立即投影两个任务 |
| #22 | 项目内任务 ID 跨会话冲突 | 冲突 ID 使用 conversation-scoped storage ID |
| #23 | 首次投影 review 不唤醒 | 首次非默认状态同样进入通知/wakeup 决策 |
| #24 | Windows 路径含冒号失败 | workdir segment 编码并带稳定 hash |
| #25 | review 同时启动 DK/Peach | 普通质量门只启动 Peach |
| #26 | 系统消息误触发 proposal/重复启动 | proposal 仅由 human/no-mention/none 触发，并有启动预留保护 |
| #27 | reviewer 无法完成 gate 裁决 | reviewer 可对本轮任务做受限 PASS/REJECT |
| #28 | review 后实现者重复 `@reviewer` | 新 prompt 生效，真实两轮均无 reviewer A2A |
| #29 | 成功 pass 被后续 timeout 污染 | 最终双角色链两条 pass 均 completed |
| #30 | stale TASKS todo 回滚 in_progress | active task invocation 期间拒绝 stale pending 回退 |
| #31 | legacy dependency wakeup 制造假失败 | Publisher 成为唯一 wakeup 生产者；无重复/假“未启动” |
| #14 | mention intent 误判 | 子句级否定 + closure 动词回归；真实 Luigi -> Mario 汇总 pass 成功 |

## 6. 结论与后续边界

当前平台层 Agent Team Loop 已能以真实 runtime 连续完成 planning -> implementing -> quality_gate -> closure，并通过 Task Graph、A2A 与 observation 三套事实相互校验。

下一阶段可以继续演进正式平台 task tools 与更强的 trace/link 投影，但它们不再是当前最小闭环运行的前置条件。兼容期内，绝对 `TASKS.md` 是 durable task mutation 入口，Task Notification Publisher 是普通 gate 与 dependency wakeup 的唯一入口，A2A 只承担明确的新动作交接。
