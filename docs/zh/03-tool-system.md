# 工具权限系统：沙箱、审计与撤销

> Claude Code 如何让 40+ 工具能执行系统级操作而不变成安全灾难。

> **English:** [03-tool-system.md](../03-tool-system.md)

---

## 核心问题

能读文件、写文件、跑 shell、发网络的 AI agent，能力上接近（甚至超过）运行它的用户 —— 因为并非每一步都有真人盯着。

被误导或混乱的 agent 可能：覆盖源码、通过网络外传敏感文件、执行破坏性命令、改到用户未打算提交的仓库。

Wrapper 对此无解。Harness 有答案。

---

## 权限域

每个工具声明所需权限；harness 在执行前用会话的 `PermissionSet` 校验。

```
Permission Hierarchy
─────────────────────────────────────────────────
FS_READ         read files, list directories, glob
FS_WRITE        write files, create directories, delete
SHELL_EXEC      execute bash commands, run scripts
NET_FETCH       HTTP requests to external URLs
NET_SEARCH      web search APIs
AGENT_SPAWN     create subagents with their own permissions
IDE_DISPLAY     send diffs and UI events to the IDE
GIT_READ        read git history, diff, log
GIT_WRITE       commit, push, create branches/PRs
```

权限显式累加。工具需要 `FS_WRITE` 而会话只授 `FS_READ` 时 **不能执行** —— 即使用户是 root。

### 默认权限集

```python
PermissionSet.read_only()   # FS_READ only — safe for analysis tasks
PermissionSet.standard()    # FS_READ + FS_WRITE — most coding tasks
PermissionSet.full()        # all permissions — explicit opt-in required
```

默认多为 `standard()`。`SHELL_EXEC` 与 `NET_FETCH` 常在会话创建时显式加入。这不只是 UX —— 也是架构上保证「只分析」任务不会意外触发 shell。

---

## 权限检查路径

```
tool_registry.execute(tool_name, args, context)
    │
    ├─ 1. Tool lookup — does this tool exist?
    │     KeyError if not → hard fail, not recoverable
    │
    ├─ 2. Input schema validation
    │     args validated against tool.input_schema (JSON Schema)
    │     ValidationError → tool_result with error, agent decides to retry or abort
    │
    ├─ 3. Permission check
    │     tool.required_permissions ⊆ context.session.permissions.granted?
    │     PermissionError → surfaced to agent, optionally surfaces approval request to user
    │
    ├─ 4. Approval gate (for sensitive operations)
    │     some tools + some contexts → pause loop, request user approval
    │     user denies → PermissionError with explanation
    │     user approves → execution proceeds with approval logged
    │
    ├─ 5. Sandbox execution
    │     tool._run(validated_args) in sandboxed context
    │     timeout enforced
    │     resource limits applied (memory, CPU for SHELL_EXEC)
    │
    └─ 6. Audit log entry
          timestamp, tool, args, result, duration, session_id
          written before returning result to agent
```

任何一步都不可跳过。这是 [ADR-001](adr/001-tools-as-data.md) 所说的单一 `execute()` 咽喉的价值。

---

## 审批门

部分工具调用在执行前必须人工审批（阈值可配，Claude Code 默认值有教学意义）：

**通常必须审批：**  
项目根外 `write_file`；匹配破坏性模式的 `bash`（`rm -rf`、`DROP TABLE`、`git push --force` 等）；`git_push`；会话中首次访问域名的 `net_fetch`；权限超过父级的 `spawn_subagent`。

**审批提示含：** 完整工具名与参数；为何需要审批；拒绝时 harness 行为；写文件时的 diff 预览。

**同会话内可记忆：** 用户若批准对 `api.github.com` 的 `net_fetch`，同会话后续同域可自动批准，减轻疲劳且仍留审计痕迹。

---

## 审计轨迹

每次工具执行（成败皆有）在结果返回 agent 前写入只追加审计记录。支持回放、调试、合规与按工具耗时做成本分析。

---

## Shell 沙箱

`SHELL_EXEC` 风险最高。Harness 级控制包括：工作目录限制、超时、输出字节上限、环境变量白名单（避免把 `ANTHROPIC_API_KEY` 等泄露给子进程）。见英文版完整 `SandboxConfig` 示例代码。

---

## 错误分类

`ToolErrorKind`：`RETRYABLE`、`INPUT_INVALID`、`PERMISSION_DENIED`、`RESOURCE_MISSING`、`TIMEOUT`、`FATAL`、`NEEDS_HUMAN` 等，让 agent 循环能据此恢复，而非只看一串错误字符串。

---

## Undercover 模式

在公开/开源仓库中，`undercover.ts` 会：阻止提交信息中的内部代号与敏感引用；抑制 git 元数据中的 AI 署名等。检测逻辑包括 LICENSE、远程 URL、`CONTRIBUTING.md` 或 `--public-repo` 等。这既是企业合规场景常见需求，也避免公开贡献违反客户政策。

---

## 示例中的实现

Level 1 实现权限路径，不含审批门（Level 2）。见 `examples/python/minimal_agent/agent.py` 中 `Tool.execute()` 里的 `PermissionSet.check()`。

Level 2 增加：审批中间件、完整 JSONL 审计、工具结果错误分类、shell 沙箱配置。见 `examples/python/standard_agent/`。

---

## 下一步

- [04：查询引擎](04-query-engine.md)  
- [ADR-002：流式与同步](adr/002-streaming-tools.md)  
