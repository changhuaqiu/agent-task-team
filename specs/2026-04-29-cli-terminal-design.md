# Task CLI Terminal Integration Design

## 1. 核心目标
借鉴 AionUi (OfficeCLI) 的架构理念，在现有的 Task Hub 界面中无缝集成 CLI 终端的可视化观测能力。采用 **xterm.js** 提供原生的终端模拟体验，并确保它能完美融入我们已有的《原神》像素风 UI 中。

## 2. 架构设计

### 2.1 展现形态：内嵌于 Task 详情面板
*   **触发机制**: 当用户在左侧 Kanban 看板中点击某张处于 `In Progress` 或 `Review` 状态的任务卡片时，右侧抽屉式面板 (`TaskDetailPanel`) 滑出。
*   **布局设计**: `TaskDetailPanel` 采用垂直分栏布局：
    *   **上半部分 (Metadata)**: 任务描述、需求上下文、依赖关系。
    *   **下半部分 (Terminal View)**: 集成 `xterm.js` 的终端观测窗口。
*   **状态关联**: 终端内容严格绑定于特定的 `Task ID`。这意味着如果在并行执行多个任务，用户点击不同的卡片，下方的终端会随之切换到对应任务的执行现场。

### 2.2 前端实现机制 (Simulated PTY)
由于目前项目是纯前端，我们不直接建立 WebSocket 与后端的 node-pty 进程通信，而是构建一个**终端模拟层**：

1.  **全局状态扩展 (Zustand)**:
    *   增加 `terminalLogs: Record<taskId, string[]>` 用于存储每个任务的日志片段。
    *   增加 `simulateAgentExecution(taskId, commands)` 动作，触发后会向 `terminalLogs` 定时推入带 ANSI 颜色的模拟日志（如编译进度、测试结果）。
2.  **Xterm.js 集成**:
    *   引入 `@xterm/xterm` 和 `@xterm/addon-fit`。
    *   将 `xterm` 的实例挂载到 `TaskDetailPanel` 的某个 `div` 引用上。
    *   监听 Zustand 中 `terminalLogs[taskId]` 的变化，并将新增的内容通过 `term.write()` 写入终端。

### 2.3 像素风主题适配 (Pixel Theme)
为了保持高度统一的 Genshin Pixel Art 风格，终端必须经过深度定制：
*   **字体**: 强制使用全局的等宽像素字体 (`var(--font-geist-mono)` 或自定义的像素英文字体)。
*   **配色方案 (xterm Theme)**:
    *   Background: 极深的石板灰 (`#111111` 或 `var(--bg-app)`)。
    *   Foreground: 高对比度的荧光色（白色为主，成功信息用草元素绿，报错用火元素红）。
    *   Cursor: Block（方块状），不闪烁或极低频闪烁，体现 8-bit 复古感。
*   **容器边框**: 粗实线 (`2px solid`) 结合生硬的阴影 (`4px 4px 0px`)。

## 3. 用户交互流程 (User Flow)

1.  **触发命令**: 
    *   在 Task 详情中，用户或 Agent 决定执行某项操作（例如有一个 `[Run Build]` 按钮）。
    *   点击后，系统在 Global Chat Room 中广播意图：`"Keqing is executing: npm run build"`。
2.  **观测输出**:
    *   `TaskDetailPanel` 下半部分的黑框终端开始闪烁光标。
    *   文本像打字机一样快速流出，伴随 ANSI 颜色变化（绿色 `✔ Compiled successfully`，黄色 `⚠ Warnings`）。
3.  **结果反馈**:
    *   执行完毕后，终端停止输出。
    *   根据终端执行的成功/失败，Agent 在聊天室报告结果并请求下一步指示（例如：`"Build failed with 2 errors. Should I try fixing them?"`）。

## 4. 扩展性 (Future Proofing)
本设计刻意将 UI 组件 (`xterm.js`) 与数据源 (`Zustand mock`) 解耦。未来接入真实后端时，只需将 `simulateAgentExecution` 替换为发起一个 `WebSocket` 连接，并将 `socket.onmessage` 直接重定向到 `term.write()`，UI 层无需任何修改即可升级为真实的 AionUi 终端桥接架构。