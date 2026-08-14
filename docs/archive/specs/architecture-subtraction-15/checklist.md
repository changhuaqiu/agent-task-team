# Acceptance Checklist

- [x] provider-to-engine 与 auth-mode 规则只有一个共享 owner。
- [x] Google/Kimi/OpenCode/Other OAuth 无创建、变更、验证或执行入口。
- [x] API Key 缺失、模型缺失、必要 Base URL 缺失或未验证账号不进入执行。
- [x] OpenCode-routed API Key 账号通过真实 provider/model/env 配置验证。
- [x] `gemini` / `kimi` / `other` CLI probe 与 `echo "ok"` 已删除。
- [x] 临时验证配置成功与失败均清理。
- [x] Anthropic/OpenAI OAuth 与 Claude/Codex 验证保持可用。
- [x] 当前事实文档与实现一致。
- [x] TypeScript、定向测试、全量测试和构建已记录。
- [x] 独立复审无 Critical/Important。
