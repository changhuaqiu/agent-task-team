# DevOps Task Hub with Genshin Impact Theme & Global Chat Room

## 1. 核心架构：基于“能力发现”的自治路由模型 + 协作大厅

### 1.1 设计理念
结合 DevOps 流程、Superpowers（能力矩阵）、OpenSpec（结构化规范）以及用户体验需求，系统采用**方案1（自治路由模型）**作为底层驱动，并在展现层引入**全局协作大厅（Global Chat Room）**。同时，移除原有的像素猫元素，采用《原神》主题风格（Genshin Impact Theme）提升沉浸感。

### 1.2 核心模型 (Core Models)

*   **Task (统一粒度)**: 
    *   作为需求和执行的统一载体。
    *   包含 `OpenSpec`（声明式需求、验收标准）、`Context`（关联 Issue、上下文代码）、`State`（当前流转状态）和 `Required Superpowers`（执行所需的能力声明，如 `db_write`, `ui_render`）。
*   **Agent (执行者)**: 
    *   带有特定角色和 `Superpowers` 的智能体（例如：“纳西妲-知识库查询”，“钟离-后端架构”）。
    *   主动匹配或被路由到符合其 `Superpowers` 的 Task 上。
*   **Global Chat Room (协作大厅)**: 
    *   一个全局的实时通信面板。
    *   所有跨 Agent 协作、人类审批请求（Approval Requests）、状态流转通知都会以消息的形式汇总在此处。
    *   消息支持对特定 Task 的引用（Reference），点击即可高亮或展开对应的 Task 面板。

---

## 2. 交互与流程 (Interaction & Flow)

### 2.1 任务生命周期与路由
1.  **需求注入 (Injection)**: 
    *   人类用户或外部系统通过“新建任务”将 `OpenSpec` 投入系统，状态为 `pending`。
2.  **拆解与匹配 (Planning & Matching)**:
    *   Planner Agent（如“琴-风团代理团长”）拦截宏观需求，将其拆解为多个携带 `Required Superpowers` 的子 Task。
    *   子 Task 进入任务池，系统根据 `Superpowers` 将其分配给具备相应能力的 Worker Agent。
3.  **执行与协作 (Execution & Collaboration)**:
    *   Worker Agent 在执行过程中，若遇到上下文缺失或需要关键决策（例如：是否允许删除数据库表），则进入 `blocked` 或 `in_review` 状态。
    *   Agent 会向 **全局协作大厅** 发送一条包含选项（Approve/Reject/Provide Info）的互动消息，并 `@人类` 或其他 Agent。
4.  **人类审批/反馈 (Human-in-the-loop)**:
    *   人类在聊天大厅中看到请求，直接在聊天流中点击“Approve”按钮或回复文字。
    *   审批通过后，Task 状态更新为 `in_progress`，Agent 带着人类的反馈继续执行。

### 2.2 UI 布局优化
为了容纳聊天大厅，页面布局将从单一的“看板流”演变为**双列视图 (Two-Column Layout)**：
*   **左侧/主体 (Task Board)**: 
    *   占据 60-70% 宽度。
    *   保留当前的垂直流式 Agent 任务组（Blocked -> In Progress -> Pending -> Done）。
*   **右侧 (Global Chat Room)**: 
    *   占据 30-40% 宽度。
    *   全局滚动聊天流。包含 Agent 汇报、审批卡片、人工干预输入框。

---

## 3. 原神像素风重构 (Genshin Impact Pixel Theme)

为了提升体验，将现有的像素猫（Pixel Cat）视觉元素替换为**《原神》角色的 8-Bit 像素艺术风格**，保留强烈的像素（Pixel Art）硬朗感。

### 3.1 角色映射与卡池管理 (Agent Personas & Pool)
系统采用 **“内置角色池 (Preset Pool) + 自由编队”** 的模式。
*   **全图鉴卡池**: 系统内置多位拥有固定人设、职能 (Role) 和能力矩阵 (Superpowers) 的 Agent 专家。
    *   **Planner**: 琴 (Jean) - 像素风骑士团长，风元素。负责拆解需求。
    *   **Worker (Frontend)**: 刻晴 (Keqing) - 像素风紫发双马尾，雷元素。负责 UI/UX 构建。
    *   **Worker (Backend)**: 钟离 (Zhongli) - 像素风岩王帝君，岩元素。负责架构与 DB。
    *   **Reviewer**: 纳西妲 (Nahida) - 像素风小吉祥草王，草元素。负责代码审计。
    *   *未来可扩展: 阿贝多(算法)、温迪(测试)等...*
*   **队伍编制 (Active Party)**: 
    *   用户的看板（Task Hub）只展示已入队的 Agent。
    *   提供 `[ + Invite Agent ]` 的交互入口，呼出角色池面板，允许用户“招募”新的 Agent 加入当前项目。
    *   支持 `[ Dismiss ]` (离队) 机制，前提是交接完手头的 Task。

### 3.2 视觉语言 (Visual Language)
*   **像素基因 (Pixel DNA)**:
    *   全局继续使用等宽字体 (Monospace) 或像素字体 (如 Press Start 2P, 类似)。
    *   极小圆角 (`rounded-sm` / `4px`) 甚至直角，保持界面的方正感。
    *   卡片边框采用 1px 的实线（Solid Border），并在 Hover 时加入像素风的位移投影（如 `box-shadow: 2px 2px 0px #000`）。
*   **色彩系统 (元素反应)**:
    *   背景与面板：深色石板背景，点缀原神的UI金边色（`#D3BC8E`）。
    *   元素状态：
        *   `Done` (完成): 草元素 (Dendro) 像素绿
        *   `Blocked` (阻塞): 火元素 (Pyro) 像素红
        *   `In Progress` (进行中): 雷元素 (Electro) 像素紫
        *   `Pending` (待处理): 岩元素 (Geo) 像素黄
*   **UI 组件**:
    *   Avatar: 修改 `PixelAvatar.tsx` 中的 8x8 矩阵，重新绘制琴、刻晴、钟离、纳西妲的微型像素头像。
    *   聊天气泡: 采用类似早期 JRPG 游戏（如最终幻想/勇者斗恶龙）的对话框样式：黑色半透明背景 + 白色边框 + 打字机打字机效果。

---

## 4. 实施计划 (Implementation Plan)

1.  **Phase 1: 数据模型更新**: 在 Zustand Store 中引入 `ChatMessage` 实体，增加对全局聊天的状态管理。
2.  **Phase 2: 布局调整**: 重构 `page.tsx`，引入双列布局（左看板，右聊天室）。
3.  **Phase 3: 聊天大厅开发**: 实现 `GlobalChatRoom` 组件，支持文本渲染、Task 引用（点击高亮看板卡片）以及内嵌的审批按钮交互。
4.  **Phase 4: 视觉主题替换**: 清理 CSS 变量，移除猫咪元素，全面应用原神色彩与材质。更新 Agent 的初始数据（名字、头像、角色）。
