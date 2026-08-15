# 角色卡生态架构分析

> 基于 GitHub 上多个 Agent 团队项目的研究，探讨角色卡生态的设计思路

---

## 一、我们看到了什么

### 1.1 Edict（三省六部）

**项目地址**：https://github.com/cft0808/edict

**核心洞察**：用 1300 年前的帝国制度重新设计 AI 多 Agent 协作

```
你 (皇上) → 太子 (分拣) → 中书省 (规划) → 门下省 (审议) → 尚书省 (派发) → 六部 (执行) → 回奏
```

**值得学习的点**：

| 设计 | 说明 | 启发 |
|------|------|------|
| **SOUL.md** | 每个 Agent 有独立的人格定义文件 | 角色卡不只是配置，是「灵魂」 |
| **权限矩阵** | 谁能给谁发消息，白纸黑字 | 协作规则要显式定义 |
| **状态机** | 任务流转有严格的状态转换路径 | 流程要可审计、可追溯 |
| **门下省审核** | 架构内建的质量关卡，不是可选插件 | 审核要成为架构的一部分 |
| **实时看板** | 每个步骤都要上报进度 | 可观测性是第一公民 |
| **远程 Skills** | 从 GitHub 一键导入能力 | 能力要可组合、可分享 |

**Edict 的 SOUL.md 结构**：
```markdown
# 角色名称

## 核心职责
## 工作流程（步骤 1、2、3...）
## 看板操作（CLI 命令）
## 实时进展上报（什么时候必须上报）
## 防卡住检查清单
## 语气
```

**关键发现**：Edict 的角色卡不是静态配置，而是**行为规范**——定义了「怎么做」而不只是「是谁」。

---

### 1.2 ClawSouls / SoulSpec

**项目地址**：https://github.com/clawsouls/soulspec

**核心洞察**：建立 AI Agent 人格的开放标准

```
my-soul/
├── soul.json       # 元数据（名称、版本、标签、兼容性）
├── SOUL.md         # 核心身份（人格、价值观、边界）
├── IDENTITY.md     # 外部展示（名字、emoji、头像）
├── AGENTS.md       # 工作方式（流程、工具、规则）
└── USER.md         # 用户偏好
```

**生态规模**：
- **80+ 社区角色** 在 ClawSouls Registry
- **SoulScan**：53 条自动化安全检查（prompt 注入、敏感信息、有害内容）
- **跨框架兼容**：OpenClaw、Claude Code、Cursor、Windsurf
- **CLI 工具**：`npx clawsouls install/export/validate/soulscan`
- **VS Code 插件**：直接在编辑器里浏览和安装

**值得学习的点**：

| 设计 | 说明 | 启发 |
|------|------|------|
| **标准化格式** | `soul.json` 定义元数据 | 角色卡需要可解析的元数据 |
| **安全扫描** | 53 条规则自动检测风险 | 导入外部角色卡需要安全校验 |
| **跨框架兼容** | 同一个 SOUL.md 在不同工具里都能用 | 格式要通用，不绑定特定实现 |
| **社区生态** | Registry + Directory + CLI | 生态需要发现和分发机制 |
| **版本管理** | semver + diff + migrate | 角色卡要可演进 |

**SoulSpec 的 SOUL.md 结构**：
```markdown
# 角色名称

## Personality（人格）
## Principles（原则）
## Boundaries（边界）
## Vibe（风格）
```

---

### 1.3 souls.directory

**项目地址**：https://github.com/thedaviddias/souls-directory

**核心洞察**：免费、开源的 SOUL.md 模板目录

**分类体系**：
- Technical（工程、DevOps、安全）
- Professional（商业、工作流）
- Creative（写作、设计）
- Educational（教学、辅导）
- Wellness（心理支持）
- Research（分析、调研）

**值得学习的点**：

| 设计 | 说明 | 启发 |
|------|------|------|
| **分类浏览** | 按场景和用途分类 | 角色卡需要分类体系 |
| **即拷即用** | 复制粘贴就能用 | 低门槛导入 |
| **社区贡献** | GitHub OAuth 登录 → 上传 | 生态需要贡献机制 |
| **MIT 协议** | 全部免费开源 | 开放促进生态繁荣 |

