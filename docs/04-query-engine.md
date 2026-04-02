# Query Engine Internals: Backpressure, Retry, and Response Caching

> The module that "just calls the API" is 46,000 lines. Here's why.

---

## What the Query Engine Actually Does

At first glance, the Query Engine's job is simple: take a list of messages, send them to the Anthropic API, return the response. This is ten lines of code.

The Query Engine is 46,000 lines because the naive implementation fails in every production scenario:

| Scenario | Naive failure | Query Engine solution |
|----------|--------------|----------------------|
| API rate limit | Hard crash | Exponential backoff with jitter |
| API overloaded | Hard crash | Configurable retry with budget |
| Slow network | Hangs forever | Connection timeout + retry |
| Context too long | Hard crash | Triggers Memory compaction, retries |
| Streaming interrupted | Partial response used as complete | Stream integrity validation |
| Concurrent subagents | Race conditions, duplicate calls | Request deduplication |
| Token budget exceeded | Continues spending | Hard budget enforcement |
| Response partially cached | Full re-call | Semantic cache lookup |

Each row is a class of production incident. The Query Engine handles all of them.

---

## Streaming Pipeline

Claude Code uses streaming for all non-trivial requests. The streaming pipeline processes responses token-by-token, with several important properties:

### Incremental Tool Call Assembly

Tool call arguments arrive as a stream of JSON fragments. The engine assembles them incrementally:

```python
class StreamingToolCallBuffer:
    """Assembles tool_use blocks from streaming chunks."""

    def __init__(self):
        self._blocks: dict[int, dict] = {}  # index → partial block

    def process_chunk(self, chunk: ContentBlockDelta) -> ToolUseBlock | None:
        idx = chunk.index

        if chunk.type == "content_block_start":
            self._blocks[idx] = {"type": chunk.content_block.type, "id": chunk.content_block.id,
                                  "name": getattr(chunk.content_block, "name", None), "input_str": ""}
            return None

        if chunk.type == "content_block_delta":
            if chunk.delta.type == "input_json_delta":
                self._blocks[idx]["input_str"] += chunk.delta.partial_json
            elif chunk.delta.type == "text_delta":
                self._blocks[idx].setdefault("text", "")
                self._blocks[idx]["text"] += chunk.delta.text
            return None

        if chunk.type == "content_block_stop":
            block = self._blocks.pop(idx)
            if block["type"] == "tool_use":
                return ToolUseBlock(
                    id=block["id"],
                    name=block["name"],
                    input=json.loads(block["input_str"])  # parse complete JSON
                )
        return None
```

The terminal UI updates in real time from this stream — the user sees thinking progress, not a blank screen followed by a result.

### Backpressure

If downstream consumers (the terminal renderer, the IDE bridge) process output slower than the API delivers it, the engine buffers and applies backpressure. Without this, long responses on slow machines cause memory exhaustion.

```python
class BackpressureBuffer:
    def __init__(self, max_size: int = 10_000):
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=max_size)

    async def put(self, chunk):
        # Blocks if queue is full — natural backpressure
        await self._queue.put(chunk)

    async def get(self):
        return await self._queue.get()
```

The `maxsize` parameter is the backpressure threshold. When the queue fills, `put()` suspends the stream consumer until the downstream catches up.

---

## Retry Architecture

The leaked source revealed a nuanced retry strategy based on error classification:

```python
@dataclass
class RetryPolicy:
    max_attempts: int
    base_delay_s: float
    max_delay_s: float
    jitter: bool = True

RETRY_POLICIES: dict[int | str, RetryPolicy] = {
    429: RetryPolicy(max_attempts=5, base_delay_s=1.0, max_delay_s=60.0, jitter=True),
    529: RetryPolicy(max_attempts=3, base_delay_s=2.0, max_delay_s=30.0, jitter=True),
    500: RetryPolicy(max_attempts=3, base_delay_s=1.0, max_delay_s=10.0, jitter=False),
    503: RetryPolicy(max_attempts=3, base_delay_s=1.0, max_delay_s=10.0, jitter=False),
    "network": RetryPolicy(max_attempts=2, base_delay_s=0.5, max_delay_s=5.0, jitter=False),
    "context_length": RetryPolicy(max_attempts=1, base_delay_s=0.0, max_delay_s=0.0),
}

async def call_with_retry(request: APIRequest, policy: RetryPolicy) -> APIResponse:
    for attempt in range(policy.max_attempts):
        try:
            return await _call(request)
        except RetryableError as e:
            if attempt == policy.max_attempts - 1:
                raise

            delay = min(
                policy.base_delay_s * (2 ** attempt),
                policy.max_delay_s
            )
            if policy.jitter:
                delay *= (0.5 + random.random() * 0.5)  # ±50% jitter

            await asyncio.sleep(delay)

    raise RuntimeError("unreachable")
```

**Jitter rationale**: Without jitter, all concurrent subagents hit a rate limit simultaneously and retry at exactly the same time — creating a thundering herd. Jitter distributes the retry attempts across a time window, smoothing the load.

