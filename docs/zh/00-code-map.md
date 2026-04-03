# 文档 ↔ 代码对照表

将 **`docs/` 中的概念** 与 **`examples/` 中的可运行代码** 对照阅读。

> **English:** [00-code-map.md](../00-code-map.md)

| 文档 | 主题 | Python | TypeScript |
|------|------|--------|------------|
| [01-architecture](01-architecture.md) | 全栈地图 | 各 Level | 各 Level |
| [02-harness-vs-wrapper](02-harness-vs-wrapper.md) | 理念 + 最小 harness 契约 | `minimal_agent/agent.py` | `minimal-agent/agent.ts` |
| [03-tool-system](03-tool-system.md) | 权限、校验、沙箱 | 各 `agent` 中的 `Tool`、`ToolRegistry`、`PermissionSet` | 同名 TS |
| [04-query-engine](04-query-engine.md) | 重试、流式思路 | `QueryEngine`、`RETRY_POLICIES` | 同上 |
| [05-memory-context](05-memory-context.md) | 压缩、检查点 | `standard_agent`、`production_agent` 的 `MemorySystem` | standard + production |
| [06-multi-agent](06-multi-agent.md) | Fan-out、swarm | `standard_agent` 的 `--parallel`；`production_agent` 的 `SwarmOrchestrator` | standard 的 `--parallel`；production 的 `--swarm` |
| [07-build-guide](07-build-guide.md) | 生产清单 | `production_agent/agent.py`、`docker-compose.yml` | `production-agent/agent.ts` |

## 官方 Claude Code（上游）

| 资源 | 用途 |
|------|------|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 公开 OSS：插件、示例、`.claude` 命令、脚本等 |
| [Claude Code 文档总览](https://code.claude.com/docs/en/overview) | 产品能力与行为 |
| [安装与设置](https://code.claude.com/docs/en/setup) | 安装方式与环境 |
| [01-architecture — 公开仓库与五层图](01-architecture.md) | 见文内「公开仓库、分发产品与本文图表」一节 |

## 实现细节跳转

| 机制 | Python 查看位置 | TypeScript |
|------|-----------------|------------|
| 工具运行前权限门 | `PermissionSet.check` → `Tool.execute` | 同模式 |
| 工具结果错误分类 | `ToolErrorKind`（Level 2+） | 同 |
| API 退避重试 | `QueryEngine.call` | 同 |
| 上下文压缩 + 失败上限 | `MemorySystem.maybe_compact`、`MAX_CONSECUTIVE_FAILURES` | 同 |
| 审计 JSONL | `AuditLog`（Level 2+）；Level 3 链式哈希 | 同 |
| Token 预算 | `TokenBudget` + `ExecutionTrace` | 同 |
| KAIROS / autoDream | `MemorySystem.run_kairos`（Level 3） | `MemorySystem.runKairos`（Level 3） |

## 动画讲解（无需 API Key）

与上表代码对应的可视化页面：

- [Principles（动画）](../../website/principles.html) — 循环、权限、压缩、fan-out  
- [请求生命周期（分步）](../../website/src/pages/request-lifecycle.html)  
- [工具系统 + Undercover](../../website/src/pages/tool-system.html)  
- [多智能体](../../website/src/pages/multi-agent.html)  
- [上下文压缩](../../website/compaction.html)  
- [KAIROS 时间线](../../website/kairos.html)  

打开 `website/index.html` 可进入总览与导航。
