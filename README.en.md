<div align="center">
  <sub><b>English</b> | <a href="./README.md">简体中文</a></sub>
  <h1>🐈 Agent Task Hub</h1>
  <h3>An Agent OS for software delivery</h3>
  <p>
    <strong>Move AI from writing code to taking responsibility for delivery.</strong>
  </p>
  <p>
    <a href="#-why-agent-task-hub">Why</a> •
    <a href="#-what-it-is">What it is</a> •
    <a href="#-core-philosophy">Philosophy</a> •
    <a href="#-quick-start">Quick start</a> •
    <a href="#-docs">Docs</a>
  </p>
  <!-- Replace the image below with a real "team collaboration" screenshot or a 15s GIF (recommended width 1280px) -->
  <img src="docs/assets/hero.png" alt="Agent Task Hub — multi-agent collaboration workspace" width="820" />
</div>

---

## 🎯 Why Agent Task Hub

Today's coding agents can produce a lot of code. But writing code is not the same as delivering a result.

Once work spans dozens of steps, multiple roles, several tools, and hours or days, the hard questions change:

- Does context stay focused on the goal instead of degrading over time?
- Can responsibility and critical facts move cleanly between agents?
- Can work resume after a process, session, or tool failure?
- Did review, testing, and acceptance actually happen, or did an agent merely say they did?
- Can the team retain skills and lessons, then prove the next version is better?

**The missing piece is not only a stronger model. It is an operating system in which an agent team can work reliably.**

Models and execution engines resemble high-performance CPUs: strong at reasoning and generation, but without native memory management, scheduling, durable state, communication, security boundaries, or recovery. Agent Task Hub supplies that Agent OS layer.

---

## 🤖 What it is

Agent Task Hub is not another AI chat tool.

It is an **Agent OS for software delivery**. It organizes Claude, Codex, OpenCode, and other execution capabilities into a team that can keep moving through planning, implementation, review, verification, repair, and delivery.

The **Team Harness is the execution kernel** of this Agent OS. It drives the team's continuous loop, while the wider OS manages context, tasks, communication, capabilities, authorization, durable state, recovery, evidence, and evolution.

You do not create a collection of chat windows. You create **a delivery**: define the goal, acceptance criteria, scope, and authorization; the system keeps going until it returns evidence-backed results or asks one question that truly requires your judgment.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  You: goal + acceptance criteria + scope + authorization    │
│                         ↓                                   │
│  Agent Task Hub · Software Delivery Agent OS                │
│  ├── Memory: relevant context, budgets, and Skills          │
│  ├── Scheduling: task graph, ownership, autonomous progress │
│  ├── IPC: A2A handoffs, packets, and team logs              │
│  ├── Safety: authorization, gates, durable state, recovery  │
│  └── Evolution: evidence, observability, evals, versions    │
│                         ↓                                   │
│  Delivery: changes + criterion-level evidence + limitations │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 💡 Core philosophy

### 1. Agents need an operating system, not more containers

> Multiple agents running at once do not automatically form a reliable team.

Task Graph and Dispatch provide scheduling; layered context provides memory management; project workspaces and durable facts provide a filesystem; A2A provides inter-process communication; authorization, gates, and recovery provide safety and fault tolerance.

### 2. Move from completed chats to completed goals

> Chat is the entry point. Delivery is the outcome.

Goals, acceptance criteria, tasks, handoffs, reviews, tests, and external outcomes form a delivery. One finished agent turn does not mean the work is finished.

### 3. Systems engineering matters more than a longer prompt

> Do not rely on the model to remember every rule. Build an environment where mistakes are harder to make.

Relevant information appears on demand, legal actions are clear, exact data moves through the system, important state survives failures, and risky actions respect authorization.

### 4. Let models judge; let the system preserve certainty

> Agents handle understanding, design, and implementation. The system handles state, boundaries, and proof.

Agents remain free to make open-ended technical decisions. Ownership, exact data transfer, authorization, idempotency, recovery, and completion gates do not depend on model compliance or a single boss agent.

### 5. Humans make decisions, not scheduling glue

Humans own goals, taste, boundaries, and final responsibility. The team handles planning, implementation, review, verification, and recovery. The system asks for help only when knowledge, authorization, or safe judgment is genuinely missing.

### 6. Evidence outranks self-report; improvement must be measurable

Without real review, testing, acceptance, and external receipts, the product cannot claim delivery is complete. Rules, lessons, and Skills can persist, but evaluation and version comparison must prove whether the team actually improved.

---

## ✨ What you can do

| Scenario | How |
|----------|-----|
| **Deliver a product goal** | Define the goal and acceptance criteria; the team advances to a verifiable result |
| **Change an existing codebase** | Analyze, implement, review, test, and close out changes in a real project |
| **Run long-lived work** | Continue across sessions, restarts, and repair cycles instead of relying on one long chat |
| **Improve an agent team** | Compare RoleCards, Skills, models, and context policies to find gains or regressions |
| **Connect external task sources** | Feed structured goals such as GitHub Issues into the same delivery loop |

