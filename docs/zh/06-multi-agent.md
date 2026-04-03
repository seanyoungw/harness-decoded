# 多智能体模式：Fan-out、Gather、Swarm

> 何时一个 agent 不够 —— 以及何时其实够了。

> **English:** [06-multi-agent.md](../06-multi-agent.md)

---

## 何时上多智能体

多智能体增加复杂度。先问：**单 agent + 好工具是否够用？**

**单 agent 通常够：** 任务本质串行；总上下文舒适；子任务共享状态多、硬隔离反而要不停同步；探索型任务、子任务形状要边做边发现。

**多智能体值得：** 子任务独立可并发；需要不同工具集或权限域；即使用压缩单窗也装不下；需要冗余（多 agent 交叉检查）。

启发式（来自 Claude Code 讨论）：编排器估计需要 **>15 次顺序 LLM 调用** 时，独立子任务的并行才可能抵消协调成本。

---

## 模式一：顺序（默认）

子任务一个接一个，后一个依赖前一个输出。适用于 B 真的需要 A 的结果才能开始。若子任务独立却用顺序，是在浪费吞吐。

英文版含 `sequential_fan_out` 伪代码。

---

## 模式二：并行 Fan-out

独立子任务并发 spawn，barrier 收集全部结果后再综合。

**要点：** 每个 subagent 应使用 **新的 harness 实例**，共享同一实例会在内存、审计、token 预算上产生竞态。**上下文隔离**是正确性要求，不只是优化。

`max_concurrency`（如 5）避免一次 spawn 几十个 agent 打爆限流与重试预算。

英文版含 `parallel_fan_out` 与 `Semaphore` 示例。

---

## 模式三：Swarm

子 agent 执行中发现复杂度可 **动态** 再 spawn；编排器通过异步回调看进度，而非单纯等在 barrier。

适用于任务结构事先未知：代码考古、依赖分析、递归文档处理等。

`SpawnSubagentTool` 让子 agent 通过工具系统向编排器申请 spawn，从而强制执行 `max_agents` 上限。英文版含简化 `SwarmOrchestrator` 代码。

---

## 上下文隔离

每个 subagent 得到 **scoped context**：任务说明、从父记忆筛过的相关事实、文件白名单、可缩小的 `PermissionSet`、子预算、父进度摘要等。  
缩小权限：分析测试的 subagent 不必有 `FS_WRITE`。子预算避免单个失控 subagent 吃光全会话配额。

---

## 结果聚合

编排器用 **又一次 LLM 调用** 综合各子结果；需显式处理冲突（并行时可能发生版本不一致）。

---

## 失败策略

`ABORT_ON_FIRST` / `BEST_EFFORT` / `RETRY_FAILED` / `REQUIRE_ALL` 等按任务选择：重构要全模块一致用 `REQUIRE_ALL`；分析收集信息用 `BEST_EFFORT`；部分写入比全失败更糟用 `ABORT_ON_FIRST`。

---

## Swarm 特有风险

- **无限 spawn**：靠 `max_agents` 硬顶，容量满时优雅降级到顺序等。  
- **协调成本 > 收益**：若子任务共享 >~30% 上下文，可能不如单 agent。

---

## 示例中的实现

- Level 1：无多智能体。  
- Level 2：可配置 `max_concurrency` 的并行 fan-out，无动态 spawn。  
- Level 3：`SpawnSubagentTool`、`SwarmCapacityError`、冲突感知的综合。

---

## 下一步

- [07：生产构建指南](07-build-guide.md)  
