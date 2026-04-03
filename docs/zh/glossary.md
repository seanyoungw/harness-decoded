# 术语表

文档与示例中常用术语的简短定义。措辞为教学用途，非法律或产品声明。

> **English:** [glossary.md](../glossary.md)

| 术语 | 定义 |
|------|------|
| **Harness** | 围绕 LLM 的执行框架：工具、权限、内存、查询引擎、编排 —— LLM 只是其中一环。 |
| **Wrapper** | 薄封装：主要格式化 prompt 并返回模型文本，无结构化工具、重试或持久会话语义。 |
| **Tool System** | 带 schema 的类型化工具、权限要求、执行沙箱与规范化结果。 |
| **Query Engine** | 调用模型 API 的一层：重试、流式处理、token 统计，（完整系统中还有）缓存。 |
| **PermissionSet** | 会话授权；工具声明所需权限；缺失时阻止或需审批。 |
| **Execution trace** | 一次运行中迭代、工具调用、耗时与 token 的结构化记录。 |
| **autoCompact** | 上下文接近阈值时，用结构化摘要替换较早轮次，同时保留任务意图。 |
| **Compaction failure cap** | 连续压缩失败次数上限，避免无限 API 重试循环（见 ADR-003）。 |
| **KAIROS** | 将会话数据整理为持久项目级记忆的后台进程（本仓库常**模拟**为异步任务，而非真实 OS fork）。 |
| **autoDream** | 将多段 transcript 合并为事实、模式与开放问题的合成过程。 |
| **Fan-out** | 多个子任务并发执行（如按目录分 agent），再聚合结果。 |
| **Swarm** | 子智能体可通过受控工具继续 spawn 子智能体，直至容量上限。 |
| **Undercover mode** | 在公开仓库场景下，清理 git 元数据中的内部代号与敏感归因（见工具系统文档）。 |
| **IDE Bridge** | 编辑器/终端与 harness 之间的传输层；很薄 —— 不做 AI 决策。 |
| **stop_reason** | API 表示生成为何结束的信号（如 end_turn vs tool_use）。 |
| **Audit log** | 工具调用的只追加记录（Level 3 可链式哈希防篡改）。 |

## 中英速查

| English | 中文要点 |
|---------|----------|
| Harness | 执行框架，模型只是其中一环 |
| Wrapper | 薄封装，缺工具链与工程化能力 |
| autoCompact | 上下文将满时压缩历史，保留任务要点 |
| KAIROS / autoDream | 后台整理会话 → 项目级记忆（本仓库多为教学级模拟） |

中文导读与索引见 [README.md](README.md)。
