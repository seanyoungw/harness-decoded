# 内存与上下文：autoCompact、KAIROS、autoDream

> 生产 agent 最难的不是「聪明」，而是**记忆**。Claude Code 用三套相扣的子系统解决。

> **English:** [05-memory-context.md](../05-memory-context.md)

---

## 根本约束

LLM 有上下文窗口硬上限。真实编码会话可在约一小时内逼近：系统 prompt、扫仓库、多轮读写与工具结果累加。Wrapper 常 **截断** 最旧消息 —— 会丢掉任务规格与约束，灾难性错误。

Harness 的答案是 **压缩**：在保留要义的前提下缩小上下文。

---

## 系统一：autoCompact

在可配置阈值（默认约 **85%** 窗口）触发，用结构化摘要替换部分历史。

### 保留什么

五类信息：任务规格、已完成工作、当前状态、开放问题、关键事实（英文版有 `CompactionSummary` dataclass 示例）。

### 丢掉什么

不属于上述五类的探索性调用、死胡同推理、已在 `key_facts` 中的重复读文件等。

### 压缩失败

若待压缩消息本身已接近上限，压缩用的 LLM 调用也可能超限，形成死循环。对策：`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`，连续失败则停止尝试并向循环报错。泄露注释称此前大量会话在此循环中浪费 API。

英文版有完整 `MemorySystem.maybe_compact` 示例代码。

### 检查点

替换消息前把原始消息检查点到磁盘：便于调试错误摘要、支持多轮压缩后的会话回放。JSONL 只追加，供 KAIROS 消费。

---

## 系统二：KAIROS

后台守护：用户空闲时做**跨会话**记忆合并。

### Fork 架构

要点：**在 fork 的子进程中运行**，不在主 agent 进程。否则合并过程的 LLM 调用会与主会话抢上下文与限流，且合并 bug 可能破坏实时状态。子进程失败不应拖垮主循环。

英文版有 `start_kairos_daemon` 示意与生命周期 ASCII 图。

---

## 系统三：autoDream

在 KAIROS 内运行的合并算法：读 transcript + 旧记忆库 → 产出更好的记忆库。

**五遍处理（概要）：**  
(1) 观察抽取 (2) 去重 (3) 矛盾消解，新胜旧并记录 (4) 暂定→事实的置信提升 (5) 跨会话模式合成。

**不做的事：** 不是构建全代码库知识图谱；那是 `read_file` 的职责。autoDream 积累的是 **元知识**：哪些文件常变、哪些测试飘、哪个 API 曾三次撞限等 —— 类似资深工程师数月形成的直觉。

英文版含 `memory.json` 结构示例与会话开始时 `build_session_context` 注入 `<project_memory>` 的代码。

---

## 示例中的实现

- **Level 1**：无 KAIROS；autoCompact 简化（教学上可能用截断示意）。  
- **Level 2**：完整 LLM 摘要式 autoCompact；KAIROS 含观察抽取与去重。  
- **Level 3**：含矛盾处理、置信提升、模式合成等完整路径。

---

## 下一步

- [06：多智能体模式](06-multi-agent.md)  
- [07：生产构建指南](07-build-guide.md)  
