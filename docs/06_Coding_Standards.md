# Coding Standards

Version: 1.0

---

# 1. Purpose

This document defines the coding standards for the Relay project.

All generated code should follow these guidelines to ensure consistency, readability, maintainability, and long-term scalability.

---

# 2. General Principles

Code should be:

* Readable
* Simple
* Consistent
* Modular
* Testable
* Easy to debug

Prefer clarity over cleverness.

---

# 3. Naming Conventions

## Variables

Use descriptive `snake_case` names.

Good examples:

```python
device_name
transfer_progress
shared_files
```

Avoid:

```python
x
tmp
data1
```

---

## Functions

Function names should describe exactly what they do.

Examples:

```python
discover_devices()
start_transfer()
validate_pairing()
```

---

## Classes

Use `PascalCase`.

Examples:

```python
TransferService
DeviceManager
FileRepository
```

---

## Constants

Use `UPPER_CASE`.

Examples:

```python
MAX_FILE_SIZE
DEFAULT_PORT
API_VERSION
```

---

# 4. File Organization

Each file should have a single responsibility.

Avoid large files with unrelated functionality.

If a file becomes difficult to navigate, consider splitting it into smaller modules.

---

# 5. Function Design

Functions should:

* Perform one task
* Be easy to understand
* Return predictable results
* Avoid hidden side effects

Large functions should be broken into smaller ones.

---

# 6. Documentation

Public classes and functions should include docstrings.

Complex logic should be explained when necessary.

Avoid comments that merely repeat what the code already says.

---

# 7. Error Handling

Never silently ignore exceptions.

Avoid:

```python
try:
    ...
except:
    pass
```

Instead:

* Catch specific exceptions
* Log unexpected errors
* Return meaningful messages

---

# 8. Type Hints

All public functions should use Python type hints.

Example:

```python
def get_device(device_id: str) -> Device:
```

---

# 9. Logging

Use the Python logging module.

Log:

* Startup
* Shutdown
* Pairing events
* Transfer events
* Errors
* Warnings

Do not log:

* Passwords
* Security tokens
* Sensitive user information

---

# 10. Code Duplication

Avoid duplicate logic.

If functionality already exists, reuse or extend it.

---

# 11. Imports

Group imports in this order:

1. Standard library
2. Third-party packages
3. Local project imports

Avoid wildcard imports.

---

# 12. Formatting

Python code should follow:

* PEP 8
* Ruff formatting
* Four-space indentation
* Maximum practical readability

---

# 13. Testing

New features should include appropriate tests.

Bug fixes should include tests when practical.

Do not merge untested features.

---

# 14. Dependencies

Before introducing a new dependency, Claude Code should explain:

* Why it is needed
* What problem it solves
* Possible alternatives
* Trade-offs

Avoid unnecessary packages.

---

# 15. Git Practices

Each milestone should result in:

* Clean code
* Passing tests
* Updated documentation
* A logical Git commit

Avoid unrelated changes in the same commit.

---

# 16. Review Checklist

Before considering work complete, verify:

* Naming is consistent.
* Code is readable.
* No duplicate logic exists.
* Errors are handled correctly.
* Types are defined.
* Documentation is updated.
* Tests pass.
* The project builds successfully.

---

# 17. Rules for Claude Code

Claude Code should:

* Prefer modifying existing code over creating duplicate implementations.
* Explain significant architectural decisions.
* Keep commits focused on a single milestone.
* Avoid introducing unnecessary abstractions.
* Preserve consistency with the existing project structure.
* Ask for clarification instead of making major assumptions when requirements are ambiguous.
