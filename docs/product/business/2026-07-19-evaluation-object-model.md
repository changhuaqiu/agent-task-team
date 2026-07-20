# Agent 评估的测试集、评测对象与结果模型

> Status: Accepted，产品已确认，按 P0 → P2 顺序实施
> Date: 2026-07-19
> 关联规格：`specs/agent-eval-system/spec.md`
> 关联 UX：`docs/product/ux/2026-07-19-evaluation-platform-workspace.md`

## 1. 当前问题

当前实现已经具备快照、评分、实验和证据下钻能力，但三个最核心的用户概念仍然混在一起：

1. 页面中的“数据集”把 Judge/Rubric 校准样例表现成 Agent 可执行回归集；
2. “评测对象”有时指项目、有时指任务执行、有时又指 Agent/RoleCard/Skill 版本；
3. “结果”以综合分开头，即使关键门未知、Judge 缺失或样本不足，也容易制造已经得到完整结论的错觉。

这不是字段命名问题，而是产品对象模型没有完全冻结。

## 2. 核心结论

评估系统应固定以下关系：

```text
测试集版本 TestSuiteRevision
  └── 测试案例版本 CaseRevision
        + 被测应用版本 ApplicationSnapshot
        → 一次任务执行 TaskExecution
        → 一次样本评估 EvalRun

同一测试集版本 × 基线应用版本 × 候选应用版本 × 重复次数
  → Experiment
  → 对比报告 ExperimentReport
```

其中：

- **测试集回答“拿什么题测”**；
- **被测应用版本回答“测哪套 Agent 配置”**；
- **任务执行回答“这道题实际跑出了什么”**；
- **评估结果回答“是否达到目标、哪里变化、证据是否充分”**。

项目、Agent、RoleCard、Skill、工具调用和交接都不是同一级对象，不能平铺成六种互相独立的“评测对象”。

## 3. 我们的测试集是什么

### 3.1 当前真实状态

代码中的 `Agent 评估最小校准集 v1` 共 12 条合成样例：

| split | 案例 |
| --- | --- |
| train | 完整完成且证据充分、缺少测试证据、明确部分完成、无效关闭 |
| tune | 交接成功、交接丢失、工具重试恢复、疑似秘密泄漏 |
| held-out | 模糊需求后澄清、范围漂移、简洁交付、证据不足 |

每条记录目前只有：

- 一段场景描述；
- `overall=pass|partial|fail|unknown`；
- 语言与 split。

它没有可启动的任务输入、项目/仓库夹具、初始任务图、期望交付物、可执行断言、预算和轨迹约束。因此它的准确名称应是：

> **Rubric/Judge 最小校准集**，不是 Agent 应用回归测试集。

### 3.2 推荐的测试集组合

平台不应该只有一个万能数据集，而应有四种用途明确、仍统一呈现为“测试集”的集合：

| 测试集用途 | 回答的问题 | 案例来源 | 是否用于发布门 |
| --- | --- | --- | --- |
| 校准集 | 评分器是否接近人的判断 | 专家编写、双人标注 | 否；用于校准 grader |
| 核心回归集 | 已经承诺的核心能力是否退化 | 人工黄金案例、已修复事故 | 是 |
| 能力/边界集 | 新版本在哪些任务类型上更强或更弱 | 代表性任务、边界与对抗案例 | 用于比较与诊断 |
| 线上回放池 | 真实分布中发生了什么 | 脱敏生产任务、失败 trace | 审核晋升后才进入回归集 |

首个可用版本建议保留现有 12 条作为校准集，另外建立一个 **24–32 条可执行案例的“Agent 平台核心回归集 v1”**。案例至少覆盖：

- 单 Agent 完成与交付；
- 多 Agent 拆解、交接与评审；
- 工具/文件/代码修改正确性；
- 失败、重试、阻塞与恢复；
- 安全、秘密和危险动作；
- 模糊需求、范围边界与诚实退出；
- 中英文、不同难度和不同角色拓扑。

### 3.3 一个可执行案例必须包含什么

