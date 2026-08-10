# API Design

Version: 1.0 — condensed. Sections 1–7 keep their original numbering
because `backend/README.md` cross-references them (§5, §7) directly.

---

# 1. Purpose

This document defines the API design standards for Relay. All backend
endpoints should follow these conventions unless explicitly approved
otherwise.

---

# 2. Design Principles

The API should be simple, consistent, predictable, RESTful, and easy to
document and extend.

---

# 3. Base URL

Development: `http://localhost:8000`. From another device on the local
network: `http://<desktop-ip>:8000`.

---

# 4. API Versioning

All endpoints begin with `/api/v1` (e.g. `/api/v1/files`).

---

# 5. Content Type

Requests and responses use `application/json`. File transfers use
streaming responses instead (`GET /transfers/{id}/download` returns the
raw byte stream, not the JSON envelope below — see
`backend/README.md`'s "Transfer API").

---

# 6. Response Format

Every successful response uses the shared `ApiResponse` envelope
(`app/schemas/common.py`):

```json
{ "success": true, "message": "Operation completed successfully.", "data": {} }
```

Errors follow the same shape, with `data` set to `null`:

```json
{ "success": false, "message": "Device not found.", "data": null }
```

---

# 7. HTTP Status Codes

Standard codes are used throughout: `200` Success, `201` Created, `204` No
Content, `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not
Found, `409` Conflict, `422` Validation Error, `500` Internal Server
Error. `DELETE` endpoints return `204 No Content` with an empty body,
per HTTP semantics.

---

# 8. Endpoint Naming

Use nouns, not verbs: `/devices`, `/files`, `/transfers`, `/settings` —
never `/getFiles`, `/uploadFile`, `/downloadNow`.

---

# 9. Authentication

Version 1 uses trusted device pairing. Protected endpoints verify that the
requesting device has been paired and authorized via a `DeviceSession`
bearer token; no online user accounts exist. See `docs/10_Security.md`
and `backend/README.md`'s authentication sections for the concrete rules
per resource (which routes are loopback-only vs. session-token-gated).

---

# 10. File Transfers & Real-Time Updates

Large files are streamed; the backend never loads an entire file into
memory. **Version 1 has no WebSocket layer** — an earlier design
considered WebSockets for transfer progress and other real-time events,
but the actual implementation covers this need by having clients poll
`GET /transfers/{id}` instead (`docs/11_File_Transfer.md` §9, §16). A
WebSocket layer remains a possible future addition if a real-time need
that polling can't satisfy ever arises, but nothing in Version 1 requires
one — do not add one speculatively.

---

# 11. Validation & Error Handling

All request data is validated using Pydantic models; invalid requests
return clear validation errors. Error messages explain the problem,
avoid exposing internal implementation details, and stay consistent
across endpoints. Unexpected exceptions are logged. The backend
centralizes this in one exception-to-HTTP mapping layer
(`app/api/exception_handlers.py`) rather than per-route try/except — see
`docs/02_Architecture.md` §9.

---

# 12. Logging & Documentation

Every API request is logged during development (timestamp, endpoint,
method, response status, processing time — never sensitive information).
FastAPI's automatic OpenAPI documentation (Swagger UI, ReDoc) stays
enabled during development and may be restricted in production.

---

# 13. Future Expansion

The API should be extensible without breaking existing clients. Potential
future additions: folder synchronization, clipboard sharing, multiple
desktop devices, remote relay support, end-to-end encryption.

---

# 14. API Rules

Claude Code should: keep endpoint names consistent, reuse existing schemas
where possible, avoid duplicate endpoints, keep controllers thin, place
business logic in services, validate all inputs, return consistent
responses, and document new endpoints when they are added.
