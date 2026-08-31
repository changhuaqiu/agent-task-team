# 变更评测与证据治理

> 状态：生效
> 日期：2026-07-20
> 适用范围：仓库内所有实现、行为、架构、产品和文档契约变更

本目录回答的不是“测试跑没跑”，而是五个可追溯问题：

```text
Why → What → Industry → Measure → Decision
为什么改   改了什么   业界如何处理   效果怎样   是否保留
```

## 1. 分级要求

每次修改都要留下与影响相称的证据，不允许用一条“测试通过”替代效果判断。

| 级别 | 适用变更 | 最低证据 |
| --- | --- | --- |
| V：Verification | 文案、文档、局部缺陷、无行为变化重构 | 原因、影响边界、可重复验证命令/人工检查、结果 |
| C：Comparison | 性能、上下文、检索、Harness、工作流、API 行为、重要 UX | V + 前后基线、指标定义、原始数据、行业依据、局限 |
| E：Experiment | 声称 Agent 质量/成功率提高，或 RoleCard/Skill/Prompt/协作策略候选 | C + 固定测试集、ApplicationSnapshot、逐例 paired diff、不确定性与回退结论 |

无法找到直接行业对照时必须写明检索范围和“不适用/未找到”的原因，不能虚构最佳实践。行业材料只解释设计选择，不代替本项目数据。

## 2. Change Evaluation Record

重要变更在本目录建立不可变结论记录，文件名：

```text
YYYY-MM-DD-<change-slug>-evaluation.md
```

记录至少包含：

```markdown
# <Change> Evaluation

- Change ID:
- Evaluation level: V | C | E
- Status: planned | measured | accepted | rejected | inconclusive
- Code/spec revision:
- Evaluator/benchmark revision:

## Why
问题、用户影响、旧基线和不改的代价。

## What changed
变更对象、边界、不变量和回退方式。

## Industry evidence
来源、访问日期、可迁移做法、不可直接照搬的差异。

## Method
fixture/dataset、样本数、机器环境、指标公式、成功阈值、原始数据路径与校验和。

## Baseline vs candidate
逐项结果；失败/unknown/not_applicable 不得隐藏在平均值中。

## Decision
保留/拒绝/证据不足，理由、风险和下一次复测触发条件。
```

原始数据应由可重复命令生成，避免手工改数。报告必须明确区分：

- 确定性组件指标与真实 Agent 任务质量；
- 冷启动与热路径；
- 绝对值与相对变化；
- 统计事实与工程推断；
- 已测范围与未覆盖风险。

## 3. 与现有 Agent 评估系统的关系

本目录是“变更为什么成立”的仓库级证据索引；`agent-evaluation-system.md` 是执行任务级/应用版本级 Agent 评估的运行系统。

- V/C 组件变更可使用单测、集成测试和确定性 benchmark。
- 任何“Agent 成功率、协作质量或 Prompt 更好”的结论必须进入 E 级，使用固定 TestSuiteRevision、baseline/candidate ApplicationSnapshot 和 paired experiment。
- 组件代理指标可以决定是否值得进入 E 级，不能冒充 Agent 质量结论。

## 4. 项目上下文接入

Project Context 的 L5“知识与证据”层必须索引本目录：

- capsule 只展示与当前请求相关的评测记录标题、结论、revision 和路径；
- Agent 修改已评测模块前应先读取对应记录；
- 评测记录本身是 owner evidence，生成 catalog 只建立引用；
- 变更使旧记录失效时，新记录要引用旧 Change ID，并标记复测原因。

## 5. 当前记录

- `agent-evaluation-system.md`：Agent 任务与应用版本评估系统设计。
- `2026-07-20-project-context-bootstrap-evaluation.md`：项目上下文初始化的 C 级前后对比与 2026-07-21 两场景真实 Agent live verification（已接受；任务质量结论仍需 E 级实验）。
- `2026-08-22-runtime-trace-hardening-evaluation.md`：基于最近真实 Trace 的 WorkContract、Task 权限、ACP session 与 Phoenix 在线投影 C 级对比（组件已接受；任务完成率仍需 E 级复测）。
- `2026-08-23-collaboration-kernel-evaluation.md`：统一 WorkRequest/Lane/reply address、事件身份与真实 Runtime ACK 的 C 级确定性对比（组件已接受；真实任务成功率仍需 E 级复测）。
- `2026-08-31-project-workitem-path-evaluation.md`：Project→WorkItem 分层、独立活动/Task Graph 与角色交付的 C 级前后对比（已接受；不代表真实 Agent 任务成功率结论）。
