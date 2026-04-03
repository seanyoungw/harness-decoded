# 反模式：披着 Harness 外衣的 Wrapper

生产中容易翻车的「智能体」写法，以及 harness 式改法。可与 [02-harness-vs-wrapper](02-harness-vs-wrapper.md) 对照读。

> **English:** [anti-patterns.md](../anti-patterns.md)

## 1. 无界消息数组

```python
# 反模式
messages.append({"role": "user", "content": user})
messages.append({"role": "assistant", "content": model(messages)})
# ... 直到 context_length_exceeded
```

**改法：** 压缩策略 + 原始历史检查点；限制迭代次数；保留任务规格的结构化摘要（见 Level 2 `MemorySystem`）。

## 2. Shell 当字符串乱炖

```python
# 反模式
subprocess.run(response_text, shell=True)
```

**改法：** 类型化的 `bash` 工具：环境白名单、cwd 限制、超时、输出上限、危险模式拦截（Level 2+）。

## 3. 无权限边界

```python
# 反模式
def run_tool(name, args):
    return TOOLS[name](**args)  # 继承宿主进程权限
```

**改法：** 每次执行前检查 `PermissionSet`；敏感类别可选人工审批（Level 1+）。

## 4. 一切皆串行

```python
# 反模式
for path in all_files:
    read_and_summarize(path)  # N 次串行 LLM
```

**改法：** 子任务独立时，有并发上限的 fan-out（Level 2 `--parallel`，Level 3 带容量上限的 swarm）。

## 5. 静默工具失败

```python
# 反模式
try:
    tool()
except Exception:
    pass  # 模型永远不知道
```

**改法：** 错误分类（`RETRYABLE`、`INPUT_INVALID`…），作为 tool_result 返回模型，并写入 trace（Level 2+）。

## 6. 无会话预算

**反模式：** 只在账单控制台事后看花费。

**改法：** `ExecutionTrace` 上的 `TokenBudget`；超限硬停或降级（Level 2+；Level 3 生产配置）。

## 7. 「压缩」= 截断最后 N 条

**反模式：** `messages = messages[-20:]`

**改法：** 基于 LLM 或规则的摘要，显式保留字段（任务、约束、进度）；失败计数器（ADR-003）。

---

若干模式的动画版见 [Principles](../../website/principles.html)。
