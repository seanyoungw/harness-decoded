# 方法论：论断、证据与重构

本仓库教授面向生产的 **Harness 模式**。并非每一句话都在描述已核实的 Claude Code 源码。

> **English:** [methodology.md](../methodology.md)

## 三类陈述

| 层级 | 含义 | 如何标注 |
|------|------|----------|
| **A — 公开 / 广泛讨论** | 泄露后在公开分析、博客、社区摘要中出现的指标或模块规模 | 表述为社区传闻；视为量级近似 |
| **B — 架构重构** | 从上述讨论**推断**的接口与流程，在本仓库以**原创**教学代码实现 | 见 `examples/` 与 `docs/adr/` |
| **C — 教学简化** | 为清晰而取舍的行为（例如将 KAIROS 的「fork」模拟为 `asyncio.create_task`） | 在代码注释中说明 |

## 公开 Claude Code 仓库（2026）

Anthropic 在 GitHub 上维护 **[anthropics/claude-code](https://github.com/anthropics/claude-code)**。该仓库主要是 **插件、示例、`.claude/` 下的命令定义、脚本及相关开源内容** —— 并不是「可逐文件浏览的完整 CLI 产品源码树」。产品通过官方安装方式分发，见 **[Claude Code 安装与设置](https://code.claude.com/docs/en/setup)** 与 **[文档总览](https://code.claude.com/docs/en/overview)**。

本站若提到「查询引擎约 46K 行」「工具系统约 29K 行」等量级，依据是 **泄漏后的社区分析与架构重构叙述**（上文 **A/B 层**），**除非特别声明，并非**对公开 `anthropics/claude-code` 目录逐文件统计的结果。

## 本仓库不是什么

- **不是源码转储。** 无专有或泄露代码。  
- **不是**任何商业产品的逐行复刻。  
- **不保证**公开轶闻（如会话数、行数）今日仍精确；它们说明**数量级**上的工程现实。

## 站点交互式图示

部分页面含可点击的架构区块；弹层会标明链接的 **层级**：*public*（[anthropics/claude-code](https://github.com/anthropics/claude-code) 树内路径）、*docs*（产品文档或本仓库 `docs/`）、*example*（本仓库 `examples/`）、*disclosure*（泄漏讨论中的架构、公开 OSS 树中无对应文件——见上文 A/B 层）。

## 如何引用本项目

建议：「对 harness 式架构的教学重构（harness-decoded）。」  
避免暗示本仓库**就是**某厂商内部代码库。

## 发现错误时

请用 [architectural-correction](../../.github/ISSUE_TEMPLATE/architectural-correction.md) 开 issue 并附参考。我们优先保证**模式**与**教学准确性**，而非匹配无法核实的细枝末节。
