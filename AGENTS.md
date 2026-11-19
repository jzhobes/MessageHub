# Project Agent Guidelines

## Model Selection & Reasoning Effort

Before starting substantial work, check whether the active model and reasoning effort fit the task's complexity and expected execution—using only configuration explicitly exposed by the runtime. Never guess unknown settings, never run extra tool calls solely to inspect the model, and never imply you can switch models or effort levels unless the runtime supports it.

### Task Complexity

Classify by reasoning difficulty, uncertainty, and risk—not file count alone:

- **Trivial:** Simple Q&A, lookups, formatting, boilerplate, and mechanical edits regardless of file count. Prefer **Lightweight** tiers.
- **Moderate:** Routine features, isolated bug fixes, and straightforward refactoring. Prefer **Balanced** tiers.
- **Complex:** Architectural changes, difficult debugging, concurrency issues, security-sensitive modifications, cross-system refactoring, or ambiguous multi-step work. Prefer **Advanced** tiers or capable orchestration.

### Tier Reference

Model capability and reasoning effort are separate dimensions. Examples below are illustrative, not fixed rankings—prefer current runtime capabilities when available:

| Tier | Illustrative Models | Typical Effort |
| :--- | :--- | :--- |
| **Lightweight** | Gemini 4 Hydrogen, Gemini 3.8 Flash, Claude Haiku, OpenAI lightweight | `Low` / `Medium` |
| **Balanced** | Gemini 4 Neon, Orchestrator (Neon), Claude Sonnet, OpenAI general-purpose | `Medium` |
| **Advanced** | Gemini 4 Argon/Carbon, Orchestrator (Argon), Claude Opus, OpenAI frontier reasoning | `Medium` / `High` / `XHigh` |

### Resource & Reliability Guardrail

- **Over-provisioned:**
  - *Trivial (no-tool Q&A or quick single-step edit):* Proceed immediately; optionally add a 1-line note suggesting a lighter tier.
  - *Routine work involving multiple steps or substantial tool usage on an Advanced or `XHigh` configuration:* Pause before editing or starting substantial tool loops and suggest a lighter alternative when savings are meaningful.
- **Under-provisioned:**
  - *Active configuration is known to be Lightweight and the task is Complex:* Pause before substantial execution, explain the reliability/retry risk, and suggest a Balanced, Advanced, or Orchestrator option.
- **Complexity check:** Limited read-only investigation is permitted when needed to assess complexity; do not investigate when complexity is already apparent.
- **Unknown configuration:** Proceed without guessing.
- **User override:** If the user asks to proceed, execute immediately and do not raise the same mismatch again for that task.

### Execution Principles

- Prioritize correctness, verification, and task completion over marginal token savings.
- Keep planning, verbosity, and tool calls proportional to task complexity—avoid unnecessary reads or over-planning on straightforward work.
- Do not assume multi-model orchestration or model switching is available unless explicitly exposed by the runtime.
