# ADR-001: Tools Defined as Data, Not Code

> **简体中文：** [ADR-001（中文）](zh/adr/001-tools-as-data.md)

**Status**: Accepted  
**Date**: 2024-01  
**Deciders**: harness-decoded maintainers

---

## Context

When designing the tool system for the Level 1 harness, we had to decide how tools would be registered and invoked. Two dominant approaches exist in the ecosystem:

**Option A: Tools as code** (function decorators, like LangChain)
```python
@agent.tool
def read_file(path: str) -> str:
    return open(path).read()
```

**Option B: Tools as data** (typed objects with explicit schema, like Claude Code)
```python
class ReadFileTool(Tool):
    name = "read_file"
    input_schema = {"type": "object", "properties": {"path": {"type": "string"}}}
    required_permissions = [Permission.FS_READ]

    async def execute(self, args, permissions): ...
```

---

## Decision

We use **Option B: tools as typed data objects**.

---

## Rationale

**Permission enforcement requires a choke point.** With function decorators, permission checks must be injected at every function — easily missed, difficult to audit. With typed tool objects, the single `execute()` method is the only way for the harness to run a tool. Permission checks happen once, in the base class, before any subclass code runs. This cannot be bypassed.

**Schema validation before execution, not after.** Function decorators validate at call time, inside the tool. Data-defined tools validate `args` against `input_schema` *before* the tool's `execute()` is called. The model cannot pass a malformed path to a file tool; the harness rejects it before any filesystem access.

**The API needs the schema anyway.** The Anthropic API requires tool definitions as JSON Schema. With function decorators, you either write the schema separately (duplication) or generate it from type hints (brittle). With data-defined tools, the schema is the canonical definition — it drives both the API call and the runtime validation.

**Testability.** A tool object can be instantiated and tested without a live agent loop. You can verify permission behavior, schema validation, and error classification in unit tests, not just integration tests.

**The cost**: more boilerplate per tool. A function decorator is 3 lines; a Tool subclass is 15–20. For a system with 5 tools, this is noise. For a system with 40+ tools (like Claude Code), the structural guarantees are worth it.

---

## Consequences

- All tools in this repo follow the `Tool` base class interface
- Adding a new tool means implementing the interface, not editing the agent loop
- Permission changes are localized to the tool definition, not scattered across the codebase
- The tool registry's `to_api_format()` method is the single source of truth for the LLM's tool definitions
