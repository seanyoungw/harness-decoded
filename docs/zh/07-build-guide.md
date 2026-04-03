# 生产构建指南：从设计决策到部署

> 交付生产级 agent harness 的清单与阶段说明。

> **English:** [07-build-guide.md](../07-build-guide.md)

---

## 阶段 0：写代码前的设计决策

### 决策 1：权限边界在哪？

尽可能收紧 `PermissionSet`，日后可放宽。自问：是否写文件、是否 shell、网络域名范围、是否 spawn 子 agent、是否操作非自有仓库。shell + 网络会显著提高审计与沙箱要求。

### 决策 2：上下文窗口策略

会话预期长度、是否需要跨会话记忆、压缩阈值（85% 常用）、是否检查点原始消息。短会话、无状态分类任务不需要 KAIROS/autoDream；长会话、复杂代码库受益大。

### 决策 3：单 agent 还是多 agent？

任务结构能否预先知道；子任务是否足够独立以并行；运维上能接受的最大 agent 数；是否需要冗余互相校验。

### 决策 4：可接受哪些失败模式？

部分完成是否比不做更糟；API 故障要优雅降级还是硬失败；每会话成本上限；是否需要可解释的审计。

---

## 阶段 1：核心 Harness 实现

### 最小可行 Harness（MVP）

- 带权限 enforcement 的工具基类（不是只检查）  
- 类型化工具注册表  
- 对 429/529/500/503 有重试的 Query Engine  
- 带 `max_iterations` 的 agent 循环  
- 执行轨迹（工具调用、token、耗时）  
- 意外 `stop_reason` 的妥善处理  

以上为 Level 1；**缺一项都不建议上生产**。

### 加固清单（Level 2 范畴）

- 工具执行前的输入 schema 校验（不在工具内部才第一次校验）  
- 错误分类（`RETRYABLE` / `INPUT_INVALID` / `PERMISSION_DENIED` / `FATAL` 等）  
- 只追加 JSONL 审计（完整参数 + 结果摘要）  
- Token 预算（会话 + 单次）  
- Shell 沙箱（cwd、环境白名单、超时、输出上限）  
- 带失败计数器的上下文压缩  
- 破坏性操作的审批门  

在给予生产写权限前，应完成上述适用项。

---

## 阶段 2：可观测性

结构化日志（如 Python `structlog` / TS `pino`），记录迭代、工具执行、压缩等事件。

**指标建议：** 会话数、总 LLM 次数、按工具名与成败的工具调用、按模型与进/出的 token、压缩成败、会话成本与时长分布、按状态码的 API 重试次数。

**追踪：** OpenTelemetry 等，便于还原失败会话各步延迟。

英文版含 `structlog` 与 OTel 示例片段。

---

## 阶段 3：安全加固

- API Key：环境变量、不入日志/追踪/错误信息、轮换、最小权限。  
- Shell：cwd 限制、env 白名单、超时、输出上限、执行前记录、危险模式拦截（`rm -rf /`、`git push --force`、`curl | sh` 等）。  
- 文件：默认仅项目根内写；根外需审批；敏感路径保护。  
- 网络：生产域名白名单、新域首次审批、日志脱敏、响应体大小限制。

---

## 阶段 4：测试策略

- **单元测试**：每个工具的权限拒绝、写文件建目录等。  
- **集成测试**：Mock LLM 驱动完整循环。  
- **属性测试**：任意工具输出不应搞崩 harness。  
- **负载测试**：例如 100 并发会话，审计无竞态、预算在并发下仍正确、重试无惊群。

英文版含示例测试代码骨架。

---

## 阶段 5：部署

- 配置全部来自环境变量（模型、预算、`MAX_ITERATIONS`、审计路径、`COMPACT_THRESHOLD`、权限列表等），生产代码无硬编码魔法数。  
- `/health`：API 可达、审计可写、版本号等。  
- 优雅关闭：停止接新会话、等待在跑会话（限时）、刷审计缓冲、停 KAIROS。

---

## 上线前清单（摘要）

**首个用户前：** Phase 1+2 完成；适用项 Phase 3；单测与 mock 集成通过；预算与审计验证；健康检查 200；优雅退出测过；密钥在 secrets 管理而非裸 `.env`。

**扩规模前：** 并发负载、看板、告警、runbook、失控会话处置、成本与紧急关停。

**企业前：** SOC2 式审计格式、与 RBAC 映射、KAIROS/ transcript 保留策略、数据驻留、多租户限流与分租户预算。

---

## 成本粗算

英文版给出轻量/重度使用的 token 与美元量级估算，并说明「工具步用更快模型」在重度使用下可显著降本。

---

## 参考实现

Level 3 示例覆盖 Phase 1–2 及 `FS_READ` / `FS_WRITE` / `SHELL_EXEC` 相关加固项。见 [`examples/python/production_agent/`](../../examples/python/production_agent/) 与 [`examples/typescript/production-agent/`](../../examples/typescript/production-agent/)。
