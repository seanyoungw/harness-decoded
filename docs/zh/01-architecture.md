# 架构总览：Claude Code 解码

> **逻辑上的** harness 分层图。**公开可核对的事实**见 [anthropics/claude-code](https://github.com/anthropics/claude-code) 与 [官方文档](https://code.claude.com/docs/en/overview)；图中模块体量数字来自**泄漏后的社区讨论**（见 [methodology.md](methodology.md)）。

> **English:** [01-architecture.md](../01-architecture.md)

---

## 公开仓库、分发产品与本文图表

Anthropic 的 GitHub 仓库 **[anthropics/claude-code](https://github.com/anthropics/claude-code)** 主要包含 **插件 `plugins/`**、**示例 `examples/`**、**`.claude/`**（类 slash 命令与相关配置）、**`scripts/` / `Script/`**、**`.github/`** 下 CI 等 —— **并非**可逐文件对照的完整 `claude` 二进制源码树。产品通过 curl、Homebrew、WinGet 等安装，见 **[安装文档](https://code.claude.com/docs/en/setup)** 与 **[产品总览](https://code.claude.com/docs/en/overview)**。

### 公开产物 ↔ harness 概念

| 上游路径 | 对应的 harness 观念 |
|----------|---------------------|
| [`plugins/`](https://github.com/anthropics/claude-code/tree/main/plugins) | 扩展包：自定义命令、子代理、类工具能力 |
| [`examples/`](https://github.com/anthropics/claude-code/tree/main/examples) | 集成方式与用法示例 |
| [`.claude/`](https://github.com/anthropics/claude-code/tree/main/.claude) | 运行时加载的声明式命令钩子 |
| `scripts/`、`Script/` | 围绕已分发 CLI 的安装与自动化脚本 |

### 与下方五层图的关系

下文 ASCII 图是**教学拆解**（桥接 → 编排 → 代理循环 → 查询引擎 ↔ 内存与工具 → API 模型）。它与**官方文档描述的产品行为**及**泄漏后的架构讨论**一致，但图中的**行数**（如 ~46K / ~29K）属于 **A/B 层量级估计**，**不是**对公开 GitHub 仓库逐文件统计的结果。

---

## 系统地图

```
                        ┌─────────────────────┐
                        │     User / IDE       │
                        └──────────┬──────────┘
                                   │ natural language task
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                        IDE Bridge                             │
│  VSCode extension · JetBrains plugin · CLI terminal UI (Ink) │
│  bidirectional protocol · inline diff preview · approval UI  │
└──────────────────────────────────┬───────────────────────────┘
                                   │ structured task + context
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Multi-Agent Orchestrator                   │
│  task decomposition · subagent spawning · result aggregation │
│  fan-out strategies: sequential / parallel / swarm           │
└────────┬─────────────────────────────────────────┬───────────┘
         │ (main agent)                             │ (subagents)
         ▼                                         ▼
┌─────────────────────┐                ┌─────────────────────┐
│    Agent Loop       │                │    Agent Loop       │
│  (single instance)  │     ...        │  (single instance)  │
└────────┬────────────┘                └─────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│                      Query Engine                             │
│  ~46K lines · streaming · backpressure · retry · caching     │
│  token accounting · cost tracking · model routing            │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
         ┌──────────────────┐         ┌──────────────────────┐
         │   Memory System  │         │    Tool System        │
         │  autoCompact     │         │  ~29K lines           │
         │  KAIROS daemon   │         │  40+ tools            │
         │  autoDream       │         │  permission-gated     │
         │  checkpointing   │         │  sandboxed            │
         └────────┬─────────┘         └──────────┬───────────┘
                  │                              │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │     Claude Model       │
                    │  (via Anthropic API)   │
                    └────────────────────────┘
```

---

## 第一层：IDE Bridge

用户接触的界面。泄露源码中有三种实现：

**终端 UI** — 基于 [Ink](https://github.com/vadimdemedes/ink)（终端里的 React）。因此 Claude Code 的终端输出像完整 UI，而非纯滚动文本。组件含审批对话框、diff 查看器、进度指示与「Buddy」陪伴系统。

**VSCode 扩展** — 本地 socket 双向协议。扩展可以：把文件与光标位置作为上下文发出；接收并预览 diff；为破坏性操作显示行内审批；在编辑器内展示 agent 状态。

**JetBrains 插件** — 同一协议，不同宿主。

**关键设计**：Bridge 是薄传输层。把用户意图与 IDE 上下文序列化为结构化任务对象，**不做任何 AI 决策**。因此无论来自 VSCode、终端还是测试 harness，执行层行为一致。

---

## 第二层：多智能体编排器

任务过大或过于复杂时，编排器分解任务并下发。

泄露源码中的**三种协调模式**：

```
Sequential (default):
  orchestrator → subagent_1 → result_1 → subagent_2 → result_2 → aggregate

Parallel fan-out (independent subtasks):
  orchestrator → subagent_1 ─┐
               → subagent_2 ─┼─ barrier → aggregate results
               → subagent_3 ─┘

Swarm (emergent coordination):
  orchestrator → subagent_1 ─→ discovers subtask → spawns subagent_4
               → subagent_2 ─→ completes → reports to orchestrator
               → subagent_3 ─→ blocked → signals orchestrator
```

**上下文隔离**：每个子 agent 得到**作用域化**的上下文 —— 仅与当前子任务相关，而非完整会话历史。这对性能（更小上下文 = 更便宜调用）与正确性（子任务互不窥视无关对话）都关键。

**结果聚合**：编排器收集各子 agent 的结构化结果并综合。若子 agent 失败，编排器决定重试、跳过或中止 —— 与工具系统同一套错误处理逻辑。

---

## 第三层：Agent 循环

每个 agent（主或子）执行的核心循环：

```
while not done and iterations < max_iterations:
    1. Observe:  build context from memory + current state
    2. Decide:   call LLM via Query Engine, get tool_calls or final_response
    3. Act:      execute tool_calls via Tool System
    4. Update:   add observations to memory, check compaction threshold
    5. Check:    has the task been completed? does human approval need?
```

**迭代上限**：泄露显示「失控循环」是真实运维问题。`max_iterations` 不只是安全阀，也是负载控制；没有它，困惑的 agent 可无限循环、烧光 API 预算。

**审批门**：特定工具调用（破坏性写文件、对新域名的网络请求、匹配敏感模式的 shell 等）会暂停循环并向用户请求审批；仅在明确批准或拒绝后继续。

---

## 第四层：Query Engine（约 46K 行）

最复杂的单模块，负责与 LLM 的所有通信。

**流式管线**：非平凡调用均用流式（`stream=True`）。Query Engine 逐 token 处理，增量拼装 tool call 结构，并实时更新终端 UI。

**背压**：若终端 UI 或下游跟不上流，引擎缓冲并节流，避免长响应在慢机器上撑爆内存。

**重试策略**（来自源码分析）：
```
retryable:
  - 429 → 指数退避 + jitter
  - 529 → 指数退避
  - 500/503 → 固定延迟，最多 3 次
  - 网络超时 → 立即重试，最多 2 次

non-retryable:
  - 400 → 立刻报错
  - 401/403 → 立刻报错
  - context_length_exceeded → 触发压缩后重试一次
```

**响应缓存**：相同的工具-观察序列可命中缓存，对多子 agent 同读一文件的场景很重要。

**模型路由**：泄露中有按任务复杂度路由的逻辑；简单纯工具步可用更快/便宜变体，复杂推理用全量模型。

---

## 第五层：Memory System

**autoCompact** — 上下文约达 **85%** 容量时触发。生成结构化摘要，保留：任务说明、约束与需求、已完成工作、当前进度、开放问题。摘要用以替换被压缩的消息；原始消息检查点到磁盘供回放/调试。

**KAIROS 守护进程** — 用户空闲时在后台运行（与主 agent **fork 隔离**）。职责：读磁盘上所有会话 transcript；合并重叠观察；消解矛盾（新事实优先，除非标为假设）；把暂定笔记提升为持久事实；构建供未来会话加载的「合并记忆」对象。  
Fork 的意义：KAIROS 不能破坏主 agent 的实时上下文；写入独立存储，主 agent 在会话开始时读取。

**autoDream** — KAIROS 的一部分。合并后做「合成遍历」，跨会话找模式：重复错误、常被修改的文件、代码库中已形成惯例等，写成附加在项目上下文上的结构化笔记。

---

## 第六层：Tool System（约 29K 行）

**工具定义结构**（基于泄露分析）：

```typescript
interface Tool {
  name: string
  description: string               // shown to LLM in system prompt
  inputSchema: JSONSchema            // validated before execution
  requiredPermissions: Permission[]  // checked against session grants
  outputSchema: JSONSchema           // normalized output format
  timeout: number                    // hard execution limit
  execute(args: unknown, ctx: ExecutionContext): Promise<ToolResult>
  onError(error: Error, args: unknown): ToolError  // error classification
}
```

**40+ 工具** 分类示例：

| 类别 | 示例 | 关键权限 |
|------|------|----------|
| 读文件 | `read_file`, `glob`, `grep` | `fs:read` |
| 写文件 | `write_file`, `patch_file` | `fs:write` |
| Shell | `bash`, `python` | `shell:execute` |
| 网络 | `web_fetch`, `web_search` | `net:fetch` |
| IDE | `show_diff`, `open_file` | `ide:display` |
| Agent | `spawn_subagent`, `ask_user` | `agent:spawn` |

**Undercover 模式**（`undercover.ts`）— 检测到在公开/开源仓库工作时激活：提交信息清洗内部代号；PR 描述不得引用内部系统；git 元数据抑制 AI 署名；在每次 `git_commit` / `create_pr` 前检查。

---

## Harness 刻意不包含什么

**模型权重** — 接口层与具体模型无关，只调 API。

**业务逻辑** — Harness 不判断任务是否「值得做」；校验在工具层，意图在用户。

**UI 偏好** — IDE Bridge 很薄；终端、扩展或无头测试环境对 harness 无差别。

这种分离使 harness 可复用：它是执行框架，不是具体应用。

---

## 下一步

- **[02：Harness vs Wrapper](02-harness-vs-wrapper.md)** — 为何这种架构重要  
- **[03：工具系统](03-tool-system.md)** — 权限模型深入  
- **[05：内存与上下文](05-memory-context.md)** — autoCompact 与 KAIROS 细节  
- **[Level 1 示例](../../examples/)** — 约三百行代码看完整架构轮廓  
