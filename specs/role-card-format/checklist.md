# Role Card Format Checklist

- [ ] 规格字段与当前 TypeScript 类型、repository 和 API 一致。
- [ ] 所有必填字段、可选字段、默认值和拒绝条件明确。
- [ ] 版本兼容策略明确且有自动化测试。
- [ ] 文件路径不能逃逸导入根目录。
- [ ] communication matrix 只能引用 pack 内已定义角色。
- [ ] 示例不与任何内置 TeamPack 或 preset 共用名称。
- [ ] 示例可通过真实 parser/importer 验证。
- [ ] 长期技术文档已同步。

