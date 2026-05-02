# Bords AI Implementation Brief (Phase 1 to Phase 3)

## 1) Product Direction

Bords should launch AI as a **Bords-controlled platform**:

- One chat interface in Bords for all AI interactions.
- One internal AI gateway that enforces permissions, policies, audit logs, and rate limits.
- Providers (OpenRouter now, direct providers and external agent adapters later) behind an abstraction layer.

This keeps Bords as the trust boundary while still giving flexibility to evolve model vendors and agent platforms.

## 2) MVP Scope (Phase 1)

### In Scope

- A new authenticated AI chat endpoint.
- Task-based model selection policy.
- OpenRouter provider integration.
- Structured request/response schema using Zod.
- Per-user API rate limiting.
- Safe fallbacks when provider is unavailable.

### Out of Scope (for now)

- Autonomous multi-agent delegation loops.
- Direct write actions to canvas without explicit approval.
- External agent adapters (n8n, Claude managed agents, etc.) in production paths.

## 3) Architecture

### Core Components

1. `AI Gateway` (server-side)
- Validates input.
- Selects model by task class.
- Calls provider adapter.
- Normalizes output.

2. `Provider Adapter Interface`
- `OpenRouter` implementation now.
- Easy to add `OpenAI`, `Anthropic`, or local/self-hosted model adapters later.

3. `Model Policy`
- Task class to model mapping.
- Timeout/token ceilings.
- Fallback behavior.

4. `Policy & Guardrails`
- Authentication required.
- Rate limiting required.
- Board-scoped context only in Phase 1.

5. `Observability`
- Response metadata includes provider/model/task/latency/finish reason.
- Logs include sanitized provider errors only.

## 4) OpenRouter Decision

Yes, use OpenRouter for Phase 1 for speed and optionality.

### Why

- Fastest path to ship and iterate.
- Access to multiple model families via a single API.
- Lets us change models without rewriting app logic.

### How We Prevent Lock-In

- All app code calls the internal gateway (`generateAiText`), not provider SDKs directly.
- Provider-specific fields are normalized in one adapter.

## 5) Model Strategy

### Startup Strategy (Single Model)

Use one default model first for operational simplicity. Keep it configurable in env.

Recommended startup default:

- `openrouter/auto` (best early resilience; OpenRouter routes to available model)

If you want strict fixed model behavior, set `OPENROUTER_MODEL` to your chosen model ID.

### Free Model Guidance

For free-tier experimentation, use a free OpenRouter model ID in `OPENROUTER_MODEL`.
Keep in mind free models are useful for prototyping but often lower quality and less stable for production workloads.

### Fine-Tuning Guidance

For startup phase, prefer prompt + schema optimization before fine-tuning.
Fine-tuning should begin only after collecting high-quality acceptance/rejection data and gold prompts.

## 6) Scalability Practices (Built In)

1. Provider abstraction for vendor portability.
2. Task-based model routing (simple now, expandable later).
3. Config-driven model map via environment variables.
4. Request validation and strict limits (`maxTokens`, message lengths, message count).
5. Per-user rate limiting using existing Upstash pattern.
6. Stateless endpoint design for horizontal scale.
7. Timeout control to prevent hung requests.
8. Structured response metadata for monitoring and tuning.

## 7) API Contract (Phase 1)

`POST /api/ai/chat`

Request:

```json
{
  "task": "chat",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Summarize this board." }
  ],
  "context": {
    "boardId": "optional-board-id",
    "organizationId": "optional-org-id"
  },
  "maxTokens": 600,
  "temperature": 0.2
}
```

Response:

```json
{
  "ok": true,
  "text": "...",
  "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 },
  "meta": {
    "provider": "openrouter",
    "model": "openrouter/auto",
    "task": "chat",
    "latencyMs": 0,
    "finishReason": "stop"
  }
}
```

## 8) Rollout Plan

1. **Phase 1 (now)**
- Deploy endpoint + OpenRouter provider + model policy.
- Add internal staff-only UI toggle for testing.

2. **Phase 1.5**
- Add board context retrieval and summarization prompt templates.
- Add action proposal schema (no auto-apply).

3. **Phase 2**
- Introduce multi-agent templates (Sales/Support/Ops).
- Add per-agent tool allowlists and approval matrix.

4. **Phase 3**
- Add external agent adapters (n8n, managed-agent APIs).
- Keep Bords policy engine as mandatory mediation layer.

## 9) Immediate Engineering Tasks

1. Add AI gateway modules and OpenRouter provider adapter.
2. Add `/api/ai/chat` route with auth + rate limiting + Zod validation.
3. Add env vars:
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL` (optional)
- `OPENROUTER_MODEL` (optional)
- `AI_PROVIDER` (defaults to `openrouter`)
4. Add basic smoke tests (route + provider mock path).

## 10) Success Metrics (First 30 Days)

1. p95 latency under 3s for normal prompts.
2. 99% successful response rate (excluding provider outages).
3. No permission leakage incidents.
4. At least 40% weekly active usage among pilot users.
5. Acceptance rate of AI outputs greater than 60%.
