# Acceptance Checklist

- [x] `/api/state` never exposes a status outside the legacy Kanban vocabulary.
- [x] Hydration and socket sync normalize managed statuses without repeated updates.
- [x] A managed `ready` task cannot crash `MiniKanban`.
- [x] Installed Claude/Codex ACP binaries are preferred; exact pinned fallback remains.
- [x] Claude session `new` and `load` requests carry native-subagent forwarding metadata.
- [x] A stale batch action becomes `cancelled/stale_work_epoch` and a valid sibling is claimed.
- [x] A direct stale action claim remains rejected.
- [x] Relevant automated tests, type-check and Webpack production build pass.
- [x] Real Claude ACP smoke completes with visible text and no `EPIPE`.
- [ ] Freshly restarted production server passes browser and scheduled-wakeup verification.
