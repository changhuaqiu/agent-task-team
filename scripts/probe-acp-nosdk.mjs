#!/usr/bin/env node
// 无依赖 ACP 握手探测：手搓 JSON-RPC initialize，验各 runtime 的 ACP launcher 能否响应。
// 不安装 SDK、不改 package.json —— 纯可行性验证。
import { spawn } from "node:child_process";

const CANDIDATES = [
  { id: "opencode", delivery: "native",  command: "opencode", args: ["acp"] },
  { id: "claude",   delivery: "adapter", command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
  { id: "codex",    delivery: "adapter", command: "npx", args: ["-y", "@agentclientprotocol/codex-acp"] },
];

function tryOne(c) {
  return new Promise((res) => {
    const p = spawn(c.command, c.args, { stdio: ["pipe", "pipe", "inherit"], shell: true });
    let buf = "", done = false;
    const finish = (r) => { if (done) return; done = true; try { p.kill(); } catch {} res(r); };
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 0 && m.result) finish({ ok: true, protocolVersion: m.result.protocolVersion, agentInfo: m.result.agentInfo });
          else if (m.id === 0 && m.error) finish({ ok: false, err: "rpc-error: " + JSON.stringify(m.error) });
        } catch { /* 非 JSON 行忽略 */ }
      }
    });
    p.on("error", (e) => finish({ ok: false, err: "spawn-error: " + String(e) }));
    // 发 initialize（NDJSON：一行 JSON + 换行）
    const init = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "probe", version: "0" } } }) + "\n";
    setTimeout(() => { try { p.stdin.write(init); } catch (e) { finish({ ok: false, err: "write-error: " + String(e) }); } }, 1500); // 给 npx 拉适配器一点启动时间
    setTimeout(() => finish({ ok: false, err: "timeout" }), 90000); // npx 首次拉适配器可能慢，给足
  });
}

const out = [];
for (const c of CANDIDATES) {
  process.stderr.write(`\n--- probing ${c.id} (${c.command} ${c.args.join(" ")}) ---\n`);
  const r = await tryOne(c);
  out.push({ id: c.id, delivery: c.delivery, ...r });
}
console.log("\n=== ACP 握手探测结果 ===");
console.log(JSON.stringify(out, null, 2));
