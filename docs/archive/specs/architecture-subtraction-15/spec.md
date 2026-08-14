# Architecture Subtraction — Round 15

> Status: implemented
> Date: 2026-08-15

## Goal

删除与正式 ACP backend 不一致的账号验证旁路和 OAuth 假可达模式，让账号“测试连接”验证正式执行实际消费的 provider、模型与凭据。

## Evidence

- `other` provider 的连接测试只执行 `echo "ok"`，没有读取 Base URL、API Key 或模型，任何假账号都会通过。
- Google、Kimi、OpenCode 和 Other 最终都映射到 OpenCode ACP，但验证分别运行 Gemini CLI、Kimi CLI、OpenCode CLI 或空 echo，与正式执行配置不是同一边界。
- Kimi、OpenCode 和 Other OAuth 账号没有可注入 OpenCode 的 provider 凭据，却仍可创建、验证并被 Team Runtime 选择。
- Claude 与 Codex ACP Adapter 明确复用主机 OAuth 登录态，Anthropic/OpenAI OAuth 才有可证明的正式消费边界。

## Contract

1. provider 到正式 engine 的映射只保留一个共享事实源。
2. Google、Kimi、OpenCode、Other 只接受 API Key；设置 UI、POST、PATCH、verify 与 Runtime selection 共用同一规则。除使用默认地址的 Google 外，OpenCode-compatible provider 必须提供 Base URL。
3. 所有 OpenCode-routed provider 的连接测试必须调用 `generateRuntimeConfig()` 生成与 daemon 同构的 provider/model/env，再运行 `opencode`；不得调用旁路厂商 CLI。
4. 删除 `gemini`、`kimi` 与 `other` 的 CLI probe command；尤其不保留 `echo "ok"` 假测试。
5. Anthropic/OpenAI 继续使用 Claude/Codex 连接测试，并允许其 ACP Adapter 已明确支持的主机 OAuth。
6. API Key 账号必须提供密钥、至少一个模型并验证为 `valid` 后才能进入浏览器或服务端 Runtime selection。
7. 临时 OpenCode 配置无论成功失败都必须清理；验证不得写项目配置。

## Exit Criteria

- OpenCode-routed provider 只有配置完整且验证为 `valid` 的 API Key 账号可进入正式执行解析。
- Google/Kimi/OpenCode/Other 连接测试使用真实 OpenCode provider/model config。
- 生产 probe command 无 Gemini/Kimi/Other/echo 假入口。
- provider-to-engine 与 auth-mode 规则均只有一个共享 owner。
- 冻结安装、类型、定向测试、全量测试、构建与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 扩展定向测试：15 files / 238 tests 通过。
- `pnpm build`：通过；仅保留既有 Turbopack NFT trace warning。
- `pnpm test`：1534 passed / 2 skipped / 1 failed；唯一失败为基线同样存在的 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
