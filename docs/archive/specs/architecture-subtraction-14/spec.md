# Architecture Subtraction — Round 14

> Status: implemented
> Date: 2026-08-15

## Goal

删除无法经 ACP Catalog 执行的 `gemini` Agent engine/runtime 身份，同时保留用户可配置的 Google/Gemini 账号、模型与原生连接验证；Google 账号的正式 Agent 执行统一交给已支持 Google provider 的 OpenCode ACP backend。

## Evidence

- Google 账号已经由 `opencode-config.ts` 写入 OpenCode provider 配置，属于可被正式 OpenCode ACP backend 消费的账号能力。
- 浏览器 store 与 Team Runtime 却把 `google` 映射为 `gemini`，daemon 随后选择 Catalog 中不存在的 engine，形成“账号配置成功、派发必失败”的假能力。
- `gemini-cli` 只存在于 engine/runtime 映射和文档声明中；ACP Catalog 没有 Gemini 条目，也没有 Gemini adapter。
- 账号验证 API 使用原生 Gemini CLI 检查凭证/连接，这一职责独立于 Agent 执行 backend，应继续保留。

## Contract

1. `AccountProvider.google`、Gemini 用户标签、模型建议和原生 API Key 连接验证保持不变；Google OAuth 登录态不能被 OpenCode 消费，因此不得创建或选择为正式执行账号。
2. 浏览器 store 与 Team Runtime 将 Google 账号映射到 `opencode`。
3. 删除 `CliEngine` / `RuntimeCliEngine` 中的 `gemini`，以及 daemon 和 Invocation Planner 中的 `gemini` / `gemini-cli` runtime 映射。
4. 旧浏览器运行时对象或不可变评估快照若仍携带显式 `gemini` / `gemini-cli`，只在各自持久化读取边界迁移为 OpenCode；不改写历史快照，也不恢复独立 Gemini backend。
5. ACP Catalog 继续只暴露 OpenCode、Claude 和 Codex；不新增 Adapter、转发层或兼容 route。
6. daemon 网络入口只接受受支持且相互匹配的 engine/runtime；完全省略时才使用 OpenCode 默认值，未知显式值不得静默回退。
7. Google API Key 账号经 OpenCode 执行时必须显式生成 provider、选中模型和密钥环境配置；历史 Google OAuth 账号在验证与运行时选择两层失败关闭。
8. 当前事实文档明确区分“Google/Gemini 账号验证”与“Agent backend 执行”。

## Exit Criteria

- Google 账号仍可配置并通过既有验证入口检查连接。
- Google 账号派发解析为 OpenCode ACP engine。
- 生产 Agent runtime 类型、映射和 planner 中不再存在 `gemini` / `gemini-cli`。
- 旧显式 Gemini engine/runtime 在持久化读取边界迁移为 OpenCode，其他未知输入拒绝执行。
- 冻结安装、类型、定向测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- Google 账号/API、Team Runtime、OpenCode 配置、历史快照、daemon runtime selection、planner 与架构门禁定向测试：11 个文件，166/166 通过。
- `pnpm build`：通过；正式路由保持不变。
- `pnpm test`：1494 通过、2 跳过、1 个既有基线失败；唯一失败为 `src/server/autonomous-delivery/control-runtime.test.ts:131`，与本轮无关。
- 独立复审：Critical 0、Important 0、Minor 0；Google API Key 正向链、历史 Google OAuth 失败关闭、持久快照迁移与网络入口严格校验均已复核。
