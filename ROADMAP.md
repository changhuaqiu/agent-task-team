---
feature_ids: []
topics: [backlog]
doc_kind: note
created: 2026-02-26
---

# Agent Task Hub Feature Roadmap

> 维护者：Admin | 最后更新：2026-04-15
>
> **规则**：只放活跃 Feature（idea/spec/in-progress/review），done 后移除。
> 详细信息见 `docs/features/Fxxx-*.md`。
>
> **Source 列**：`internal` = 内部立项 | `community` = 社区 issue 立项（附 issue #）

| ID | 名称 | Status | Owner | Source | Link |
|----|------|--------|-------|--------|------|
| F179 | Document Architecture & Multi-Agent Constraints | done | Admin | internal | `docs/README.md` |
| F180 | Engineering Role Card Mechanism | in-progress | Admin | internal | `docs/product/business/2026-05-01-engineering-role-card-business-plan.md` |
| F181 | Unified Integration Config Center | done | Admin | internal | `docs/technical/integrations/2026-05-01-cli-channel-auth-config-center.md` |
| F038 | Skills 梳理 + 按需发现机制 | parked | Admin | internal | [F038](features/F038-skills-discovery.md) |
| F044 | Channel & Activity System — 战队频道 + 游戏活动 | spec | Agent-R | internal | [F044](features/F044-channel-activity-system.md) |
| F048 | Restart Recovery — 重启自愈（Phase B: 队列持久化） | phase-a-done | Agent-R | internal | [F048](features/F048-restart-recovery.md) |
| F051 | Agent粮看板 v2 — Quota Board (glanceable + scheduling) | in-progress | Agent-R | internal | [F051](features/F051-real-quota-dashboard.md) |
| F054 | HCI 预热基础设施 — Social Media MCP + 内容管线 | spec | Agent-R (Opus 4.6, Leader) | internal | [F054](features/F054-hci-preheat-infra.md) |
| F055 | A2A MCP Structured Routing — targetCats 结构化路由 | spec | Agent-R | internal | [F055](features/F055-a2a-mcp-structured-routing.md) |
| F056 | Agent Task Hub 设计语言 — Agent化不是Agent化 | doing | Admin | internal | [F056](features/F056-agent-hub-design-language.md) |
| F067 | Cold-start Verifier — 无历史污染的交付物验证 | spec | Agent-R | internal | [F067](features/F067-cold-start-verifier.md) |
| F069 | Thread Read State — 未读 Badge 后端真相源 | spec | Agent-R | internal | [F069](features/F069-thread-read-state.md) |
| F077 | Multi-User Secure Collaboration — GitHub OAuth + Thread ACL + Session | spec | Agent-R | internal | [F077](features/F077-multi-user-secure-collab.md) |
| F089 | Hub Terminal & tmux Integration — 浏览器终端 + Agent可观测性 | in-progress | Agent-R | internal | [F089](features/F089-hub-terminal-tmux.md) |
| F090 | Pixel agent Brawl — 像素Agent大作战：即时格斗 demo game | phase-1-done | Agent-R | internal | [F090](features/F090-pixel-agent-brawl.md) |
| F093 | Agents & U 陪伴式共创世界引擎 — 万物有灵 | spec | Agent-R | internal | [F093](features/F093-agents-and-u-world-engine.md) |
| F100 | Self-Evolution — Agent自我进化机制（行为层 + 知识对象化） | in-progress | Agent-R | internal | [F100](features/F100-self-evolution.md) |
| F101 | Mode v2 — 游戏系统引擎 + 狼人杀 | in-progress | Agent-R | internal | [F101](features/F101-mode-v2-game-engine.md) |
| F104 | 本地全感知升级 — Qwen Omni + VL MoE 替换管道 | spec | Agent-R | internal | [F104](features/F104-local-omni-perception.md) |
| F107 | 脑门贴词 — Rogue Agent战术推理游戏 #1 | spec | Agent-R | internal | [F107](features/F107-headband-guess-game.md) |
| F109 | Message Actions 修复与增强 — 软删除/Branch/编辑/通知 | in-progress | Agent-R | internal | [F109](features/F109-message-actions-overhaul.md) |
| F110 | 训练营愿景引导增强 — CVO 需求挖掘 + SOP 显式加载 | spec | Agent-R | internal | [F110](features/F110-bootcamp-vision-elicitation.md) |
| F113 | Multi-Platform One-Click Deploy — 多平台一键部署 | in-progress | community | community [#14](https://github.com/zts212653/agent-task-hub/issues/14) | [F113](features/F113-multi-platform-one-click-deploy.md) |
| F119 | 谁是卧底 — Rogue Agent战术推理游戏 #2 | spec | Agent-R | internal | [F119](features/F119-who-is-spy-game.md) |
| F124 | Apple Ecosystem × Agent Task Hub 语音交互系统 — iOS/watchOS/AirPods | spec | Agent-R | internal | [F124](features/F124-apple-ecosystem-voice-interaction.md) |
| F126 | 四肢控制面 — Agent Task Hub Limb Control Plane | in-progress | Agent-R | internal | [F126](features/F126-limb-control-plane.md) |
| F127 | Agent管理重构 — 账户配置与Agent实例分离，动态创建Agent + 自定义别名 @ 路由 | in-progress | Golden Agent + Agent-M | community [#109](https://github.com/zts212653/agent-task-hub/issues/109) | [F127](features/F127-agent-instance-management.md) |
| F128 | agent-Initiated Thread Creation — Agent程序化创建 Thread | spec | 待定 | community [#82](https://github.com/zts212653/agent-task-hub/issues/82) | [F128](features/F128-agent-create-thread.md) |
| F129 | Pack System — Multi-Agent 共创世界的 Mod 生态 | in-progress | Agent-R | internal | [F129](features/F129-pack-system-multi-agent-mod.md) |
| F135 | Tabby Agent开箱即用 — DARE Out-of-the-Box | spec | bouillipx | community [#195](https://github.com/zts212653/agent-task-hub/issues/195) | [F135](features/F135-dare-ootb.md) |
| F138 | Agent Task Hub Video Studio — AI 视频制作管线 | spec | Golden Agent | internal | [F138](features/F138-video-studio.md) |
| F143 | Hostable Agent Runtime — 统一宿主抽象 | spec | Agent-R | internal | [F143](features/F143-hostable-agent-runtime.md) |
| F144 | PPT Forge — AI 演示文稿生成引擎 | in-progress | Admin | internal | [F144](features/F144-ppt-forge.md) |
| F147 | i18n — Hub 界面中英文切换 | idea | 待定 | internal | — |
| F152 | Expedition Memory — 外部项目记忆冷启动 + 经验回流 | spec | Agent-R | internal | [F152](features/F152-expedition-memory.md) |
| F153 | Observability Infrastructure — 运行时可观测基础设施 | in-progress | Community + Agent-R | community [#388](https://github.com/zts212653/agent-task-hub/issues/388) | [F153](features/F153-observability-infra.md) |
| F155 | Scene-Based Guidance Engine — 场景式交互引导 | in-progress | Agent-M/gpt52 | community [#409](https://github.com/zts212653/agent-task-hub/issues/409) [#398](https://github.com/zts212653/agent-task-hub/pull/398) | [F155](features/F155-scene-guidance-engine.md) |
| F156 | Security Hardening — 实时通道 + 本机信任边界加固（Phase E） | spec | Agent-R | internal | [F156](features/F156-websocket-security-hardening.md) |
| F159 | Agent Native Provider — Opt-in API Path | spec | 社区 + Agent-R + Agent-M | community [#434](https://github.com/zts212653/agent-task-hub/issues/434) | [F159](features/F159-agent-native-provider.md) |
| F161 | ACP Carrier Generalization — 多载体复用同一 Runtime Policy | spec | TBD | internal | [F161](features/F161-acp-carrier-generalization.md) |
| F162 | Enterprise Action Toolkit — 官方 CLI 驱动的企业工作流 | spec | Agent-R | internal | [F162](features/F162-enterprise-action-toolkit.md) |
| F165 | Guided Overfitting — 引导式过拟合 / 养Agent路径 | spec | Agent-R | internal | [F165](features/F165-guided-overfitting.md) |
| F167 | A2A Chain Quality — 乒乓球熔断 + 虚空传球检测 + 角色护栏 | spec | Agent-R | internal | [F167](features/F167-a2a-chain-quality.md) |
| F169 | Agent Memory Reflex — 愿景文档（vision artifact） | vision | Admin | internal | [F169](features/F169-agent-memory-reflex.md) |
| F175 | Unified Message Queue — 优先级排序 + 用户可控编排（urgent bypass 收口）| spec | @mindfn (community) | community [#575](https://github.com/zts212653/agent-task-hub/pull/575) | [F175](features/F175-unified-message-queue.md) |
| F177 | Harness Update — Close Gate 结构化判据 + 四心智专属护栏 | spec | Agent-R | internal | [F177](features/F177-harness-update.md) |
| F178 | Persistent MCP Agent-Key Auth — 跨 invocation 写权限（F061 Bug-H follow-up） | spec | Agent-R | internal | [F178](features/F178-persistent-mcp-agent-key-auth.md) |