```ts
type EvalCaseRevision = {
  goal: string;
  initialState: {
    repositoryFixture?: string;
    taskGraphFixture?: string;
    conversationFixture?: string;
    environmentFixture?: string;
  };
  successContract: {
    requiredOutcomes: string[];
    executableAssertions: Array<BuildCheck | TestCheck | FileCheck | StateCheck>;
    acceptableVariants?: unknown[];
    forbiddenOutcomes?: string[];
  };
  trajectoryContract?: {
    requiredTools?: ToolExpectation[];
    forbiddenTools?: string[];
    requiredHandoffs?: string[];
  };
  budgets?: {
    timeoutMs?: number;
    maxTokens?: number;
    maxToolCalls?: number;
  };
  evaluatorPackRevision: string;
  repetitions: number;
  metadata: {
    taskType: string;
    difficulty: string;
    language: string;
    topology: string;
    capabilityTags: string[];
  };
  provenance: {
    sourceType: 'manual' | 'production_replay' | 'synthetic';
    sourceRef?: string;
    redactionStatus: string;
  };
};
```

关键点：Agent 任务往往有多种正确答案，所以 expected 不应只是“标准回复文本”，而应优先描述**结果契约、环境终态和禁止事项**。

## 4. 我们评测什么

### 4.1 两个一级对象

#### 在线诊断：一次根任务执行

主对象是：

```text
Root Task
+ 全部子任务
+ 相关协作链/交接
+ 工具与 Agent 调用
+ 交付物与 closure
+ 截止时间点
= TaskExecutionSnapshot
```

在线评估不应默认评估“整个项目的全部历史”。项目是容器，根任务执行才是有目标、有开始、有结束、可判定的样本。

#### 离线回归：一个 Agent 应用版本

被测版本是不可变 `ApplicationSnapshot`：

- 平台代码/Git revision；
- TeamPack 与角色组合；
- RoleCard revisions；
- Skill revisions；
- 模型、引擎和账号配置摘要；
- 运行策略与上下文编译 revision。

它在固定测试集上产生多次任务执行。基线与候选的比较对象是两个 `ApplicationSnapshot`，而不是两条任意 trace。

### 4.2 二级诊断对象

以下对象用于归因和下钻，不默认独立生成“平台总分”：

- 单个 Agent turn；
- 某个角色或 RoleCard；
- 某个 Skill；
- 工具选择与参数；
- A2A 交接；
- 规划/实现/评审阶段；
- 某类模型或运行引擎。

只有在专门的组件测试集中，RoleCard/Skill/工具策略才成为一级被测对象。例如“只替换 Luigi RoleCard，其余 manifest 不变”仍应建模为两个 ApplicationSnapshot 的对比实验。

### 4.3 评分器自身也是被测对象

Rubric、确定性 evaluator 和 Judge 需要用校准集做 meta-evaluation：

- 人—人一致性；
- Judge—人一致性；
- false pass / false fail；
- 按任务类型、语言和难度的偏差；
- grader revision 变化带来的漂移。

该结果属于“评估质量”，不与 Agent 任务结果混在同一报告。

## 5. 结果需要展示什么

结果页首先要回答三个问题：

1. **能不能接受或发布？**
2. **相对基线哪里变好、哪里退化？**
3. **为什么，证据是否足够？**

### 5.1 单次任务评估报告

展示顺序应为：

1. **结论条**：通过 / 未通过 / 证据不足 / 评估未完成；
2. **对象身份**：根任务、应用版本、执行时间、rubric/evaluator revision；
3. **关键门**：交付、完成、安全、有效退出、交接；
4. **证据可信度**：覆盖率、缺失、截断、迟到数据；
5. **质量画像**：结果正确性、指令遵循、协作、交付清晰度；
6. **运行画像**：调用失败、工具正确性、重试、token、耗时、步骤数；
7. **差距与行动**：问题、证据、建议、是否生成提案；
8. **证据下钻**：task/span/pass/proof、实际产物和轨迹。

当门禁未知或 Judge 缺失时，主标题必须是“证据不足”或“部分评估”。综合分只能标为“已评维度得分”，不能表现为完整质量分。

### 5.2 基线/候选实验报告

必须展示：

- 发布结论：候选改进 / 回退 / 证据不足；
- 数据集版本、案例数、实际完成数、重复次数；
- hard gate 回归数；
- wins / ties / losses；
- paired delta 与 95% CI；
- 各维度 delta，而不是只展示候选绝对分；
- 按任务类型、难度、语言、角色拓扑的 slice；
- 退化案例优先的逐例表；
- 每个案例的 expected contract、baseline actual、candidate actual；
- token、延迟、工具调用和失败率成本差异；
- ApplicationSnapshot、rubric、evaluator、Judge 与执行 provenance。

