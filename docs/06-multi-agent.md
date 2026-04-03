# Multi-Agent Patterns: Fan-Out, Gather, and Swarm

> **简体中文：** [多智能体模式](zh/06-multi-agent.md)

> When one agent isn't enough — and when it is.

---

## When to Go Multi-Agent

Multi-agent architectures add complexity. Before reaching for them, check: can a single agent with good tool use handle this?

**Single agent is usually enough when:**
- Task is fundamentally sequential (each step depends on the previous)
- Total context fits comfortably in one window
- Subtasks share enough state that isolation would require constant synchronization
- The task is exploratory — you don't know the subtasks until you're mid-task

**Multi-agent is worth the complexity when:**
- Subtasks are independent and can run concurrently
- Subtasks need different tool sets or permission scopes
- Task exceeds what one context window can hold even with compaction
- You need redundancy (multiple agents checking each other's work)

A rough heuristic from the Claude Code source: multi-agent is triggered when the orchestrator estimates the task will require >15 sequential LLM calls. At that scale, parallel execution of independent subtasks becomes worth the coordination overhead.

---

## Pattern 1: Sequential (Default)

The simplest and most common pattern. Subtasks run one at a time, each receiving the output of the previous.

```
Orchestrator
    │
    ├─ 1. spawn(analyze_codebase)  ──────────────→ result_1
    │      (waits for result_1)
    │
    ├─ 2. spawn(write_tests, context=result_1)  ──→ result_2
    │      (waits for result_2)
    │
    └─ 3. spawn(run_ci, context=result_2)  ───────→ result_3
          (waits for result_3)
          └─ aggregate → final result
```

**When to use**: when subtask B genuinely needs subtask A's output to begin. Don't use when subtasks are independent — you're leaving throughput on the table.

**Implementation**:

```python
async def sequential_fan_out(
    orchestrator: AgentHarness,
    subtasks: list[SubTask],
) -> list[AgentResult]:
    results = []
    context = {}

    for subtask in subtasks:
        enriched_task = subtask.with_context(context)
        result, trace = await orchestrator.run(enriched_task.prompt)
        results.append(result)
        context.update(subtask.extract_context(result))

    return results
```

---

## Pattern 2: Parallel Fan-Out

Independent subtasks spawn concurrently. A barrier collects all results before the orchestrator synthesizes.

```
                    Orchestrator
                    /     |     \
                   /      |      \
          spawn(A)   spawn(B)   spawn(C)
              │          │          │
              ▼          ▼          ▼
           result_A  result_B  result_C
                    \     |     /
                     \    |    /
                    barrier (gather)
                         │
                    synthesize
                         │
                    final result
```

**When to use**: when subtasks are genuinely independent — reading different files, analyzing different modules, checking different APIs.

**Implementation**:

```python
async def parallel_fan_out(
    orchestrator_factory: Callable[[], AgentHarness],
    subtasks: list[SubTask],
    max_concurrency: int = 5,
) -> list[AgentResult]:
    semaphore = asyncio.Semaphore(max_concurrency)

    async def run_with_limit(subtask: SubTask) -> AgentResult:
        async with semaphore:
            harness = orchestrator_factory()  # fresh harness per subagent
            result, trace = await harness.run(subtask.prompt)
            return AgentResult(task=subtask, result=result, trace=trace)

    return await asyncio.gather(*[run_with_limit(t) for t in subtasks])
```

**Critical**: each subagent gets a **fresh harness instance**, not a shared one. Shared state between concurrent agents causes race conditions in the memory system, the audit log, and the token budget. Context isolation is not just good practice — it's a correctness requirement.

**The `max_concurrency` guard** prevents the orchestrator from spawning 50 subagents simultaneously, hitting the rate limit, and then spending all its retry budget on backoff. Five concurrent agents is usually the sweet spot for a standard API tier.

---

## Pattern 3: Swarm

Subagents dynamically discover and spawn further subagents as they encounter complexity. The orchestrator monitors progress through async callbacks rather than waiting at a barrier.

```
Orchestrator
    │
    └─ spawn(explore_module_A)
              │
              ├─ discovers: A depends on B, C, D
              │
              ├─ spawn(analyze_B)  ─→ result_B ─→ reports to orchestrator
              ├─ spawn(analyze_C)  ─→ result_C ─→ reports to orchestrator
              └─ spawn(analyze_D)
                          │
                          ├─ discovers: D is large, spawns sub-subagents
                          ├─ spawn(analyze_D_part1) ─→ result
                          └─ spawn(analyze_D_part2) ─→ result
```

**When to use**: when the structure of the task is unknown in advance and discovered during execution. Code archaeology ("understand this codebase"), dependency analysis, recursive document processing.

**Implementation** (simplified):

```python
class SwarmOrchestrator:
    def __init__(self, harness_factory, max_agents: int = 20):
        self._factory = harness_factory
        self._active: dict[str, asyncio.Task] = {}
        self._results: list[AgentResult] = []
        self._max_agents = max_agents
        self._callbacks: list[Callable] = []

    async def spawn(self, task: str, parent_id: str | None = None) -> str:
        if len(self._active) >= self._max_agents:
            raise SwarmCapacityError(f"Swarm limit ({self._max_agents}) reached")

        agent_id = str(uuid.uuid4())[:8]
        harness = self._factory()

        # Give subagent ability to spawn further subagents
        harness.tool_registry.register(SpawnSubagentTool(self))

        async def run():
            result, trace = await harness.run(task)
            self._results.append(AgentResult(agent_id, parent_id, result, trace))
            del self._active[agent_id]
            for cb in self._callbacks:
                await cb(agent_id, result)

        self._active[agent_id] = asyncio.create_task(run())
        return agent_id

    async def wait_all(self) -> list[AgentResult]:
        while self._active:
            await asyncio.sleep(0.1)
        return self._results
```

**The `SpawnSubagentTool`** is a tool that subagents can call to spawn further subagents through the orchestrator. This is how the swarm grows dynamically — subagents don't have direct access to `asyncio.create_task`, they go through the harness's tool system, which enforces the agent count limit.

---

## Context Isolation

Every subagent gets a **scoped context**: a subset of the full session context relevant to its specific task. This is not just a performance optimization — it's a correctness guarantee.

```python
@dataclass
class SubTaskContext:
    task_specification: str          # what this subagent needs to do
    relevant_facts: list[str]        # from parent's memory, task-specific
    available_files: list[Path]      # explicit allowlist (empty = all)
    permissions: PermissionSet       # may be reduced from parent's
    token_budget: int                # fraction of parent's budget
    parent_context_summary: str      # brief summary of parent's progress
```

**Why reduced permissions matter**: a subagent analyzing test files doesn't need `FS_WRITE`. A subagent doing static analysis doesn't need `SHELL_EXEC`. Passing the minimal `PermissionSet` means a confused subagent cannot accidentally delete files or execute arbitrary code. Defense in depth.

**Why the token budget matters**: without per-subagent budgets, a single runaway subagent can consume the entire session budget, leaving the orchestrator unable to synthesize results. Each subagent gets a quota proportional to its expected task complexity.

---

## Result Aggregation

The orchestrator synthesizes subagent results into a coherent final response. This is itself an LLM call — the orchestrator provides all subagent results as context and asks for synthesis.

```python
async def aggregate_results(
    orchestrator: AgentHarness,
    original_task: str,
    results: list[AgentResult],
) -> str:
    synthesis_prompt = f"""Original task: {original_task}

The following subtasks have been completed by subagents:

{format_results(results)}

Please synthesize these results into a coherent response to the original task.
Note any conflicts or gaps in the subagent results."""

    response, _ = await orchestrator.run(synthesis_prompt)
    return response
```

**Conflict detection** is important here. Subagents working in parallel may reach contradictory conclusions (one finds a bug, another doesn't, because they read different versions of the file if a write happened mid-session). The synthesis step needs to surface these conflicts rather than silently choosing one answer.

---

## Failure Handling

Multi-agent systems have more failure modes than single agents.

**Partial failure policy options**:

```python
class FailurePolicy(Enum):
    ABORT_ON_FIRST  = auto()  # any failure aborts the entire task
    BEST_EFFORT     = auto()  # continue with successful results, skip failed
    RETRY_FAILED    = auto()  # retry failed subagents once before deciding
    REQUIRE_ALL     = auto()  # all subagents must succeed for task to succeed
```

The choice depends on the task. For code refactoring (all modules must be updated), use `REQUIRE_ALL`. For analysis (collect as much information as possible), use `BEST_EFFORT`. For write operations where partial completion is worse than no completion, use `ABORT_ON_FIRST`.

---

## When Swarms Go Wrong

Two failure modes unique to swarm architectures:

**Infinite spawning**: a subagent discovers a complex dependency, spawns sub-subagents, which discover further complexity, which spawn more agents... The `max_agents` cap prevents this from consuming infinite resources, but the orchestrator needs to handle the `SwarmCapacityError` gracefully — typically by falling back to sequential processing.

**Coordination overhead exceeds benefit**: if subtasks are not actually independent (they all need to write the same file, they all need the same API result), the coordination overhead of spawning, context-passing, and result-gathering can exceed the benefit of concurrency. A simple way to check: if subtasks share more than ~30% of their context, they're probably better as a single agent task.

---

## Implementation in the Examples

- **Level 1**: No multi-agent. Single harness only.
- **Level 2**: Parallel fan-out with configurable `max_concurrency`. No dynamic spawning.
- **Level 3**: Full swarm orchestrator with `SpawnSubagentTool`, `SwarmCapacityError` handling, and conflict-aware synthesis.

---

## Next

- [Doc 07: Production Build Guide](07-build-guide.md) — putting it all together for deployment
