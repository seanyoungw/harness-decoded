# Contributing to harness-decoded

Thank you for wanting to contribute. This project aims to be the definitive technical resource on the Harness pattern for AI agents.

## What We're Looking For

**High value contributions:**
- New tools for Level 1/2/3 examples (must include both Python and TypeScript implementations)
- Corrections to architectural analysis (please cite sources — leaked source analysis, official docs, or reproducible experiments)
- Additional ADRs documenting design decisions in the examples
- Language ports: Go and Rust implementations of the Level 1 minimal agent would be exceptional
- Performance benchmarks comparing harness implementations

**Not a good fit:**
- "AI-generated" documentation that doesn't add technical depth
- Wrapper-style examples that don't demonstrate harness patterns
- Adding dependencies to Level 1 (it must remain dependency-free except for the Anthropic SDK)

## Adding a New Tool

Tools must implement the base `Tool` interface in both languages:

```python
class MyTool(Tool):
    def __init__(self):
        super().__init__(
            name="my_tool",
            description="...",  # this is shown to the LLM
            input_schema={...},  # JSON Schema
            required_permissions=[Permission.FS_READ]
        )

    async def _run(self, args: dict) -> str:
        # implementation
        ...
```

Include:
- Unit tests in `tests/`
- Documentation in the tool's docstring explaining permission rationale
- An entry in the tools table in `docs/03-tool-system.md`

## Pull Request Process

1. Fork and create a feature branch
2. Make sure both Python and TypeScript examples stay in sync (identical interfaces)
3. Run the existing tests: `pytest examples/python/` and `npm test` in TypeScript dirs
4. Open a PR with a clear description of what you're adding and why it belongs here

## Reporting Architectural Errors

If you find an error in the architectural analysis (the docs make a claim about Claude Code's internals that you can verify is wrong), open an issue with:
- The specific claim
- Evidence it's incorrect (source reference, experiment result)
- What the correct understanding is

These are the most valuable issues to file.

## Code Style

Python: `ruff` for linting, `black` for formatting  
TypeScript: `eslint` + `prettier`

Both are configured in the respective example directories.
