# Glossary

> **简体中文：** [术语表](zh/glossary.md)

Short definitions for terms used across docs and examples. Wording is pedagogical, not legal or product-specific.

| Term | Definition |
|------|------------|
| **Harness** | Execution framework around an LLM: tools, permissions, memory, query engine, and orchestration — the LLM is one component. |
| **Wrapper** | Thin code that formats prompts and returns model text, without structured tools, retries, or durable session semantics. |
| **Tool System** | Typed tools with schemas, permission requirements, execution sandbox, and normalized results. |
| **Query Engine** | Layer that calls the model API with retries, streaming handling, token accounting, and (in full systems) caching. |
| **PermissionSet** | Session grants; tools declare required permissions; missing grants block or require approval. |
| **Execution trace** | Structured log of iterations, tool calls, timings, and token usage for a run. |
| **autoCompact** | When context nears a threshold, replace older turns with a structured summary while preserving task intent. |
| **Compaction failure cap** | Limit on consecutive failed compactions to avoid infinite API retry loops (see ADR-003). |
| **KAIROS** | Background consolidation of session data into durable project memory (here often **simulated** as async task, not a real OS fork). |
| **autoDream** | Synthesis passes that merge transcripts into facts, patterns, and open questions in the memory store. |
| **Fan-out** | Run multiple subtasks concurrently (e.g. per-directory agents), then aggregate. |
| **Swarm** | Subagents may spawn further subagents via a controlled tool, up to a capacity limit. |
| **Undercover mode** | Conceptual mode where public-repo git metadata is scrubbed of internal codenames and sensitive attribution (see tool-system doc). |
| **IDE Bridge** | Transport between editor/terminal and harness; thin — no AI decisions inside the bridge. |
| **stop_reason** | API signal for why generation ended (e.g. end_turn vs tool_use). |
| **Audit log** | Append-only record of tool invocations (and in Level 3, hash-chained for tamper evidence). |

## 中文速查（简要）

| 英文 | 中文要点 |
|------|-----------|
| Harness | 执行框架，模型只是其中一环 |
| Wrapper | 薄封装，缺工具链与工程化能力 |
| autoCompact | 上下文将满时压缩历史，保留任务要点 |
| KAIROS / autoDream | 后台整理会话 → 项目级记忆（本仓库多为教学级模拟） |

See [README-zh](README-zh.md) for a short Chinese navigation guide.