**Context length special case**: `context_length_exceeded` errors trigger the Memory System's compaction before the retry, not just a time delay. The retry happens immediately after compaction succeeds — there's no benefit to waiting.

---

## Token Accounting

The Query Engine maintains a real-time token budget for the session:

```python
@dataclass
class TokenBudget:
    session_limit: int            # max tokens for entire session
    call_limit: int               # max tokens per individual call
    used_input: int = 0
    used_output: int = 0

    @property
    def remaining(self) -> int:
        return self.session_limit - (self.used_input + self.used_output)

    def record(self, usage: Usage) -> None:
        self.used_input += usage.input_tokens
        self.used_output += usage.output_tokens
        if self.remaining < 0:
            raise BudgetExceededError(self)

    def estimated_cost_usd(self, model: str) -> float:
        pricing = MODEL_PRICING[model]
        return (self.used_input / 1_000_000 * pricing.input_per_mtok +
                self.used_output / 1_000_000 * pricing.output_per_mtok)
```

The budget is checked after every call. If a session exceeds its limit, the harness surfaces a clear error rather than silently continuing to spend. Enterprise deployments configure per-user and per-project limits; the `TokenBudget` enforces them.

---

## Response Caching

Multi-agent scenarios create a specific caching opportunity: multiple subagents often read the same files as part of their context gathering. Without caching, each subagent independently calls the LLM with identical tool-observation pairs.

The cache key is a hash of:
1. The model identifier
2. The system prompt (normalized, whitespace-stripped)
3. The message sequence up to and including tool results

```python
def cache_key(model: str, system: str, messages: list[dict]) -> str:
    canonical = json.dumps({
        "model": model,
        "system": system.strip(),
        "messages": messages
    }, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()
```

Cache entries expire after 5 minutes by default — long enough to help within a session, short enough to not serve stale responses to a changed codebase.

The cache is in-memory within a session and not persisted between sessions. Persisting it would risk serving cached responses after the codebase changes.

---

## Model Routing

The leaked source contains routing logic that selects between model variants based on request characteristics. The pattern:

```python
def select_model(request: QueryRequest, config: ModelConfig) -> str:
    # Tool-only steps don't need full reasoning capacity
    if request.is_tool_only and not request.requires_synthesis:
        return config.fast_model   # e.g. haiku variant

    # Subagent tasks with scoped context
    if request.is_subagent and request.context_tokens < 10_000:
        return config.fast_model

    # Default: full model for everything else
    return config.default_model
```

The practical implication: routine tool calls (reading a file, listing a directory) can use cheaper/faster model variants. Complex synthesis tasks (understanding a codebase, making architectural decisions) use the full model. This reduces cost without reducing quality on the tasks that matter.

---

## Observability

The Query Engine instruments every call with structured spans:

```python
@dataclass
class QuerySpan:
    call_id: str
    session_id: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    stop_reason: str
    retry_count: int
    cache_hit: bool
    tool_calls: list[str]  # tool names in this response
    error: str | None
    timestamp: float
```

These spans are exported to the audit log and (in production deployments) to OpenTelemetry-compatible collectors. The per-call data enables:
- Latency percentile tracking across sessions
- Cost attribution per task type
- Retry rate monitoring (high retry rates indicate API stability issues)
- Cache hit rate optimization

---

## The 46K Lines, Explained

Now the line count makes sense. The core request path is maybe 200 lines. The remaining ~45,800 lines are:

- **Streaming pipeline**: ~3,000 lines (chunk assembly, backpressure, stream validation)
- **Retry logic**: ~1,500 lines (policy definitions, error classification, jitter math, circuit breakers)
- **Token accounting**: ~800 lines (budget enforcement, cost estimation, per-model pricing tables)
- **Response caching**: ~1,200 lines (key generation, TTL management, invalidation logic)
- **Model routing**: ~600 lines (request classification, model selection, A/B testing hooks)
- **Observability**: ~2,000 lines (span collection, OTLP export, dashboard integration)
- **Tests**: estimated ~36,000 lines (the leaked source was production code; test coverage at this level of infrastructure is extensive)

The tests are the majority. Infrastructure code at this scale needs exhaustive test coverage — retry behavior, edge cases in streaming, budget enforcement under concurrent load. The 46K number almost certainly includes tests.

---

## Implementation Notes for the Examples

The Level 1 harness implements the retry core and token accounting. The streaming pipeline is simplified (using the non-streaming API for clarity). Level 2 adds the full streaming pipeline and response caching.

Key difference from a naive implementation: the retry logic in `QueryEngine.call()` distinguishes error types rather than retrying everything. A 400 error means the request is malformed — retrying without changing it accomplishes nothing. A 429 means try again later. The distinction matters.

---

## Next

- [Doc 05: Memory & Context](05-memory-context.md) — autoCompact and KAIROS in depth
- [Doc 06: Multi-Agent Patterns](06-multi-agent.md) — fan-out, gather, swarm
