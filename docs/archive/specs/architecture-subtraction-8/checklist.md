# Acceptance Checklist

- [x] 根目录只保留 `pnpm-lock.yaml`。
- [x] `highlight.js` 不再是直接依赖，Markdown 高亮仍可构建测试。
- [x] `@types/cross-spawn` 位于 devDependencies，ACP spawn 仍可编译测试。
- [x] frozen install、TypeScript、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
