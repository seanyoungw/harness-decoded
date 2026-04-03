# ADR-002：同步与流式工具执行

**状态**：已采纳  
**日期**：2024-01

> **English:** [002-streaming-tools.md](../../adr/002-streaming-tools.md)

## 背景

Anthropic API 支持同步（完整 `Message`）与流式（`AsyncStream` 事件）。Level 1 最小 agent 用同步；Level 2+ 可选流式。

## 决策

Level 1 使用 **同步** API。Level 2+ 提供 **流式** 选项。

## 理由

**同步更易推理。** 处理开始前已有完整响应；无半状态、无流中断、无增量 JSON 拼装。对教学代码，这种清晰值得牺牲 UX（无实时进度）。

**流式对生产 UX 关键。** 30 秒无反馈的 LLM 调用体验很差；流式让终端 UI 实时更新。Claude Code 源码中终端渲染围绕流式构建。

**Harness 接口两种模式一致。** 均产出相同 `Message`（同步直接得到，流式在流结束后组装）。切换往往是一行配置；Level 1 用户可在不改其它 harness 逻辑的情况下加流式。

## 后果

- Level 1 故意无实时进度指示  
- Level 2 包装流式客户端但仍暴露相同 `Message` 抽象  
- 流中断（网络中途断开）在 Level 2 的 `QueryEngine` 中处理  
