# F180-agent-terminal-cli-design: Agent Interactive Terminal Bridge

## Context
User has external interactive CLI agents (e.g., `opencode` CLI) that are tightly coupled with other systems and cannot expose an API or structured NDJSON output. The user wants Cat Cafe's agents to be able to communicate with these external CLIs directly in the terminal, acting as a bridge between the chatroom and the CLI.

## Approach Selected
**Agent as a Tool User (General Terminal Control)**
Instead of hardcoding a specific parser for the `opencode` CLI, we will expose Cat Cafe's existing `TmuxGateway` infrastructure as MCP tools. The LLM Agent (e.g., Claude/Opus) will act as the human operator: starting the CLI, typing commands into its stdin, and reading its stdout from the terminal screen to report back to the user.

## System Design

### 1. Terminal MCP Tools
We will add a new suite of MCP tools (`terminal-tools.ts`) that leverage `TmuxGateway`:
- `terminal_create`: Creates a new tmux pane (with `remain-on-exit` enabled) and optionally starts a specific allowed command (e.g., `opencode`). Returns a `paneId`.
- `terminal_send_keys`: Sends raw text/keys (like `Enter`, `Ctrl+C`) to a specified `paneId`.
- `terminal_capture`: Captures the current visible text (or scrollback) of a specified `paneId`.
- `terminal_list`: Lists all active terminal panes in the current workspace.
- `terminal_kill`: Kills a specific `paneId`.

### 2. Security & Configuration
To prevent arbitrary code execution, `terminal_create` will not allow arbitrary shell commands like `bash -c "rm -rf /"`. 
- We will introduce an environment variable `CAT_CAFE_ALLOWED_INTERACTIVE_CLIS` (default: `opencode,python,node`).
- `terminal_create` will only accept commands whose base executable matches this allowlist.
- Users can configure their `opencode` path normally (which is resolved via `resolveCliCommand`).

### 3. Agent Workflow
1. User asks the Cat: "启动 opencode，帮我查一下某个问题"。
2. The Cat uses `terminal_create({ command: "opencode" })` to get a `paneId`.
3. The Cat uses `terminal_send_keys({ paneId, keys: "查一下某个问题\n" })`.
4. The Cat uses `terminal_capture({ paneId })` after a short delay (or loops until it sees a prompt) to read the CLI's output.
5. The Cat summarizes the output and replies to the user.
6. The human user can also open the Hub Terminal UI (F089) in the browser to watch the agent driving the CLI in real-time.

## Trade-offs
- **Pros:** Highly flexible. The Agent can interact with *any* text-based CLI (not just `opencode`) without needing custom parsers. The LLM handles formatting and error recovery.
- **Cons:** The Agent has to "guess" when the CLI has finished outputting text by polling `terminal_capture` (since it's a raw PTY, there are no structural `done` events). This may require the Agent to loop a few times.

## Implementation Steps
1. Create `packages/api/src/mcp-server/src/tools/terminal-tools.ts`.
2. Implement the 5 tools using `TmuxGateway` (which is already implemented in `F089`).
3. Add the new tools to the MCP server tool registry (`server-toolsets.ts`).
4. Update environment configuration loader to support `CAT_CAFE_ALLOWED_INTERACTIVE_CLIS`.
