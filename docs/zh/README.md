# harness-decoded 中文文档

本仓库用**文档 + 可运行示例 + 静态交互页**解释「**Harness（执行框架）**」与「**Wrapper（薄封装）**」的差异。**不含任何泄露源码**，示例均为原创教学实现。

**英文目录**见 [docs 根目录](../README-zh.md) 的英文索引说明；以下为**中文正文**与对应文件。

## 五分钟路线

1. 读仓库根目录 [README.md](../../README.md) 的「What is a Harness」示意图。  
2. 读 [02-harness-vs-wrapper.md](02-harness-vs-wrapper.md)（最重要的一篇）。  
3. 本地预览：在 `website` 目录执行 `npm start`，浏览器打开 **http://127.0.0.1:5173/**（须 **http**，勿用 https）。或直接打开 `website/index.html`，以及 [principles 动画页](../../website/principles.html)。  
4. 运行 Level 1：`examples/python/minimal_agent` 或 `examples/typescript/minimal-agent`（需 `ANTHROPIC_API_KEY`）。

## 文档索引（中文）

| 文件 | 内容 |
|------|------|
| [00-code-map.md](00-code-map.md) | 文档章节 ↔ 代码 ↔ 动画页对照 |
| [methodology.md](methodology.md) | 叙述层级：公开信息 / 架构重构 / 教学简化 |
| [glossary.md](glossary.md) | 术语表 |
| [exercises.md](exercises.md) | 自测题 |
| [anti-patterns.md](anti-patterns.md) | 常见反例与改法 |
| [decision-tree.md](decision-tree.md) | 选型：wrapper / Level 1–3 |
| [01-architecture.md](01-architecture.md) | 架构总览 |
| [02-harness-vs-wrapper.md](02-harness-vs-wrapper.md) | Harness vs Wrapper |
| [03-tool-system.md](03-tool-system.md) | 工具与权限 |
| [04-query-engine.md](04-query-engine.md) | 查询引擎 |
| [05-memory-context.md](05-memory-context.md) | 内存与上下文 |
| [06-multi-agent.md](06-multi-agent.md) | 多智能体 |
| [07-build-guide.md](07-build-guide.md) | 生产构建清单 |
| [adr/001-tools-as-data.md](adr/001-tools-as-data.md) | ADR：工具即数据 |
| [adr/002-streaming-tools.md](adr/002-streaming-tools.md) | ADR：流式与同步 |
| [adr/003-compaction-triggers.md](adr/003-compaction-triggers.md) | ADR：压缩触发策略 |

## 示例层级

- **Level 1 minimal**：工具注册、权限、查询引擎与重试、执行轨迹。  
- **Level 2 standard**：压缩、审计、并行 fan-out、更完整工具与错误分类。  
- **Level 3 production**：链式审计、健康检查、swarm、KAIROS/autoDream 教学实现等。

Python 与 TypeScript 目录结构对称；细节见各目录 `README.md` 与 [00-code-map](00-code-map.md)。

## 贡献与纠错

见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。架构事实纠错请用 `.github/ISSUE_TEMPLATE/architectural-correction.md`。
