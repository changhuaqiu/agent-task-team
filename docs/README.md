# 文档导航

本文档定义当前项目的文档分类方式与演进规则，后续新增文档默认按照这里的目录结构落位。

## 一、文档分层

### 1. 项目级入口文档

这些文档保留在项目根目录，作为全局入口：

- `README.md`：项目总览与使用方式
- `ROADMAP.md`：路线图与阶段目标
- `AGENTS.md`：Agent 在本项目中的工作约束
- `CLAUDE.md` / `GEMINI.md` / `TIPS.md`：模型/协作辅助说明

### 2. `docs/product/`

面向产品与业务演进的文档。

- `docs/product/ux/`：用户旅程、信息架构、界面与体验方案
- `docs/product/business/`：业务机制、角色体系、产品抽象与目标说明

### 3. `docs/technical/`

面向技术设计与系统方案的文档。

- `docs/technical/integrations/`：集成配置、认证、渠道、CLI 接入设计
- `docs/technical/execution/`：执行链路、runtime、daemon、终端会话相关设计

### 4. `docs/plans/`

当前仍有效的开发计划、落地路线与阶段实现方案。

### 5. `specs/`

面向当前仍在执行、且需要所有 Agent 严格遵循的统一规格目录。

- 每个有效规格使用独立子目录管理
- 默认包含 `spec.md`、`tasks.md`、`checklist.md`
- 所有 Agent 在开始实现前都应先阅读相关规格

### 6. `docs/wiki/`

项目知识库，面向代码结构、前后端模块、开发运行方式的稳定说明。

### 7. `docs/knowledge/`

沉淀型知识文档，例如 lessons learned、长期经验、复盘型资料。

### 8. `design/`

视觉、品牌、命名、设计系统等偏设计资产文档。

### 9. `architecture/`

架构主文档与系统结构说明。

### 10. `decisions/`

架构决策记录（ADR）与关键决策沉淀。

### 11. `docs/archive/`

已完成使命、但仍有历史参考价值的文档归档区。

- `docs/archive/plans/`：早期一次性计划稿
- `docs/archive/specs/`：历史方案稿、设计稿、替代路线稿

---

## 二、当前分类结果

### 产品 / 业务

- `docs/product/ux/2026-05-01-ux-journey-and-gameplay-plan.md`
- `docs/product/business/2026-05-01-engineering-role-card-business-plan.md`

### 技术设计

- `docs/technical/integrations/2026-05-01-cli-channel-auth-config-center.md`
- `docs/technical/execution/opencode-integration-executable-chain.md`

### 进行中的计划

- `docs/plans/`

### 当前有效规格

- `specs/README.md`
- `specs/unify-integration-config-center/`

### 稳定知识库

- `docs/wiki/`
- `docs/knowledge/public-lessons.md`

### 设计资产

- `design/design-system.md`
- `design/`

### 历史归档

- `docs/archive/plans/`
- `docs/archive/specs/`

### 当前执行文档

当前项目的正式执行文档应放在项目根目录可见的文档体系中，其中活动规格统一放在：

- `specs/`

补充文档按内容放在：

- `docs/plans/`
- `docs/technical/`
- `docs/product/`

`.trae/` 不作为项目正式文档目录，也不作为多人协作时的事实来源

---

## 三、文档演进规则

后续新增文档时，默认按以下规则处理：

### 1. 所有实现必须同步更新设计文档

- 任何代码实现、交互调整、数据模型变更、执行链路修改，只要改变了系统实际行为，就必须同步更新对应设计文档后才算完成交付
- 设计文档可位于 `docs/`、`design/`、`architecture/`、`decisions/`，应根据内容类型落到正确目录
- 不允许出现“代码已经改完，但设计文档仍停留在旧状态”的情况
- 多 Agent 并行开发时，文档同步是强制交付门禁，不是可选动作
- 项目正式文档必须位于仓库根目录可见的文档体系中，不应以 `.trae/` 作为正式交付位置

### 2. 先判断是否为“长期有效”

- 长期有效：进入 `docs/`、`design/`、`architecture/`、`decisions/`
- 活动规格：统一进入 `specs/`
- 一次性执行稿：优先放 `docs/plans/`
- 已失效但有参考价值：迁入 `docs/archive/`

### 3. 避免根目录继续堆零散文档

除全局入口文档外，新文档不要直接放在根目录。

### 4. 产品文档与技术文档分开

- 讲用户、业务、体验：放 `docs/product/`
- 讲系统、协议、执行、集成：放 `docs/technical/`

### 5. 历史文档不默认删除

只有满足以下条件，才建议删除：

- 明确为中间产物
- 已被新文档完全替代
- 不再具有历史参考价值

否则优先迁入 `docs/archive/`

### 6. Spec 与业务文档分离

- 执行中的正式 spec 统一放在 `specs/`
- `docs/plans/` 用于计划、排期、阶段性方案，不替代正式 spec
- `docs/` 用于产品/设计/技术长期文档
- 已落地实现的关键结论，必须回写到长期设计文档，不能只留在临时工作区

---

## 四、后续建议

建议以后每次产生新文档时，同时做两件事：

1. 判断它属于哪个目录
2. 判断它是“长期文档”还是“阶段性文档”

这样文档体系才能持续演进，而不是重新回到根目录堆草稿的状态。
