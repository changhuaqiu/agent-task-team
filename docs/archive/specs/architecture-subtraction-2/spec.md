# Architecture Subtraction — Round 2

> Status: implemented
> Date: 2026-08-13

## Goal

从真实 Next.js 页面/API 入口与 daemon 入口反推生产调用图，删除不可达且没有动态注册职责的幽灵功能，并清理“测试为了保护死文件存在”的反向约束。

## Evidence Rule

只有同时满足以下条件才删除生产 Module：

1. 从 `src/pages/**`、`src/app/**`、`src/server/daemon.ts` 的静态 import 图不可达；
2. 全仓符号与路径搜索没有生产消费者；
3. 不是 Next.js 文件路由、CLI 入口、配置入口或测试 Adapter；
4. 当前产品/技术文档不再把它描述为现行入口。

## Scope

- 旧任务卡、项目选择器与 workspace 标题 helper；
- 已不可达的 War Room 时间线展示链；
- 仅由自身测试调用的 mention parser 与流式文本持久化器；
- 保护上述死代码的测试与过时文档引用；
- 上一轮已完成规格从活动目录迁入归档。

## Exit Criteria

- 删除候选无生产调用或动态入口；
- 当前 UX 与架构测试不再引用死文件；
- TypeScript、相关测试与生产构建通过；
- 独立代码审查无 Critical/Important。
