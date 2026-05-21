# 技术规范

本规范适用于所有代码实现、架构设计、数据模型、接口、运行时、集成、测试与技术评审动作。

## 1. 技术动作前置检查

开始技术动作前必须完成：

- 阅读 `AGENTS.md`、`docs/README.md`、`specs/README.md`。
- 识别受影响的活动规格，并阅读对应 `specs/<name>/spec.md`、`tasks.md`、`checklist.md`。
- 若涉及 Next.js、API route、routing、rendering 或构建行为，先阅读 `node_modules/next/dist/docs/` 中对应指南。
- 对非简单代码、架构、评审或测试任务，先使用 GitNexus 获取图谱上下文；至少查询相关功能、符号、流程或模块。
- 检查当前工作区状态，避免覆盖并行任务改动。
- 明确本轮改动的边界，不顺手重构无关模块。

## 2. 设计与实现原则

技术方案必须满足：

- **事实源清晰**：状态、路由、权限、任务生命周期等关键事实必须有明确 owner，不允许多个模块同时宣称自己是事实源。
- **边界收敛**：UI、store、daemon、server repository、runtime adapter 分别承担清晰职责，避免业务规则散落到 transport 或展示层。
- **先契约后实现**：跨模块、跨实例、跨 agent 的行为必须先写入规格或技术文档，再进入代码。
- **最小可验证闭环**：优先实现能被测试或日志证明的闭环，避免只增加抽象层。
- **兼容迁移显式化**：临时兼容路径必须标注状态、退出条件和后续收敛方向。
- **错误可解释**：失败必须有 reason code、可读消息和定位线索，不能退化为泛化超时。

## 2.1. GitNexus Graph-First Gate

代码理解与影响面分析默认遵循 GitNexus 图谱优先：

- **开始前**：用 `gitnexus query` 或 MCP `query` 找到相关功能、流程、cluster、文件和符号。
- **改动前**：对核心符号或模块使用 `context` 或 `impact`，明确上游调用、下游依赖、跨模块关系和受影响流程。
- **评审前**：Peach/DK 这类 review gate 必须检查 `impact` 或 `detect_changes` 结果，不能只看 diff。
- **测试前**：Yoshi 这类 test gate 必须根据 affected processes、入口点和调用链制定测试范围。
- **交付前**：涉及代码变更的 handoff 或总结必须包含 GitNexus evidence，例如查询词、符号名、流程名、impact 目标或 detect_changes 结论。
- **不可用时**：如果 GitNexus 未安装、索引过期或查询失败，必须说明原因；能安全重建索引时先运行 `gitnexus analyze`，否则显式采用 `rg`、测试和人工代码阅读作为降级路径。

## 2.2. Executable Delivery Gates

任务状态流转必须由证据驱动，不由角色自述驱动：

- **进入 `in_review`**：必须提交 `implementation_evidence`，至少包含 `installResult`、`buildResult`、`gitnexusEvidence`。
- **标记 `done`**：必须提交 `delivery_evidence`，至少包含 `mergedToMain`、`mainInstallResult`、`mainBuildResult`、`mainTestResult`、`gitnexusDetectChangesResult`。
- **新增依赖**：视为门禁事件；实现者必须说明原因、替代方案判断、lockfile 一致性、install/build 结果，由 review gate 检查。
- **CLI 成功退出**：不等于可以进入 review；系统只能记录运行成功，不能自动把任务推进到 `in_review`。
- **缺证据时**：状态更新入口必须拒绝流转并记录 proof event；UI 或 agent 应显示缺少的证据字段。

## 3. 代码变更规范

代码实现必须遵守：

- 只修改完成任务所必需的文件。
- 不引入与任务无关的新框架、新全局状态或新依赖。
- 数据库 schema、repository、API、store、UI 行为变化必须同步更新文档。
- 新增长期机制时必须有对应测试；没有现成测试结构时，优先补最小单元测试或集成测试。
- 对已有行为做兼容变更时，保留旧路径测试，新增新路径测试。
- 不把敏感信息写入日志、proof、snapshot、fixture 或文档示例。

## 4. 测试与验证规范

完成技术动作前必须执行与影响面匹配的验证：

- 纯文档变更：检查链接、路径、分类和术语一致性。
- 小范围 TypeScript/函数变更：运行相关单测。
- store、daemon、repository、协议变更：运行相关单测与集成测试。
- schema 或类型变更：运行类型检查。
- 无法运行验证时，必须在交付说明中明确原因和建议命令。

验证顺序应从最小影响面开始，再扩大到类型检查或更广测试。

## 5. 架构决策规范

出现以下情况必须更新 `decisions/` 或相关技术文档：

- 改变事实源归属。
- 引入新的跨模块协议、执行链路或持久化模型。
- 废弃已有机制或定义迁移路线。
- 选择一个明显影响长期演进的技术方向。

决策记录至少包含：背景、决策、替代方案、后果、退出或迁移条件。

## 6. 技术交付检查清单

交付前逐项检查：

- [ ] 相关规格已读取并按需更新。
- [ ] 相关长期技术文档已同步。
- [ ] 代码边界与事实源归属清晰。
- [ ] 错误路径可观察、可解释。
- [ ] 测试或验证命令已执行，或已说明未执行原因。
- [ ] 已判断是否有可沉淀技术知识。