---

### 1.4 openclaw-multi-agent-kit

**项目地址**：https://github.com/raulvidis/openclaw-multi-agent-kit

**核心洞察**：生产级多 Agent 团队模板

**团队组成**（10 个 Agent）：
- Ops Agent（运维）
- Research Agent（调研）
- PM Agent（产品）
- Designer Agent（设计）
- ...

**值得学习的点**：

| 设计 | 说明 | 启发 |
|------|------|------|
| **共享上下文** | `shared-context/` 目录 | 团队要有共享信息层 |
| **生产验证** | 已在 Telegram 群组跑通 | 模板要经过实战检验 |
| **AI 可读的安装说明** | 写给 Agent 看的 setup 指南 | 文档要考虑 AI 消费者 |

---

### 1.5 GitHub Copilot Custom Agents

**位置**：`.github/agents/`

**格式**：
```yaml
---
name: dev
description: Full Stack Developer
tools: ['read', 'search', 'edit', 'run', 'github', 'web']
---

# James — Full Stack Developer

## Role
Code implementation, debugging, TDD workflow

## Style
Pragmatic, test-first, frequent commits
```

**值得学习的点**：

| 设计 | 说明 | 启发 |
|------|------|------|
| **YAML frontmatter** | 结构化元数据 | 元数据和内容分离 |
| **工具权限** | 显式定义能用什么工具 | 能力边界要明确 |
| **项目级配置** | 放在 `.github/agents/` | 角色卡可以跟项目走 |

---

## 二、生态全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Agent 角色卡生态                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📚 标准层                                                          │
│  ├── SoulSpec (开放标准)                                           │
│  ├── OpenClaw SOUL.md                                              │
│  └── GitHub Copilot Agent Format                                   │
│                                                                     │
│  🏪 分发层                                                          │
│  ├── ClawSouls Registry (80+ 角色，有安全扫描)                     │
│  ├── souls.directory (免费模板，MIT)                                │
│  ├── GitHub 仓库 (openclaw-multi-agent-kit 等)                     │
│  └── 各平台内置                                                     │
│                                                                     │
│  🔧 工具层                                                          │
│  ├── ClawSouls CLI (npx clawsouls)                                │
│  ├── VS Code 插件                                                   │
│  ├── MCP Server                                                     │
│  └── 各 IDE 集成                                                    │
│                                                                     │
│  🛡️ 安全层                                                          │
│  ├── SoulScan (53 条规则)                                          │
│  ├── 框架级沙箱                                                     │
│  └── 社区审查                                                       │
│                                                                     │
│  🏗️ 应用层                                                          │
│  ├── OpenClaw (原生支持)                                           │
│  ├── Claude Code (via plugin)                                       │
│  ├── Cursor (.cursorrules)                                          │
│  ├── Windsurf (.windsurfrules)                                      │
│  └── Agent Task Hub (我们)                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、关键设计洞察

### 3.1 角色卡的三个层次

| 层次 | 定义 | 示例 |
|------|------|------|
| **身份层** (WHO) | 角色是谁，人格、价值观、边界 | SoulSpec 的 SOUL.md |
| **能力层** (WHAT) | 角色能做什么，工具、技能 | Skill 系统、工具权限 |
| **行为层** (HOW) | 角色怎么做，工作流、审核、升级 | Edict 的工作流定义 |

**现状**：大多数项目只做了身份层和能力层

**机会**：行为层是差异化竞争力——定义「怎么做」而不只是「是谁」

### 3.2 团队 vs 角色集合

```
方案 A：角色集合
────────────────
角色 A + 角色 B + 角色 C
→ 只是批量导入，没有协作规则
→ 用户需要自己配置谁和谁怎么配合

方案 B：团队套件（一等公民）
────────────────────────
团队 = 角色 + 工作流 + 通信矩阵 + 共享上下文
→ 团队本身就是产品
→ 用户拿到的是「能跑的团队」，不是「散装角色」
```

**Edict 的做法**：三省六部是一个整体，12 个角色通过权限矩阵和状态机串联

**我们的机会**：做团队套件，让用户一键导入「工程三件套」「全栈团队」「研究团队」