### 5.3 测试集质量页

数据集页面不应只显示“12 个案例 · active”，还应显示：

- 用途：校准 / 核心回归 / 能力边界 / 回放池；
- revision、split 与隐藏策略；
- 案例来源和脱敏状态；
- task type × difficulty × language × topology 覆盖矩阵；
- expected contract 完整率与可执行断言覆盖率；
- 标签分布与 hard cases；
- 人工标注一致性；
- 最近一次运行通过率、波动和失效案例；
- 数据泄漏、重复案例与长期未触达 slice。

### 5.4 不应作为首屏结论的内容

- 门禁未知时的高综合分；
- 没有分母的百分比；
- 只展示平均分、不展示逐例回归；
- 把“工具调用成功率”称作“效率”；
- 原始 trace、prompt 或内部 invocation ID；
- 把项目历史聚合当作一次任务结果。

## 6. 对当前实现的具体判断

| 当前表现 | 判断 | 建议 |
| --- | --- | --- |
| `Agent 评估最小校准集 · 12 个案例` | 名称和能力不一致 | 改名为 Rubric/Judge 校准集 |
| 案例只有 description + overall label | 不能执行端到端 Agent 回归 | 增加 CaseRevision、fixture、success contract、assertions |
| “立即评估”未选择根任务 | 可能评估整个项目历史 | 在线评估必须选择/绑定一个根任务执行 |
| `ApplicationSnapshot` 已实现 | 方向正确 | 明确为离线实验的一级被测版本 |
| Agent/RoleCard/Skill 都可追溯 | 适合作为归因维度 | 不平铺成多个一级评测对象 |
| 门禁 unknown 仍突出 `92.2` | 容易形成完整结论错觉 | 主结论改为“证据不足”，分数降级 |
| 35/35 工具成功显示为“执行效率” | 指标语义错误 | 改为工具执行成功率；效率用耗时/token/步骤与同类基线 |
| 结果有证据下钻 | 方向正确 | 增加 expected vs actual 与对象/版本身份 |

## 7. 建议实施顺序

### P0：先纠正产品语义

- 将现有 12 条数据明确为校准集；
- 在线评估绑定根任务，项目只做聚合概览；
- 门禁/证据不足优先于综合分；
- 修正“效率”等指标名称；
- 结果头部展示被测对象和版本。

### P1：建立真正可执行的核心回归集

- 引入不可变 `EvalCaseRevision`；
- 增加 fixture、success contract、assertions、budget、evaluator pack 和 repetitions；
- 建立 24–32 条核心案例；
- 支持案例详情、coverage matrix 和从生产 trace 审核晋升。

### P2：完善对比与统计

- 重复运行和方差；
- 逐例 expected/baseline/candidate 对比；
- slice、paired CI、hard regression；
- 数据集健康度和 grader 漂移。

## 8. 成功标准与不做范围

成功标准：

- 用户能准确说出“测的是哪套 Agent 版本、在什么题上、跑了几次、为什么得出结论”；
- 一条高总分不能掩盖门禁失败或证据不足；
- 任一发布结论可以追溯到逐例执行、版本和可执行断言；
- 校准集、回归集和生产回放不再互相冒充。

当前不做：

- 为每个 Agent、RoleCard、Skill 单独建立平行评估产品；
- 用固定标准答案限制开放式 Agent 任务；
- 让线上低分自动进入 held-out；
- 让综合分替代 hard gate、逐例回归与不确定性。

## 9. 外部经验依据

- [Anthropic：Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)：Agent eval 需要任务、工具、环境、执行循环和环境终态 grader，而不只是 prompt/response。
- [LangSmith：Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)：区分离线 dataset/example/experiment 与线上 run/thread，并建议从少量高质量手工案例开始。
- [MLflow：Building evaluation datasets](https://mlflow.org/docs/latest/genai/datasets/)：数据集应支持人工案例、历史 trace、ground truth/expectation、黄金回归和版本比较。
- [OpenAI Evals API](https://platform.openai.com/docs/api-reference/evals)：evaluation 将数据源 schema、测试条件和可复用 run 分离；同一 eval 可用于不同模型和参数。
