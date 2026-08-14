# Acceptance Checklist

- [x] Google/Gemini API Key 账号、模型建议和连接验证保持可用；OAuth 假可达入口已关闭。
- [x] Google 账号解析为 `opencode` Agent engine。
- [x] `CliEngine` / `RuntimeCliEngine` 只保留 Catalog 支持的三种 engine。
- [x] daemon 与 Invocation Planner 无 `gemini` / `gemini-cli` runtime 映射。
- [x] 旧显式 Gemini engine/runtime 在持久化读取边界迁移为 OpenCode，其他无效输入失败关闭。
- [x] 当前事实文档不再把 Gemini 描述为独立 Agent backend。
- [x] TypeScript、定向测试、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
