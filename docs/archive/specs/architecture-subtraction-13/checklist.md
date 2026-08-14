# Acceptance Checklist

- [x] daemon 无 tmux 环境变量、初始化、参数拼装或提前返回分支。
- [x] TmuxGateway、AgentPaneRegistry、OpenCode legacy 参数模块及专属测试已删除。
- [x] session、Runtime Event 与 ACP backend 只剩单一路径。
- [x] runtime context transport 只允许 `acp`。
- [x] Runtime/ACP WebUI 投影保持不变。
- [x] 当前文档与活动规格无 tmux 生产能力声明。
- [x] TypeScript、定向测试、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
