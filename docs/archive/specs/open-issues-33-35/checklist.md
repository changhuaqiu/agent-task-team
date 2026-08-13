# Checklist — 线上 Issues #33–#35

## 复现与判断

- [x] 每条 issue 已判断真实性，不把建议方案直接当作事实。
- [x] 设计缺陷已先写入 active spec。

## 行为

- [x] 首次 A2A 同时产出 system prompt 与 A2A assembled prompt。
- [x] 非首次 A2A 保持 handoff 行为。
- [x] 默认 TeamPack 数据库副本升级为 4 人且保留账号/技能绑定。
- [x] communication matrix 不引用 roles 之外的 agent。
- [x] prompt 不再包含错误的相对 TASKS 路径。
- [x] planner 分派职责与 A2A 选择规则各只有一个权威层。
- [x] “分派/拆给/安排 @agent”能启动执行，纯知会不能启动。
- [x] 自动 wakeup 文案限定于已建模 Task Graph。
- [x] 显式 PR 引用成功解析或产生结构化降级 reason code。

## 验证

- [x] 定向回归测试通过。
- [x] 全量测试通过（120 files / 1067 tests）。
- [x] 改动范围 lint 无错误，production build 通过；仓库全量 lint 仍有既有基线错误并扫描 `.ath` 工作树。
- [x] Web E2E 通过（真实 Chrome 6/6）；首次 A2A 使用测试现场生成的精确 conversation/trace，HTML 报告位于 `playwright-report/index.html`。
- [x] 二轮独立只读复审无 Critical / Important，结论 Ready to merge。
