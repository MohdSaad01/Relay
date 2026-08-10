# Coding Standards & Development Workflow

Version: 1.0 — consolidated from the former `06_Coding_Standards.md` and
`07_Development_Workflow.md`, which overlapped heavily (testing, Git
practice, review checklist, error handling).

---

# 1. Purpose

Defines coding standards and the development process for Relay, so all
generated code and workflow stay consistent, readable, maintainable, and
scalable long-term. The objective is also to prevent large, unreviewed
AI-generated changes.

---

# 2. General Principles

Code should be readable, simple, consistent, modular, testable, and easy
to debug. Prefer clarity over cleverness.

---

# 3. Naming Conventions

* **Variables:** descriptive `snake_case` (`device_name`,
  `transfer_progress`) — never `x`, `tmp`, `data1`.
* **Functions:** name describes exactly what it does (`discover_devices()`,
  `validate_pairing()`).
* **Classes:** `PascalCase` (`TransferService`, `DeviceRepository`).
* **Constants:** `UPPER_CASE` (`MAX_FILE_SIZE`, `DEFAULT_PORT`).

---

# 4. File & Function Design

Each file has a single responsibility; split a file that becomes hard to
navigate. Functions perform one task, are easy to understand, return
predictable results, and avoid hidden side effects — break large
functions into smaller ones.

---

# 5. Documentation

Public classes and functions include docstrings; complex logic is
explained when necessary. Avoid comments that merely repeat what the code
already says.

---

# 6. Error Handling

Never silently ignore exceptions (no bare `except: pass`). Catch specific
exceptions, log unexpected errors, and return meaningful messages that
never expose internal implementation details.

---

# 7. Type Hints & Formatting

All public functions use Python type hints
(`def get_device(device_id: str) -> Device:`). Python code follows PEP 8
and Ruff formatting, four-space indentation. Imports are grouped standard
library → third-party → local, no wildcard imports.

---

# 8. Logging

Use the Python `logging` module. Log startup/shutdown, pairing events,
transfer events, errors, and warnings. Never log passwords, security
tokens, or sensitive user information.

---

# 9. Duplication & Dependencies

Reuse or extend existing functionality instead of duplicating logic.
Before introducing a new dependency, explain why it's needed, what problem
it solves, alternatives considered, and the trade-offs — avoid unnecessary
packages.

---

# 10. Testing

New features include appropriate tests; bug fixes include tests when
practical. Do not merge untested features. If automated tests are added,
they must pass before a milestone is considered complete.

---

# 11. Development Philosophy & Milestone Workflow

Relay is developed incrementally. Every milestone solves one problem, is
independently testable, is reviewed before continuing, and ends in a
stable state — never build multiple major features in one iteration, and
never begin the next milestone automatically.

Each milestone follows the same process: understand the objective →
inspect the current project structure → implement only the requested
milestone → explain every created/modified file → provide run instructions
→ provide a testing checklist → recommend a Git commit message → stop.

---

# 12. Git Workflow

Work in small, focused commits — each representing one logical unit of
work, avoiding unrelated changes in the same commit. After every
milestone: review the generated code, verify the project builds, run
available tests, check documentation is still accurate, and confirm the
milestone's objectives were achieved before continuing.

---

# 13. Documentation Workflow

Documentation is part of the project. Whenever architecture, APIs, or
major implementation details change, update the relevant document, avoid
leaving it outdated, and keep examples synchronized with the code.

---

# 14. Introducing New Technologies & Refactoring

No significant dependency is introduced without explaining why it's
needed, what alternatives exist, and its disadvantages. Refactoring
happens only when it provides a clear benefit (readability, reduced
duplication, maintainability, performance) and should not change
observable behavior unless explicitly intended.

---

# 15. Error Resolution

When an error occurs: identify the root cause, explain it, propose a
solution, apply the smallest reasonable fix, and verify it. Avoid
rewriting large sections of working code to solve an isolated issue.

---

# 16. Communication

Claude Code should clearly explain significant decisions, warn about
potential risks, state assumptions explicitly, and ask for clarification
when requirements are ambiguous rather than guessing.

---

# 17. Review Checklist

Before considering work complete, verify: naming is consistent; code is
readable; no duplicate logic exists; errors are handled correctly; types
are defined; documentation is updated; tests pass; the project builds
successfully.

---

# 18. Rules for Claude Code

* Prefer modifying existing code over creating duplicate implementations.
* Explain significant architectural decisions and their trade-offs.
* Keep commits focused on a single milestone.
* Avoid introducing unnecessary abstractions.
* Preserve consistency with the existing project structure.
* Ask for clarification instead of making major assumptions when
  requirements are ambiguous.

---

# 19. Long-Term Goal

The objective is not only a working application, but a maintainable,
well-documented, production-quality codebase that can keep evolving
without major architectural changes.
