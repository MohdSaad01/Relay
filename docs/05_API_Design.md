# API Design

Version: 1.0

---

# 1. Purpose

This document defines the API design standards for Relay.

All backend endpoints should follow these conventions unless explicitly approved otherwise.

---

# 2. Design Principles

The API should be:

* Simple
* Consistent
* Predictable
* RESTful
* Easy to document
* Easy to extend

---

# 3. Base URL

During development:

```
http://localhost:8000
```

When accessed by another device on the local network:

```
http://<desktop-ip>:8000
```

---

# 4. API Versioning

All endpoints should begin with:

```
/api/v1
```

Example:

```
/api/v1/files
```

---

# 5. Content Type

Requests and responses should use:

```
application/json
```

File transfers should use appropriate streaming responses.

---

# 6. Response Format

Successful responses should follow a consistent structure.

Example:

```json
{
    "success": true,
    "message": "Operation completed successfully.",
    "data": {}
}
```

---

Errors should follow the same format.

Example:

```json
{
    "success": false,
    "message": "Device not found.",
    "errors": []
}
```

---

# 7. HTTP Status Codes

Use standard HTTP status codes.

Examples:

| Code | Meaning               |
| ---- | --------------------- |
| 200  | Success               |
| 201  | Created               |
| 204  | No Content            |
| 400  | Bad Request           |
| 401  | Unauthorized          |
| 403  | Forbidden             |
| 404  | Not Found             |
| 409  | Conflict              |
| 422  | Validation Error      |
| 500  | Internal Server Error |

---

# 8. Endpoint Naming

Use nouns instead of verbs.

Good:

```
/devices
/files
/transfers
/settings
```

Avoid:

```
/getFiles
/uploadFile
/downloadNow
```

---

# 9. Authentication

Version 1 uses trusted device pairing.

Protected endpoints should verify that the requesting device has been paired and authorized.

No online user accounts are required.

---

# 10. File Transfers

Large files should be streamed.

The backend should avoid loading entire files into memory.

Transfer progress should be available to connected clients.

---

# 11. WebSocket Usage

WebSockets should be used only for real-time communication.

Examples:

* Transfer progress
* Connection status
* Device events
* Live notifications

Normal CRUD operations should remain REST endpoints.

---

# 12. Validation

All request data must be validated using Pydantic models.

Invalid requests should return clear validation errors.

---

# 13. Error Handling

Error messages should:

* Explain the problem
* Avoid exposing internal implementation details
* Remain consistent across endpoints

Unexpected exceptions should be logged.

---

# 14. Logging

Every API request should be logged during development.

Logs should include:

* Timestamp
* Endpoint
* Method
* Response status
* Processing time

Sensitive information should never be logged.

---

# 15. API Documentation

FastAPI's automatic OpenAPI documentation should remain enabled during development.

The project should expose:

* Swagger UI
* ReDoc

These may be disabled or restricted in production if needed.

---

# 16. Future Expansion

The API should be designed so future features can be added without breaking existing clients.

Potential future additions include:

* Folder synchronization
* Clipboard sharing
* Multiple desktop devices
* Remote relay support
* End-to-end encryption

---

# 17. API Rules

Claude Code should:

* Keep endpoint names consistent.
* Reuse existing schemas where possible.
* Avoid duplicate endpoints.
* Keep controllers thin.
* Place business logic in services.
* Validate all inputs.
* Return consistent responses.
* Document new endpoints when they are added.
