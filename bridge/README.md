# Opencode Bridge（本机转发）

用途：把你本机的 `opencode` 通过一个 HTTP 服务暴露出来，让远程运行的 Agent Task Hub 可以调用“真实的本机 opencode”。

## 1. 安装检查

```bash
bash scripts/opencode-bridge-install.sh
```

要求：
- Node.js 18+
- opencode 已安装并可通过 `opencode --version` 执行

## 2. 启动 Bridge

默认（每次请求直接执行 `opencode run`）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=run
```

可选（参考 `agent-task-team` 的风格，通过 `opencode attach` 连接本机运行中的实例）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=attach --attach-url=http://localhost:4096
```

## 3. 暴露公网 URL

你需要把 `http://localhost:8787` 暴露成公网可访问的 URL（推荐 https）。

例如（仅示例）：
- `cloudflared tunnel --url http://localhost:8787`
- 或 ngrok

得到公网 URL 之后，打开 Web 右上角「设置」→「Opencode Bridge（本机转发）」：
- 粘贴 URL
- 点「检测」
- 点「启用」

## 4. 协议

- `GET /health`：返回任意文本（用于探活与显示版本）
- `POST /run`：`{ "prompt": "xxx", "sessionId": "optional" }`
  - 返回：文本流（建议逐行输出 NDJSON，直接透传 opencode 的 `--format json` 输出即可）