**当前产品模型**：TeamPack 已经不只是导入格式，而是项目团队的配置单元。一个项目绑定 TeamPack 后，角色列表、任务流程、团队协作规则、提示词团队上下文、Skill 绑定和 A2A handoff 都应从同一份团队定义解析。用户理解的是“一支团队如何协作”，而不是多个内部执行选项如何拼接。

当前关系只有一条：项目（Conversation）选择一个 TeamPack，TeamPack 自身定义成员角色；RoleCard、Account 与 Skill 绑定在对应 `TeamPackRole` 上。不存在“把全局 Agent 再加入 TeamPack”的第二套成员关系，历史 `agent_team_pack` 表不属于当前产品模型。

面向用户的 TeamPack 页面应保持一个清晰主任务：

- 展示已配置的团队成员。
- 提供一个主要创建或连接动作。
- 用成员卡片承载账号、角色卡、Skill 等配置。
- 以“协作规则阻止了这次转交”解释被拦截的团队交接。

页面不应把内部实现概念摊开成多个并列入口，也不应让用户在页面主体和弹窗里重复选择同一件事。

### 3.3 安全与信任

**SoulScan 的 53 条检查**：

| 类别 | 检查内容 |
|------|----------|
| Prompt 注入 | "忽略之前的指令"、"你现在是..." |
| 代码执行 | eval()、exec()、child_process |
| 敏感信息 | AWS Key、GitHub Token、JWT |
| 有害内容 | 暴力、仇恨、欺诈 |
| 社会工程 | 隐藏操作、欺骗用户 |

**启示**：导入外部角色卡必须有安全校验，不能直接信任

### 3.4 格式标准化的价值

**SoulSpec 的成功因素**：
1. 一个 `soul.json` 定义元数据
2. 一个 `SOUL.md` 定义人格
3. 跨框架兼容（同一个文件在 OpenClaw、Claude Code、Cursor 都能用）
4. 社区生态（Registry + CLI + 插件）

**我们的选择**：
- 兼容 SoulSpec 格式（能导入 80+ 角色）
- 扩展工程字段（工作流、审核、升级规则）
- 保持向下兼容（纯 SoulSpec 角色卡也能用）

---

## 四、我们的设计方向

### 4.1 角色卡格式：兼容 + 扩展

```
SoulSpec 层（兼容）           我们的扩展层（新增）
├── soul.json 元数据          ├── engineering 字段
├── SOUL.md 核心身份          ├── WORKFLOW.md 工作流
├── IDENTITY.md 展示          ├── CONSTRAINTS.md 约束
└── AGENTS.md 工作方式        └── team_pack 关联
```

**engineering 字段示例**：
```json
{
  "engineering": {
    "roleType": "implementer",
    "canModifyCode": true,
    "canApprovePR": false,
    "workflow": [
      { "step": "理解需求", "output": "需求确认", "reviewGate": false },
      { "step": "设计方案", "output": "技术方案", "reviewGate": true },
      { "step": "实现代码", "output": "PR", "reviewGate": true }
    ],
    "escalationRules": [
      { "when": "需求不明确", "action": "升级给 PM" },
      { "when": "架构变更", "action": "必须人工确认" }
    ]
  }
}
```

### 4.2 团队套件：一等公民

```yaml
# pack.json
name: engineering-trio
displayName: 工程三件套
roles:
  - id: planner
    displayName: 规划师
    soul: "roles/planner/SOUL.md"
  - id: coder
    displayName: 实现者
    soul: "roles/coder/SOUL.md"
  - id: reviewer
    displayName: 审查者
    soul: "roles/reviewer/SOUL.md"

workflow:
  type: state_machine
  states:
    - name: planning
      role: planner
      transitions:
        - to: implementing
          condition: 任务拆解完成
    - name: implementing
      role: coder
      transitions:
        - to: reviewing
          condition: PR 提交
        - to: blocked
          condition: 遇到阻塞
    - name: reviewing
      role: reviewer
      transitions:
        - to: done
          condition: 审查通过
        - to: implementing
          condition: 审查不通过

communicationMatrix:
  planner: { canSendTo: [coder], canReceiveFrom: [reviewer, coder] }
  coder: { canSendTo: [reviewer, planner], canReceiveFrom: [planner, reviewer] }
  reviewer: { canSendTo: [planner, coder], canReceiveFrom: [coder] }
```

