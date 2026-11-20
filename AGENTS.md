# Project Agent Guidelines

## Model Selection & Reasoning Effort

Before starting substantial work, check whether the active model and reasoning effort fit the task's complexity and expected execution, using only configuration explicitly exposed by the runtime. Never guess unknown settings, never run extra tool calls solely to inspect the model, and never imply you can switch models or effort levels unless the runtime supports it.

### Task Complexity

Classify by reasoning difficulty, uncertainty, and risk, not file count alone:

- **Trivial:** Simple Q&A, lookups, formatting, boilerplate, and mechanical edits regardless of file count. Prefer **Lightweight** tiers.
- **Moderate:** Routine features, isolated bug fixes, and straightforward refactoring. Prefer **Balanced** tiers.
- **Complex:** Architectural changes, difficult debugging, concurrency issues, security-sensitive modifications, cross-system refactoring, or ambiguous multi-step work. Prefer **Advanced** tiers or capable orchestration.

### Tier Reference

Model capability and reasoning effort are separate dimensions. Examples below are illustrative, not fixed rankings; prefer current runtime capabilities when available:

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
- Keep planning, verbosity, and tool calls proportional to task complexity; avoid unnecessary reads or over-planning on straightforward work.
- Do not assume multi-model orchestration or model switching is available unless explicitly exposed by the runtime.

## Coding Standards

- Keep imports organized per project lint rules and prefer configured path aliases or absolute imports (e.g., `@/...`) over relative paths when available; reserve `./` for colocated assets (e.g., CSS modules).
- Do not stage any changes you make (`git add`), and do not touch or unstage anything already staged (`git reset` / `git restore --staged`). Leave the existing staging area completely untouched unless explicitly asked.
- Treat questions and opinion requests as read-only unless changes are explicitly requested.
- Reuse existing patterns, components, endpoints, helpers, and UI conventions for consistency, while favoring supported modern TS/JS syntax. Before adding code to an existing module, inspect neighboring implementations and match their naming, formatting, and routing structure. Route index files should mount dedicated routers; keep endpoint handlers in those routers. Prefer DRY solutions when logic or behavior is meaningfully repeated, but avoid abstractions that add complexity for incidental duplication.
- Keep changes minimal and scoped. After debugging or exploratory work, remove logs, scaffolding, commented-out code, unused variables/imports, and unrelated edits.
- Independently verify feedback against requirements, code, and history. Push back on incorrect or regression-prone suggestions, and prefer simpler solutions over unnecessary complexity.

## Validation Guidelines

- Validate code changes when appropriate. Prefer targeted lint, type checks, and tests relevant to the files or behavior changed. Fix issues introduced by the changes and rerun affected checks before reporting completion.
- Avoid full-repository lint, test, or build commands unless explicitly requested or necessary to validate broader changes. Skip checks that provide little value for the task. Summarize validation performed and disclose relevant checks that were skipped or could not be completed.
