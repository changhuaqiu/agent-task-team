# 全流程体验整改评测

- Change ID: UX-JOURNEY-2026-09-06
- Level: C（确定性投影与界面路径对比，不是 Agent 质量实验）
- Status: measured；代码评审通过，桌面构建/集成结果待收尾补录
- Baseline: 审计代码 59850ef，含审计文档的比较基线 c507451
- Contract: [体验整改规格](../../../specs/ux-journey-completion/spec.md)

## Why / What

原流程已有工作项分层，但数量、当前阻塞、旧工作定位和完成依据彼此脱节。整改统一工作项读模型与精确导航，提供显式开始、当前关注、只读验收、安全内容预览及去重通知；不重建旧项目、不修改质量门终态、不扩展 Agent 权限。

## Industry evidence

2026-09-06 查阅官方资料：[GitHub 子 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) 支持可追踪的父子关系；[W3C Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) 与[可访问名称](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)用于选择原生键盘按钮及具体对象名称。仅借鉴层级与交互原则，不把 GitHub 的 Issue 状态或人工操作等同于本项目的 Agent 执行、Gate 和授权。

## Method / Raw evidence

- Windows、Node 24、Next.js 16.2.4，共享 Web/Desktop Renderer；隔离工作树的 1437 测试服务使用独立 .ath，不触碰正式桌面数据库。
- `pnpm exec tsx scripts/evaluate-ux-journey.ts` 复现固定 4 工作项 / 13 任务，核对旧版真实源码中的计数规则，再调用候选读模型。
- [原始 JSON](raw/2026-09-06-ux-journey.json)记录输入规模、候选源码 SHA-256、逐项值和限制。
- 基线 UI 观察见[九项体验审计](../../product/ux/2026-09-06-end-to-end-experience-audit.md)。
- 自动化回归：最终 `pnpm exec vitest run --reporter=json --outputFile=.ath/ux-release-tests.json`，2052 通过、2 跳过、0 失败；类型检查通过。变更生产文件及新增测试共 46 个文件 ESLint 0 错误/0 警告，最后的桌面导航补丁及新增回归亦单独 lint 通过；旧 state 测试已有的 any 标注不在此静态检查通过口径内。
- 中间一次全量运行出现未修改的 ProjectContext 跨进程测试 `.prepare.lock` 的 Windows EPERM，2050 通过/1 失败；单独及关联导航复测 39/39 通过，随后完整重跑通过。保留[验证摘要与原报告哈希](raw/2026-09-06-ux-verification.json)，不把复测成功等同于文件系统竞争已被修复。

## Baseline vs candidate

| 固定样本指标 | 正确值 | 基线 | 候选 |
| --- | ---: | ---: | ---: |
| 侧栏工作项数 | 4 | 13 | 4 |
| 真正进行中的工作项 | 1 | 3 | 1 |
| 可见的当前子任务阻塞 | 1 | 0 | 1 |

五个精确身份用例全部符合预期：旧 A、旧 B、子任务到所属目标、待规划目标，以及拒绝跨范围同名/错误目标。基线导航问题用审计与组件回归描述，不编造“成功率提升”数字。

## 浏览器观察

固定样本明确标注“不是模型执行结果”。通过真实 UI 完成：添加项目→粘贴目录→创建工作项→进入独立详情；首屏可见协调者职责、默认登录继承、记录与执行的区别。未点击真实 Agent 安排/重试，命令接纳由组件回归验证。

同一隔离项目显示 4 工作项、13 任务记录、进行中 1、需要处理 1。从概览“查看并处理”一次点击打开对应子任务抽屉；根目标仍进行中。抽屉显示原始原因、检查后重试、不替用户授权，以及收起的高级操作。

旧工作 B 单独打开，成果页同时显示 Task 验收 Gate 已通过和项目分支评审 0，未把两类评审混同。已登记 acceptance.md 在 Mario 列的设计与文档类别内；预览读取四节 Markdown 正文，展示当前磁盘时间/哈希和非冻结版本说明。界面窄列下刷新按钮保持完整文字。

从旧 B 切换到旧 A，再后退和刷新，仍回到 B 的成果页。同次执行的三条 Agent 消息在收件箱形成一个入口，点击进入对应工作项活动及确切原消息；过程说明仍可展开，未丢失正文。

## Decision / limitations

保留上述确定性修正。两轮独立只读评审发现并修复了 deferred URL、外部导航被覆盖、错误目标替代、贡献身份不一致、凭据脱敏和旧已读标记迁移问题；最终两位评审均无剩余 Critical/Important。

桌面交付前追加了 fragment 导航保持 Renderer 凭据的回归：项目/全局切换、重挂载与返回初始地址后仍可读取同一凭据，不把它存入项目或日志。独立复核检查了真实 Gateway 读取链路，确认该补丁无 Important/Critical；其新测试包含在最终 2052 项通过结果中。

本轮不宣称真实 Agent 完成率、耗时或模型质量改善；未做首次访客计时研究、真实 OAuth 授权、安装/签名/自动更新或全平台无障碍认证。真实模型质量仍需固定任务集与 ApplicationSnapshot 的 E 级成对实验。

保留风险：Windows ProjectContext 文件锁竞争需在专门可靠性迭代中复现并评估，不能因本轮复测通过而关闭。生产构建仍有既有 Next 文件追踪范围警告，桌面 Rust 构建有既有 PDB 同名警告；本轮未改动这两条构建链路，不能将其算作已消除。

## 集成收尾

待记录：最终完整回归、生产构建、目标分支提交、桌面 build ID 与更新验证。此项完成前不把桌面交付写成已完成。
