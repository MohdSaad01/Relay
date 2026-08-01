# Relay Architecture

Version: 1.0

---

# 1. Architecture Philosophy

Relay follows a modular, local-first architecture.

Each major component has a single responsibility and communicates through clearly defined interfaces.

The architecture should prioritize:

* Simplicity
* Maintainability
* Testability
* Scalability
* Separation of concerns

---

# 2. High-Level Architecture

Relay consists of four primary components:

1. Windows Desktop Application
2. Android Application
3. Local Backend API
4. Local Database

```
+-----------------------+
|   Windows Desktop     |
|        UI             |
+-----------+-----------+
            |
            | HTTP/WebSocket
            |
+-----------v-----------+
|     FastAPI Backend   |
| Business Logic & API  |
+-----------+-----------+
            |
            |
     +------+------+
     |             |
     |             |
+----v----+   +----v----+
| SQLite  |   | File    |
|Database |   | Storage |
+---------+   +---------+

            ^
            |
            |
+-----------+-----------+
|   Android Application |
+-----------------------+
```

---

# 3. Desktop Application Responsibilities

The Windows application is responsible for:

* Displaying the desktop interface
* Managing shared files
* Displaying transfer progress
* Showing paired devices
* Starting and stopping the local backend
* Sending API requests
* Receiving transfer events

The desktop application should not contain business logic.

Business logic belongs inside the backend.

---

# 4. Backend Responsibilities

The backend acts as the central coordinator.

Responsibilities include:

* Device discovery
* Pairing validation
* Transfer management
* File streaming
* Authentication
* Authorization
* Database operations
* Logging
* Error handling
* Configuration management

All business rules should exist only in the backend.

---

# 5. Android Responsibilities

The Android application is responsible for:

* Discovering available Relay servers
* Displaying nearby devices
* Pairing with the desktop
* Browsing shared files
* Requesting downloads
* Uploading files
* Displaying transfer progress
* Managing paired devices

Like the desktop application, the Android client should remain thin.

Business logic belongs in the backend whenever practical.

---

# 6. Database Layer

Version 1 uses SQLite.

The database stores:

* Paired devices
* Application settings
* Shared file metadata
* Transfer history
* Security tokens
* User preferences

Large files are never stored inside the database.

Only metadata is stored.

---

# 7. File Storage

Actual files remain on disk.

The database references them through metadata.

Relay should never duplicate files unless required for a transfer.

---

# 8. API Layer

All communication occurs through the backend API.

Responsibilities include:

* Device registration
* Pairing
* File listing
* File uploads
* File downloads
* Transfer progress
* Device management

The API should remain RESTful where appropriate.

Real-time events should use WebSockets when necessary.

---

# 9. Layered Design

The backend should follow a layered architecture.

```
Presentation Layer
        │
Application Layer
        │
Domain Layer
        │
Infrastructure Layer
```

### Presentation Layer

Responsible for:

* API endpoints
* Request validation
* Response formatting

---

### Application Layer

Responsible for:

* Business workflows
* Use cases
* Coordination

---

### Domain Layer

Responsible for:

* Core business rules
* Models
* Domain logic

The domain layer should not depend on FastAPI or SQLite.

---

### Infrastructure Layer

Responsible for:

* Database access
* File system operations
* Network communication
* Configuration
* Logging

---

# 10. Communication Flow

Typical transfer process:

1. Android discovers desktop.
2. User initiates pairing.
3. Desktop approves pairing.
4. Secure pairing information is stored.
5. Android requests available files.
6. Backend validates request.
7. Backend streams file.
8. Desktop reports progress.
9. Android receives file.
10. Transfer completes.

---

# 11. Design Principles

Relay should follow:

* Single Responsibility Principle
* Dependency Inversion
* Separation of Concerns
* Explicit dependencies
* Loose coupling
* High cohesion

Avoid unnecessary abstractions until there is a clear need.

---

# 12. Error Handling

Errors should:

* Be logged
* Return meaningful messages
* Never expose internal implementation details
* Never fail silently

Unexpected failures should be recoverable whenever possible.

---

# 13. Future Scalability

The architecture should allow future migration to:

* PostgreSQL
* Multiple desktop clients
* Internet relay servers
* End-to-end encryption
* Cross-platform desktop support
* Plugin system

These enhancements should require minimal changes to the core architecture.

---

# 14. Architecture Rules

The following rules must always be respected:

* UI does not contain business logic.
* Business logic does not access UI directly.
* Database access occurs through dedicated data layers.
* Large files remain outside the database.
* Components communicate through well-defined interfaces.
* Every layer has a single responsibility.
* New features should integrate with the existing architecture rather than bypass it.