### 4.3 导入管道：安全优先

```
用户提供 GitHub URL
  ↓
Git clone (shallow, timeout 30s)
  ↓
扫描目录结构
  ├── 找到 soul.json? → 解析 SoulSpec 格式
  ├── 找到 SOUL.md? → 解析裸文件
  └── 都没有? → 报错
  ↓
安全扫描 (SoulScan 规则子集)
  ├── Prompt 注入检测
  ├── 敏感信息检测
  └── 有害内容检测
  ↓
转换为内部 RoleCard 格式
  ↓
写入 SQLite
  ↓
可选：绑定到 Agent
```

### 4.4 预置团队套件

| 套件 | 角色 | 适用场景 |
|------|------|----------|
| **工程三件套** | Planner + Coder + Reviewer | 中小型项目 |
| **全栈团队** | PM + Designer + Frontend + Backend + QA | 完整产品 |
| **研究团队** | Researcher + Analyst + Writer | 调研报告 |
| **内容团队** | Editor + Writer + Reviewer | 内容生产 |
| **运维团队** | SRE + DevOps + Monitor | 基础设施 |

---

## 五、与现有系统的关系

### 5.1 当前架构

```
用户
  ↓
项目 / 会话
  ↓
任务
  ↓
角色卡（定义谁来做、怎么做）  ← 现在只有身份层
  ↓
Agent 实例（运行时执行者）
  ↓
Runtime / CLI（底层执行能力）
```

### 5.2 目标架构

```
用户
  ↓
项目 / 会话
  ↓
任务
  ↓
团队套件（角色 + 工作流 + 通信矩阵）  ← 新增
  ├── 角色卡 A（身份 + 能力 + 行为）
  ├── 角色卡 B
  └── 角色卡 C
  ↓
Agent 实例（运行时执行者）
  ↓
Runtime / CLI（底层执行能力）
```

### 5.3 PromptComposer 集成

**现在的层**：
```
System Prompt (首次唤醒):
  RoleLayer      — 角色身份、约束
  ProjectLayer   — 项目上下文
  ProjectStatusLayer — 任务概览

User Prompt (每次派发):
  SkillLayer     — 技能指令
  ToolLayer      — 工具定义
  TeamLayer      — 团队花名册
  ProtocolLayer  — 协作协议
  HistoryLayer   — 对话历史
  TaskContextLayer — 任务上下文
  UserMessageLayer — 用户消息
  BehaviorLayer  — 行为约束
```

**目标层**：
```
User Prompt (每次派发):
  SkillLayer
  ToolLayer
  TeamLayer
  TeamPackLayer  ← 新增：工作流、通信矩阵、团队规则
  ProtocolLayer
  ...
```

---

## 六、下一步讨论点

### 6.1 格式设计

- engineering 字段应该多细？
- 工作流放在 SOUL.md 里还是独立文件？
- 通信矩阵需要多详细？

### 6.2 团队套件

- 预置哪些团队组合？
- 团队套件可以嵌套吗？（大团队包含小团队）
- 动态团队 vs 静态团队？

### 6.3 导入管道

- 只支持 SoulSpec 还是也支持其他格式？
- 安全扫描的粒度？
- 导入后可以编辑吗？

### 6.4 生态建设

- 我们要做自己的 Registry 吗？
- 还是只做导入，不做分发？
- 社区贡献机制？

---

## 七、参考资料

| 项目 | 地址 | 核心价值 |
|------|------|----------|
| Edict (三省六部) | https://github.com/cft0808/edict | 中式角色架构、权限矩阵、状态机 |
| SoulSpec | https://github.com/clawsouls/soulspec | 开放标准、安全扫描、跨框架兼容 |
| ClawSouls Registry | https://clawsouls.ai | 80+ 社区角色、CLI 工具 |
| souls.directory | https://github.com/thedaviddias/souls-directory | 免费模板、分类浏览 |
| openclaw-multi-agent-kit | https://github.com/raulvidis/openclaw-multi-agent-kit | 生产级团队模板 |
| GitHub Copilot Agents | `.github/agents/` | YAML frontmatter、工具权限 |
