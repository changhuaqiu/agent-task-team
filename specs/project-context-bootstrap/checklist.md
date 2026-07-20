# Project Context Bootstrap Checklist

> 状态：active
> 日期：2026-07-20

## 目录识别

- [ ] 代码库根可确定识别。
- [ ] 空目录可初始化且不会向上扫描宿主目录。
- [ ] 已有 manifest 可复用。
- [ ] 容器目录包含多个独立代码库时返回 `ambiguous_workspace` 和候选根。
- [ ] 不跟随符号链接，不扫描依赖、构建和 `.ath` 目录。

## 知识与上下文

- [ ] 生成入口、overview、architecture、topology.json/topology.md、development、catalog 和 workstream 投影。
- [ ] 六层知识均有 owner source、authority、freshness 和注入策略。
- [ ] Topology 包含 entrypoint、module、exported symbol、dependency edge、中心性与 precision/truncation 诊断。
- [ ] 不覆盖 README、AGENTS、CLAUDE、docs、specs 等权威文档。
- [ ] capsule 包含 revision、按优先级生效的规范/约束、request-aware repo map、命令、当前 workstream 和相关知识条目。
- [ ] capsule 不包含完整代码库、完整文档或其他 conversation 的私有轨迹。
- [ ] request-aware 排序在 fixture 上达到约定 `Recall@K`。

## 多项目与交接

- [ ] 同一路径多个 conversation 共用代码库 manifest。
- [ ] 其他 active workstream 只暴露标题、状态和短目标摘要。
- [ ] 当前 conversation 的 task/history/message 仍严格隔离。
- [ ] A2A 接收方得到与发送方相同的 project-context revision。
- [ ] 无 project path 时 Agent 收到“不扫描宿主目录”的 required context。

## 生命周期与失败

- [ ] 创建 conversation 时自动初始化或复用。
- [ ] 初始化失败不会留下可见的半创建 conversation。
- [ ] load 的稳定路径只做有限 freshness check，不递归扫描。
- [ ] 过期时自动执行一次有界刷新。
- [ ] 所有失败提供稳定 reason code 和可执行下一步。
- [ ] 写入使用原子替换，不留下半写 manifest。

## 验证与评测

- [ ] interface 级单测覆盖初始化、缓存、刷新、ambiguous、empty 和 path guard。
- [ ] API/创建链/Harness 集成测试通过。
- [ ] benchmark 报告冷启动与 N 次复用的 I/O、字节、估算 token 和时间。
- [ ] benchmark 报告交接复用与相关文档 Recall@K。
- [ ] 报告明确代理指标不等同于真实 LLM 质量。
- [ ] 相关 lint、类型检查或 production build 通过，或明确记录既有基线问题。

## 文档与沉淀

- [ ] 产品决策、技术设计、wiki/README 与实现一致。
- [ ] `docs/knowledge/catalog.md` 按治理规范更新（如形成可复用条目）。
- [ ] 最终交付列出测试证据、未覆盖风险和知识沉淀判断。
