# Development Workflow

Version: 1.0

---

# 1. Purpose

This document defines the development workflow for the Relay project.

The objective is to ensure consistent progress, maintain code quality, and prevent large, unreviewed AI-generated changes.

---

# 2. Development Philosophy

Relay will be developed incrementally.

Every milestone should:

* Solve one problem.
* Be independently testable.
* Be reviewed before continuing.
* End in a stable state.

Never attempt to build multiple major features in a single iteration.

---

# 3. AI Development Rules

Claude Code acts as a software engineering assistant.

Claude Code should:

* Read the project documentation before writing code.
* Respect the existing architecture.
* Explain important implementation decisions.
* Avoid introducing unnecessary complexity.
* Never redesign completed components without approval.

---

# 4. Milestone Workflow

Each milestone follows the same process.

Step 1

Understand the objective.

---

Step 2

Inspect the current project structure.

---

Step 3

Implement only the requested milestone.

---

Step 4

Explain every created or modified file.

---

Step 5

Provide instructions for running the project.

---

Step 6

Provide a testing checklist.

---

Step 7

Recommend a Git commit message.

---

Step 8

Stop.

Do not begin the next milestone automatically.

---

# 5. Review Process

After every milestone:

* Review the generated code.
* Verify that the project builds.
* Run available tests.
* Check that documentation is still accurate.
* Confirm that the milestone objectives were achieved.

Only then should development continue.

---

# 6. Git Workflow

Work in small commits.

Recommended commit sequence:

* Initial project setup
* Backend structure
* Database layer
* Device discovery
* Pairing system
* File transfer
* Desktop UI
* Android client
* Testing improvements
* Documentation updates

Each commit should represent one logical unit of work.

---

# 7. Documentation Workflow

Documentation is part of the project.

Whenever architecture, APIs, or major implementation details change:

* Update the relevant document.
* Avoid leaving outdated documentation.
* Keep examples synchronized with the code.

---

# 8. Introducing New Technologies

Before adding any new library, framework, or dependency, Claude Code should explain:

* Why it is needed.
* What alternatives exist.
* Why it is preferred.
* Any disadvantages.

No significant dependency should be introduced without justification.

---

# 9. Error Resolution

When errors occur:

1. Identify the root cause.
2. Explain the cause.
3. Propose the solution.
4. Apply the smallest reasonable fix.
5. Verify the fix.

Avoid rewriting large sections of working code to solve isolated issues.

---

# 10. Refactoring

Refactoring should occur only when it provides a clear benefit.

Examples:

* Improved readability
* Reduced duplication
* Better maintainability
* Performance improvements

Refactoring should not change observable behavior unless explicitly intended.

---

# 11. Code Reviews

Claude Code should perform a self-review before considering work complete.

Review for:

* Correctness
* Readability
* Duplication
* Error handling
* Consistency
* Performance
* Documentation

---

# 12. Testing

Every milestone should include:

* Manual testing instructions
* Expected results
* Edge cases
* Known limitations

If automated tests are added, they should pass before the milestone is considered complete.

---

# 13. Communication

Claude Code should:

* Clearly explain significant decisions.
* Warn about potential risks.
* State assumptions explicitly.
* Ask for clarification when requirements are ambiguous.

Avoid guessing.

---

# 14. Definition of Completion

A milestone is complete only when:

* The implementation is finished.
* The project builds successfully.
* Existing functionality remains intact.
* Documentation is updated.
* Testing instructions are provided.
* A Git commit is recommended.

---

# 15. Long-Term Goal

The objective is not only to produce a working application, but also to create a maintainable, well-documented, production-quality codebase that can continue to evolve without major architectural changes.
