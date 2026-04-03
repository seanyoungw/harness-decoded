# 练习题

读完 [02-harness-vs-wrapper](02-harness-vs-wrapper.md) 并跑过 Level 1 后的短练习。参考答案为示意，不唯一。

> **English:** [exercises.md](../exercises.md)

## 1. 从 Wrapper 到 Harness（设计）

**题：** 与 [01-architecture](01-architecture.md) 中的 harness 循环相比，朴素的 `while True: call_llm(messages)` 至少缺哪三样东西？

**要点：** 无 `max_iterations`；无工具权限门；上下文增长时无压缩或检查点。

## 2. 追踪权限检查

**题：** 在 `minimal_agent`（Python 或 TS）中，从 `Tool.execute` 追踪到缺少 `FS_WRITE` 时抛出的异常类型。

**要点：** `PermissionSet.check` → 缺失集合 → `PermissionError`（Python）或带 “Missing permissions” 的 `Error`（TS）。

## 3. 重试策略

**题：** 在 `RETRY_POLICIES` 中，429 为何可能带 jitter？

**要点：** 避免多客户端同时撞限后同一时刻重试，形成惊群。

## 4. 压缩失败

**题：** 连续 `MAX_CONSECUTIVE_FAILURES` 次压缩失败后，agent 应做什么？（见 [ADR-003](adr/003-compaction-triggers.md)。）

**要点：** 勿盲目重试压缩；向用户报错 / 优雅降级；可选保存检查点便于调试。

## 5. Fan-out vs Swarm

**题：** 何时 `--parallel`（固定子任务）比 `--swarm`（递归 spawn）更安全？

**要点：** 任务形状已知且有界时用固定 fan-out；需要探索但仍要有硬 `max_agents` 上限时用 swarm。

## 6. 可观测性

**题：** 在受监管环境中，审计条目至少应包含哪三个字段？

**要点：** 谁（会话）、什么（工具 + 参数哈希）、何时（时间戳）；还可加结果/错误类、审批人 id 等。

---

**动手：** 跑一个会触发工具的 Level 1 任务，再打开 `.harness/audit.jsonl`（Level 2+），把一行映射到 [03-tool-system](03-tool-system.md) 的某一节。
