<div align="center">
  <sub><b>English</b> | <a href="./README.md">简体中文</a></sub>
  <h1>🐈 Agent Task Hub</h1>
  <h3>From idea to a running product · Adopt your AI engineering team</h3>
  <p>
    <strong>What stands between an idea and a product isn't a programmer — it's the power to ship.</strong>
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

**Ever been here?**

You have a brilliant idea — a product, a tool, a demo. But you're stuck:

- Hire a developer? Too expensive, and the communication overhead is huge.
- Learn it yourself? Not enough time, and you don't want to become a programmer.
- Use an AI tool? Every time you start from scratch — last conversation, last lessons, last pitfalls, all gone.

**The problem isn't that you lack a stronger AI. It's that you lack a team.**

Traditional AI tools are "one-off assistants" — used once, forgotten, restarted next time. A real team is different:

- They **remember** every decision you made together.
- They **accumulate** the collaboration rhythm you built through practice.
- They **grow** — from 80-point general skills into a 100-point setup that's uniquely yours.

**Agent Task Hub is where you "adopt" a team like that.**

---

## 🤖 What it is

Agent Task Hub is not another AI chat tool.

It's a **multi-agent collaboration platform** — you and multiple AI agents form a virtual engineering team that turns ideas into running products together.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    You (Human)                                              │
│    ├── Provide the vision                                   │
│    ├── Make the calls                                       │
│    └── Walk into the crowd with your work                   │
│                                                             │
│    Agent Team                                               │
│    ├── ⭐ Mario   — Coordination, task breakdown, escalation│
│    ├── ⚡ Luigi   — Full-stack dev (frontend + backend + API)│
│    ├── 🌸 Peach   — Quality (review + integration testing)  │
│    └── ⚙️ DK      — Architecture (on-demand gatekeeping)    │
│                                                             │
│    Practice, grow, and ship together                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 💡 Core philosophy

### 1. Between idea and product stands the power to ship

> What's stuck is not the idea — it's the ability to make it run. Coding is the most direct form of that power today.

Ideas used to travel on slide decks. In the future they travel as POCs and demos that actually run. You don't need a stronger AI tool — you need a team that turns ideas into products.

### 2. Adopt a team, don't configure a tool

> Tools are forgotten after use; teams get stronger with practice.

The collaboration rules you shape together, the pitfalls you hit, the skills you accumulate — they all stay. Reuse them in the next project, and keep growing from a generic 80 to your own 100.

### 3. Peer collaboration, shared memory

> No boss agent. Each has a perspective; free judgment, structured delivery.

Four agents, each with an expertise — coordination, full-stack dev, quality, architecture — each decides whether and how to respond. Execution stays disciplined: TDD, code review, quality gates. Agents share context, so you never have to say "but I already told the last agent."

### 4. AI doesn't sideline you — it puts you on stage

Agent Task Hub doesn't finish your dream for you. It finally gives you a chance to bring your own team and turn ideas into a running world. No resources, no team, no stage before — now agents build it with you, so you can walk into the crowd with your work.

---

## ✨ What you can do

| Scenario | How |
|----------|-----|
| **Build a product prototype** | Describe what you want; the team takes it from 0 to 1 |
| **Improve an existing project** | Connect the codebase; the team analyzes, refactors, adds features |
| **Learn a new technology** | Let the team walk you through a real project, learning as you go |
| **Automate repetitive work** | Tell the team the flow; trigger it with one sentence later |

---

## 🚀 Quick start

### Prerequisites

- **Node.js 18+** (`setup.sh` validates the version)
- **pnpm** (installed automatically by `setup.sh` if missing)
- **At least one agent runtime**: OpenCode (native) / Claude / Codex CLI — to actually drive the agents.

### One-command install

```bash
git clone https://github.com/<owner>/agent-task-hub.git
cd agent-task-hub
./setup.sh    # install dependencies + build
pnpm start    # start (production mode, requires a build first)
```

> **Windows users**: `setup.sh` is a bash script — run it in Git Bash / WSL, or run `pnpm install; pnpm build` manually.
>
> For development (hot reload) use `pnpm dev`, no build needed.

Open http://localhost:3000 and start adopting your team.

### Three steps

```
Step 1: Create a project
  └── Tell the team what you want to build

Step 2: Configure accounts
  └── Connect OpenCode / Claude / Codex so the team can call AI

Step 3: Start collaborating
  └── Send messages, assign tasks, watch progress
```

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
| **Collaboration** | 1-on-1, single-threaded | Multi-agent, parallel |
| **Memory** | Forgotten after use | Persistent, across sessions |
| **Experience** | Start from scratch each time | Gets stronger with practice |
| **Context** | Only the current chat | Shared across the project |
| **Quality** | None | TDD + code review + gates |
| **Use case** | Simple Q&A | Full product development |

---

## 🗺️ Roadmap

**Delivered**

- ✅ Project workspace UI
- ✅ Multi-agent collaboration
- ✅ Session-level isolation
- ✅ SQLite persistence
- ✅ Skill system
- ✅ Smart task dispatch

**In progress**

- 🚧 Unified integration config center — account models + role-card binding
- 🚧 Role Card ecosystem — TeamPack data model + GitHub import + orchestration
- 🚧 Security scanning — prompt injection / secret / dangerous-instruction detection

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
  <h3>"Adopt a team, and grow a world together."</h3>
  <p>
    <sub>So everyone gets a chance to bring their own team and turn ideas into reality.</sub>
  </p>
</div>
