# ADR-001：工具定义为数据，而非零散函数

**状态**：已采纳  
**日期**：2024-01  
**决策者**：harness-decoded 维护者

> **English:** [001-tools-as-data.md](../../adr/001-tools-as-data.md)

## 背景

设计 Level 1 harness 的工具系统时，需决定工具如何注册与调用。生态中常见两派：

**方案 A：工具即代码**（函数装饰器，类似 LangChain）
```python
@agent.tool
def read_file(path: str) -> str:
    return open(path).read()
```

**方案 B：工具即数据**（带显式 schema 的类型对象，类似 Claude Code 思路）
```python
class ReadFileTool(Tool):
    name = "read_file"
    input_schema = {"type": "object", "properties": {"path": {"type": "string"}}}
    required_permissions = [Permission.FS_READ]

    async def execute(self, args, permissions): ...
```

## 决策

采用 **方案 B：类型化数据对象定义工具**。

## 理由

**权限 enforcement 需要单一咽喉。** 装饰器方案要在每个函数注入检查 —— 易遗漏、难审计。数据化工具只有基类的 `execute()` 一条路径；权限检查在子类代码运行前于基类完成，无法绕过。

**Schema 校验在执行前，而非工具内部。** 装饰器常在调用时于工具内校验。数据化工具在调用 `execute()` **之前** 用 `input_schema` 校验 `args`。模型无法把畸形路径传给读文件工具；harness 在触碰文件系统前就拒绝。

**API 本来就需要 schema。** Anthropic API 要求工具定义为 JSON Schema。装饰器要么手写两份 schema，要么从类型提示生成（脆弱）。数据化工具以 schema 为**唯一真相**，同时驱动 API 与运行时校验。

**可测试性。** 工具对象可脱离真实 agent 循环做单测：权限、校验、错误分类均可单元测试。

**代价**：每个工具样板更多。5 个工具时无所谓；40+ 工具时，结构性保证值得。

## 后果

- 本仓库工具均遵循 `Tool` 基类接口  
- 新能力通过实现接口扩展，而非改 agent 循环核心  
- 权限变更集中在工具定义处  
- `to_api_format()` 作为向 LLM 暴露工具定义的单一来源  
