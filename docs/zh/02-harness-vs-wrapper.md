# Harness vs Wrapper：把生产级 AI 与原型区分开的架构分水岭

> 本仓库最重要的一篇；其余文档都建立在此区分之上。

> **English:** [02-harness-vs-wrapper.md](../02-harness-vs-wrapper.md)

---

## Wrapper 陷阱

多数教程长这样：

```python
def run_agent(user_input: str) -> str:
    response = client.messages.create(
        model="claude-opus-4-5",
        messages=[{"role": "user", "content": user_input}]
    )
    return response.content[0].text
```

这是 **Wrapper**。演示漂亮，上生产就碎。

失败模式可预期：
- 上下文一直涨到 token 上限 —— 任务中途崩溃  
- 工具调用失败 —— 无重试、无恢复  
- 两个子任务本可并行 —— 串行瓶颈  
- 任务完成了 —— 没有「做了什么、为什么」的审计轨迹  
- 想加能力 —— 只能改 prompt 字符串，而不是扩展接口  

这些不是 bug，而是 **Wrapper 结构的必然**。再多 prompt 工程也救不了。

---

## Harness 是什么

Harness 是**执行框架**，把 LLM 当作更大系统里**有能力但受约束的组件**，而不是系统本身。

区别在架构，不在表面：

| 关注点 | Wrapper | Harness |
|--------|---------|---------|
| 工具执行 | LLM 出文本，你来解析 | 类型化工具注册表 + schema 校验 |
| 错误处理 | Prompt：「出错了就…」 | 重试策略、熔断、降级 |
| 内存 | 消息数组 append 到上限 | 压缩算法、语义摘要 |
| 并发 | 默认串行 | 结构化并发、任务 fan-out |
| 权限 | 无 / 靠自觉 | 显式权限域、审计日志 |
| 可观测性 | print | 结构化 span、成本、回放 |

泄露的 Claude Code 源码把这点坐实：LLM 调用本身只占约 51 万行中的一小部分，其余是 **Harness**。

---

## Wrapper 无法解决的五种失败模式

### 1. 上下文窗口耗尽

Wrapper 堆消息直到模型拒绝。粗暴截断会丢掉**原始任务与约束**。  
Harness 用 **压缩**：在保留任务相关信息的前提下降低 token。源码中有 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` 及注释：此前每天约 1279 个会话因连续压缩失败烧掉约 25 万次 API 调用 —— 三行常量修复。压缩是带失败模式与降级策略的**子系统**。

### 2. 工具执行不是「生成文本」

Wrapper 常把工具当排版问题；Harness 里 **安全、可审计、权限门控的 bash** 才是 ~29K 行的原因：执行前校验、会话级权限、沙箱、输出规范化、审计、取消/超时、错误分类（可重试/致命/需人）等。

### 3. 串行是吞吐税

独立子任务在 Wrapper 里排队；Harness 用有界的结构化并发与 fan-out，多文件/多网络场景可显著缩短墙钟时间。这很难事后糊在 Wrapper 上。

### 4. 无权限 = 无信任边界

Wrapper 继承宿主进程权限。Harness 有 per-tool 权限、会话授权、敏感操作审批与可审计记录。

### 5. 可观测性不是可选项

Harness 为每次迭代、工具调用、token、耗时打点；出事时可回放决策链。

---

## 何时用哪种

**Wrapper 足够时：** 单轮、无状态；不调外部工具；失败便宜；探索阶段；团队无力维护 harness。

**需要 Harness 时：** 多轮持久状态；写文件/API/shell 等副作用；长任务会顶满上下文；失败昂贵；要合规/调试叙事；可并行的多子任务或多 agent 协作。

经验法则：**只要 agent 能造成「在乎的」副作用，就需要 harness。**

---

## Harness 模式：核心接口

Level 1 示例都实现类似契约：

```python
@dataclass
class HarnessConfig:
    tool_registry: ToolRegistry
    memory: MemorySystem
    permissions: PermissionSet
    max_iterations: int = 50
    compaction_threshold: float = 0.85  # % of context window

class AgentHarness:
    async def run(self, task: str, context: ExecutionContext) -> AgentResult:
        """Execute a task. Returns result + full execution trace."""

    async def step(self, state: AgentState) -> AgentState:
        """Single iteration: observe → decide → act → update."""

    def register_tool(self, tool: Tool) -> None:
        """Extend capability without modifying core logic."""
```

要点：`register_tool` 扩展能力而不改核心循环（观察→决策→行动→更新）。

---

## 泄露印证了什么

**Query Engine ~46K 行** —— 流式、重试、token、缓存等，不是「调一下 API」。  
**Tool System ~29K 行** —— 每个工具是类型化、可验证、沙箱化单元。  
**Memory（KAIROS/autoDream）在 fork 子进程** —— 合并记忆不污染主循环上下文。

这是软件工程决策，不是 prompt 技巧。

---

## 下一步

- [03：工具与权限](03-tool-system.md)  
- [Level 1 示例](../../examples/)  
- [ADR-001](adr/001-tools-as-data.md)  
