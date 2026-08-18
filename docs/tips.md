# Tips / 使用小 Tips

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Quick tips for using the current `Agent Task Hub` workspace.

## 1. Ask for Concrete Outcomes

Good prompts focus on the outcome, not just the topic:

- "Create a project and break it into phases"
- "Review this change and list findings first"
- "Bind this account to the planner role card"
- "Import a skill from this repo and assign it to Mario"

## 2. Use `@agent` Only When You Need Routing

Write `@agentId` at the beginning of a new line to route a message to a specific agent in the workspace.
You can place up to three handles at the beginning of the same line for parallel work. An inline `@name`, email address, or fenced code example is ordinary text and does not dispatch work.

Example:

```text
这个方案可以。
@mario
请先给我一个拆解方案。
```

Current built-in agent IDs:

- `@mario`
- `@luigi`
- `@toad`
- `@peach`
- `@dk`
- `@yoshi`

## 3. Stop a Bad Direction Early

These phrases are still useful when you want the agent to stop and reassess:

- `脚手架` — check whether the current result is a throwaway scaffold
- `绕路了` — stop and find the direct path to the goal
- `喵约` — re-check current work against project rules
- `星星罐子` — full freeze for risky or irreversible situations

## 4. Prefer Project Terms

In this repository, user-facing terms should stay simple:

- `模型账号` instead of internal runtime jargon
- `角色卡` for role/identity configuration
- `Skill` for reusable capability modules
- `项目` / `任务` / `作战指挥室` for the main workspace model

## 5. Read the Right Docs First

Before implementing or reviewing:

- `AGENTS.md` — project rules
- `docs/README.md` — documentation structure
- `specs/README.md` — active spec rules
- `docs/wiki/` — current code-aligned architecture

---

<a id="中文"></a>

这里是当前 `Agent Task Hub` 项目的实用小技巧。

## 1. 直接说结果

尽量直接描述你要的产出，而不是只给主题：

- “创建一个项目并拆成几个阶段”
- “帮我 review 当前改动，先列问题”
- “把这个模型账号绑定到项目统筹角色卡”
- “从这个仓库导入一个 Skill，并绑定给 Mario”

## 2. 只有需要定向路由时才用 `@agent`

如果你要指定某个 Agent 执行，请另起一行、行首写 `@agentId`。
同一行开头最多可以连续写 3 个成员并行处理。正文里的 `@名字`、邮箱地址和代码块示例都只是文字，不会派工。

示例：

```text
这个方案可以。
@mario
请先给我一个拆解方案。
```

当前内置 Agent ID：

- `@mario`
- `@luigi`
- `@toad`
- `@peach`
- `@dk`
- `@yoshi`

## 3. 发现方向不对时尽早拉闸

这些词依然适合用来中断错误方向：

- `脚手架`：检查当前产物是不是临时拼出来的
- `绕路了`：停止当前做法，回到直线路径
- `喵约`：重新对照项目规则
- `星星罐子`：高风险场景下全面冻结

## 4. 优先使用当前项目术语

本仓库里用户可见文案尽量保持简单：

- 用 `模型账号`，少用内部运行时术语
- 用 `角色卡` 表达身份与职责
- 用 `Skill` 表达可复用能力模块
- 用 `项目`、`任务`、`作战指挥室` 表达主工作流

## 5. 实现前先看对的文档

开始实现或 review 前，优先读这些：

- `AGENTS.md`：项目规则
- `docs/README.md`：文档结构
- `specs/README.md`：活动规格规则
- `docs/wiki/`：和当前代码对齐的架构文档