---

## 🚀 Quick start

### Prerequisites

- **Git**
- **Node.js 20.9+**
- **At least one agent runtime**: OpenCode, Claude, or Codex

### Clone from GitHub and start

macOS, Linux, or Git Bash:

```bash
git clone https://github.com/changhuaqiu/agent-task-team.git
cd agent-task-team
./setup.sh    # install dependencies + build
pnpm start
```

Windows PowerShell:

```powershell
git clone https://github.com/changhuaqiu/agent-task-team.git
cd agent-task-team
npm install -g pnpm@10.33.2   # skip if pnpm is already installed
pnpm install
pnpm build
pnpm start
```

For local development, replace the final two commands with `pnpm dev`.

Open [http://localhost:3000](http://localhost:3000), then follow the actual first-use flow:

1. Connect and verify an OpenCode, Claude, or Codex account in Settings.
2. Create a project and select the local code directory and agent team.
3. Choose autonomous team delivery and enter the goal, criterion-level acceptance checks, and authorization.
4. Start the delivery, follow its stage, and handle only exceptions that require your decision.
---

## 🏗️ Architecture

If you're a developer, you may care about these:

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Next.js 16 + React 19 | Modern web app |
| State | Zustand 5 | Frontend state management |
| Database | SQLite | Local persistence, zero config |
| Realtime | Socket.io | Bidirectional WebSocket |
| Agent runtime | ACP (Agent Client Protocol) | A single `AcpBackend` drives OpenCode (native) / Claude / Codex (adapters) over stdio JSON-RPC |

**Unified agent runtime (ACP)**: the daemon drives three runtime classes through one `AcpBackend` over the Agent Client Protocol (stdio JSON-RPC) — OpenCode native ACP, Claude / Codex via `@agentclientprotocol` adapters. A declarative catalog (`agentCatalog.seed.json`) is the startup source of truth with adapter versions pinned; the daemon no longer hardcodes per-engine branches or parses private CLI output.

**Session-level isolation**: each agent keeps an independent session per project — contexts never bleed.

**Queue isolation**: task queues across projects don't interfere with each other.

**Skill system**: reusable capability modules imported from Git repositories.

→ [Full architecture docs](./docs/wiki/01-architecture.md)

---

## 🌟 Why Agent Task Hub

| Aspect | Traditional AI tools | Agent Task Hub |
|--------|----------------------|----------------|
| **Primary object** | A chat or invocation | A delivery with goals and acceptance criteria |
| **Context** | Long-chat memory | Layered, relevant, budgeted project context |
| **Collaboration** | Manual copy/paste or temporary subagents | Task graph, ownership, structured handoffs |
| **Failure handling** | Prompt again and rerun | Durable state, bounded retries, resume from the original workspace |
| **Completion** | Agent self-report | Review, tests, acceptance evidence, and external receipts |
| **Evolution** | Change the prompt or model | Versioned Skills, RoleCards, knowledge, and evaluations |

---

## 🗺️ Roadmap

**Delivered**

- ✅ Project workspace UI
- ✅ Task Graph and multi-agent collaboration
- ✅ Session-level isolation
- ✅ SQLite persistence
- ✅ Skill system
- ✅ Smart task dispatch

**In progress**

- 🚧 A2A ownership, handoff packets, and control-plane integration
- 🚧 Agent, context, tool, and collaboration observability
- 🚧 Unified ACP runtime for OpenCode, Claude, and Codex
- 🚧 Layered context management, progressive loading, and budget gates
- 🚧 System control plane for dispatch, policy, proof, health, and recovery
- 🚧 Persistent autonomous delivery from GoalContract to DeliveryBundle
- 🚧 Agent evaluation with executable regression suites and version experiments
- 🚧 GitHub Issue intake through the same delivery loop

> See the [roadmap doc](./docs/roadmap.md) for full stage goals.

---

## 📚 Docs

| Doc | About |
|-----|-------|
| [Product vision](./docs/product/vision.md) | Why we build this |
| [Architecture](./docs/wiki/01-architecture.md) | Technical deep dive |
| [Dev standards](./docs/sop.md) | How to contribute |
| [Agent guide](./AGENTS.md) | Agent working constraints |
| [Roadmap](./docs/roadmap.md) | Stage goals |
| [All docs](./docs/README.md) | Documentation index |

---

## 🤝 Contributing

We welcome contributions of any kind:

- 🐛 Report bugs
- 💡 Suggest features
- 📖 Improve docs
- 🔧 Submit code

---

## 📄 License

MIT License

---

<div align="center">
  <h3>"Define the goal once. Deliver it with evidence."</h3>
  <p>
    <sub>Move AI from writing code to taking responsibility for delivery.</sub>
  </p>
</div>
