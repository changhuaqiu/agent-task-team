<div align="center">
  <h1>🐈 Agent Task Hub (Agent Task Hub)</h1>
  <p>基于 Next.js 构建的去中心化多智能体（Multi-Agent）研发协作平台。</p>
  
  <p>
    <b>“想法和产品之间，隔着的不是程序员，而是实现力。”</b>
  </p>
</div>

---

## 📖 项目简介

`agent-task-hub`（内部代号 **Agent Task Hub**，核心愿景为 *"Agents & U"*）突破了将 AI 仅作为单体辅助工具的传统模式。旨在为用户分配一支具备“对等协作、共享记忆”能力的虚拟研发团队（“Agent团队”）。人类负责提供愿景和判断，多个 AI Agent 负责拆解、编码、审查和交付，共同把想法变成实际能运行的产品。

本项目主要围绕以下五个维度构建（**The "5-Abilities"**）：
- **👀 可视 (Visual)**：通过 Task Hub 前端看板实时反映所有任务节点的状态流转。
- **🎮 可管 (Manageable)**：支持死循环熔断保护，人类可随时介入修改状态、中断或重新分配任务。
- **🚀 可 push (Pushable)**：外部需求不仅可通过人类下发，Agent 之间也可根据情况互相派发子任务。
- **🔄 可推进 (Drivable)**：依靠 `@` 提及路由接力通知机制，确保从拆解到交付无缝衔接。
- **♻️ 可迭代 (Iterative)**：独立的 Reviewer Agent 机制保障代码质量，减少推倒重来的成本。

## 🏗️ 核心架构

系统采用了 **“状态上板 (Blackboard) + 消息通知 (Event-driven A2A)”** 的混合驱动架构：

- **Planner Agent (架构师/拆解者)**：接收大需求，拆解为细粒度的任务写入看板。
- **Worker Agents (执行节点)**：专注于执行特定领域的编码工作。
- **Reviewer Agent (审查节点)**：专职进行 Code Review，决定任务放行（`approved`）还是打回（`rejected`）。

*详见 [架构设计文档](./specs/2026-04-29-decentralized-agent-task-hub-design.md) 和 [产品愿景](./VISION.md)*。

## 🛠️ 技术栈

本项目是一个现代化的 Web 应用：

- **框架**: [Next.js 16.2](https://nextjs.org/) + [React 19](https://react.dev/)
- **状态管理**: [Zustand 5](https://github.com/pmndrs/zustand)
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/)
- **组件/功能集成**: 
  - `xterm.js` (Web 终端模拟)
  - `lucide-react` (图标系统)

## 🚀 快速开始

### 1. 安装依赖

推荐使用 `pnpm` 安装项目依赖：

```bash
pnpm install
# 或使用 npm / yarn
# npm install
# yarn install
```

### 2. 运行开发服务器

```bash
pnpm dev
# 或
# npm run dev
# yarn dev
```

启动后，在浏览器中访问 [http://localhost:3000](http://localhost:3000) 即可预览项目。你可以通过修改 `app/page.tsx` 来开始你的开发，页面会自动热更新。

## 📚 文档导读

在开始深入开发前，建议您阅读以下文档以了解本项目的规范和计划：

- [产品愿景 (VISION.md)](./VISION.md)
- [研发路线图 (ROADMAP.md)](./ROADMAP.md)
- [标准操作程序 (SOP.md)](./SOP.md)
- [Agent 指南 (AGENTS.md)](./AGENTS.md)
- [核心设计与架构规范 (specs & design 目录)](./specs/)

---

<div align="center">
  <p><i>「领养团队，一起长出世界。」</i></p>
</div>
