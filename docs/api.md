# Modulus Todo Backend API Reference

This document provides a comprehensive specification of the Modulus Todo REST API endpoints, request/response contracts, and architectural conventions.

---

## 1. Architectural Conventions & Standards

### 1.1 Facts Verification Matrix
- **Verified from Code**:
  - All endpoint routes, HTTP methods, and status codes.
  - Health endpoint mounted at `/api/health` returning `{ status: "ok", uptime, timestamp, database }` *(verified in code: `backend/src/app.ts`)*.
  - Request validation schemas (Zod strict schemas) and query parameter constraints *(verified in code: `backend/src/schemas/task.schema.ts`, `backend/src/controllers/auth.controller.ts`)*.
  - Registration payload strictly requires `{ email, password }` with no `name` field, returning user `{ id, email, createdAt, updatedAt }` *(verified in code: `backend/src/controllers/auth.controller.ts`, `backend/src/models/user.model.ts`)*.
  - Logout returns `204 No Content` with an empty response body *(verified in code: `backend/src/controllers/auth.controller.ts`)*.
  - Logout-all returns `{ status: "ok", message: "All sessions logged out successfully" }` *(verified in code: `backend/src/controllers/auth.controller.ts`)*.
  - Standard and validation error envelope shapes include `status: "error"` *(verified in code: `backend/src/app.ts`, `backend/src/middleware/validate.middleware.ts`)*.
  - Token lifetimes: `15m` access token, `7d` refresh token, `10s` refresh grace window *(verified in code: `backend/src/config/env.ts`, `backend/src/services/token.service.ts`)*.
  - Rate limiting parameters: `10` req/15m for register/login, `30` req/15m for refresh, `200` req/15m global *(verified in code: `backend/src/app.ts`, `backend/src/routes/auth.routes.ts`)*.
  - Tie-stable pagination sort contracts (`createdAt desc, _id desc` and `deadline asc/desc, _id asc/desc`) *(verified in code: `backend/src/services/task.service.ts`)*.
  - Date format: ISO 8601 UTC strings validated via `z.string().datetime()` *(verified in code: `backend/src/schemas/task.schema.ts`)*.
  - Strict mass assignment protection (`userId` and `completedAt` forbidden from request payloads) *(verified in code: `backend/src/schemas/task.schema.ts`)*.
  - Cross-user authorization isolation (ownership filter by token `userId`; unauthorized access returns 404 rather than 403 to prevent ID probing) *(verified in code: `backend/src/services/task.service.ts`)*.
- **Operational Context**:
  - Reverse proxy: Render single proxy hop with `trust proxy 1` configured *(verified in code: `backend/src/app.ts`)*.
  - Client and server clocks are synchronized via NTP within normal clock-skew tolerances (< 5 seconds).

---

### 1.2 Authentication & Token Lifetimes
The API implements a dual-token authentication model using stateless JWT access tokens and stateful hashed refresh tokens with family-based rotation and reuse detection:

| Token Type | Storage Format | Validity / Lifetime | Scope / Purpose |
| :--- | :--- | :--- | :--- |
| **Access Token** | Signed JWT (HS256) with `userId` payload *(verified in code: `backend/src/utils/jwt.ts`)* | **15 minutes** (`JWT_EXPIRES_IN=15m`) | Included in the `Authorization` header as `Bearer <token>` for protected endpoints. |
| **Refresh Token** | Opaque random string (>= 32 bytes hex), stored as **SHA-256** hash in MongoDB *(verified in code: `backend/src/services/token.service.ts`)* | **7 days** (`REFRESH_TOKEN_EXPIRES_DAYS=7`) | Used at `POST /api/auth/refresh` to issue new access/refresh token pairs. Automatically indexed with MongoDB TTL. |
| **Grace Window** | DB timestamp check (`graceIssuedAt`) *(verified in code: `backend/src/services/token.service.ts`)* | **10 seconds** (`REFRESH_GRACE_SECONDS=10`) | Mitigates transient network concurrency races and lost responses by allowing a single grace-sibling token to be issued within 10s of initial token use. |

### 1.3 Rate Limits
Rate limits are applied per client IP using `express-rate-limit` with standard `RateLimit-*` headers *(verified in code: `backend/src/app.ts`, `backend/src/routes/auth.routes.ts`)*:

| Route Scope | Limit | Window | Verified In |
| :--- | :--- | :--- | :--- |
| **Global Limiter** | 200 requests | 15 minutes | `backend/src/app.ts` |
| **Auth Strict Limiter** (`/register`, `/login`) | 10 requests | 15 minutes | `backend/src/routes/auth.routes.ts`, `backend/src/app.ts` |
| **Refresh Limiter** (`/refresh`) | 30 requests | 15 minutes | `backend/src/routes/auth.routes.ts`, `backend/src/app.ts` |

### 1.4 Error Response Shape *(verified in code: `backend/src/app.ts`, `backend/src/middleware/validate.middleware.ts`)*
All error responses consistently return a JSON envelope containing a `status: "error"` key without exposing server stack traces or internal diagnostics:

- **Standard Operational Error** (`400`, `401`, `404`, `409`, `429`, `500`):
  ```json
  {
    "status": "error",
    "message": "Task not found"
  }
  ```

- **Validation Error** (`400 Bad Request` from Zod validation):
  ```json
  {
    "status": "error",
    "message": "Validation failed",
    "errors": [
      {
        "field": "deadline",
        "message": "deadline must be greater than or equal to scheduledAt"
      }
    ]
  }
  ```

### 1.5 Date & Time Format
- All timestamps in request payloads must be valid ISO 8601 strings (e.g. `2026-10-22T10:00:00.000Z`) *(verified in code: `backend/src/schemas/task.schema.ts`)*.
- All dates are stored as UTC in MongoDB and serialized as ISO 8601 strings in JSON response payloads.

### 1.6 Pagination Shape *(verified in code: `backend/src/services/task.service.ts`)*
Paginated collection endpoints return results wrapped in a standardized envelope:
```json
{
  "tasks": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```
- Query constraints: `page` (integer, min 1, max 1000, default 1), `limit` (integer, min 1, max 100, default 20).
- Tie-stable pagination is guaranteed across pages by appending the unique `_id` field to MongoDB sort criteria.

---

## 2. API Endpoints Reference Table

| Method | Endpoint Path | Auth Required | Request Body / Query Params | Success Status & Body | Error Statuses |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` *(verified in code: `backend/src/app.ts`)* | No | None | **200 OK**<br>`{ status: "ok", uptime: number, timestamp: string, database: { code: number, status: string } }` | None |
| `POST` | `/api/auth/register` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | No (Strict Rate Limit: 10/15m) | **JSON Body**:<br>`{ email: string (max 254), password: string (8-128) }` | **201 Created**<br>`{ user: { id, email, createdAt, updatedAt }, accessToken, refreshToken }`<br>Header: `Cache-Control: no-store` | **400** (Validation)<br>**409** (Email taken)<br>**429** (Rate limit) |
| `POST` | `/api/auth/login` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | No (Strict Rate Limit: 10/15m) | **JSON Body**:<br>`{ email: string, password: string }` | **200 OK**<br>`{ user: { id, email, createdAt, updatedAt }, accessToken, refreshToken }`<br>Header: `Cache-Control: no-store` | **400** (Validation)<br>**401** (Invalid credentials)<br>**429** (Rate limit) |
| `POST` | `/api/auth/refresh` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | No (Rate Limit: 30/15m) | **JSON Body**:<br>`{ refreshToken: string (64-hex) }` | **200 OK**<br>`{ accessToken: string, refreshToken: string }`<br>Header: `Cache-Control: no-store` | **400** (Validation)<br>**401** (Expired/revoked/invalid token)<br>**429** (Rate limit) |
| `POST` | `/api/auth/logout` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | No | **JSON Body**:<br>`{ refreshToken?: string }` | **204 No Content**<br>(Empty response body, idempotent) | None |
| `POST` | `/api/auth/logout-all` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | **Yes** (Bearer JWT) | None | **200 OK**<br>`{ status: "ok", message: "All sessions logged out successfully" }` | **401** (Unauthorized) |
| `GET` | `/api/auth/me` *(verified in code: `backend/src/controllers/auth.controller.ts`)* | **Yes** (Bearer JWT) | None | **200 OK**<br>`{ user: { id, email, createdAt, updatedAt } }` | **401** (Unauthorized) |
| `POST` | `/api/tasks` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **JSON Body**:<br>`{ title: string (1-120), description?: string (<=2000), scheduledAt: ISO8601, deadline: ISO8601 (>= scheduledAt), priority?: "low"|"medium"|"high", tags?: string[] (<=10 items, <=30 chars) }` | **201 Created**<br>`{ task: TaskObject }` | **400** (Validation / deadline < scheduledAt)<br>**401** (Unauthorized) |
| `GET` | `/api/tasks` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **Query Parameters**:<br>- `status`: `"pending" | "completed" | "all"` (default `"all"`)<br>- `priority`: `"low" | "medium" | "high"`<br>- `tag`: string (case-insensitive)<br>- `deadlineFrom`: ISO8601<br>- `deadlineTo`: ISO8601 (must be >= deadlineFrom)<br>- `search`: string (<=100 chars, regex escaped)<br>- `sortBy`: `"createdAt" | "deadline" | "priority" | "urgency"` (default `"createdAt"`)<br>- `sortOrder`: `"asc" | "desc"` (default `"desc"`)<br>- `page`: int 1-1000 (default `1`)<br>- `limit`: int 1-100 (default `20`) | **200 OK**<br>`{ tasks: TaskObject[], pagination: { page, limit, total, totalPages } }` | **400** (Validation)<br>**401** (Unauthorized) |
| `GET` | `/api/tasks/:id` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **Path Parameter**:<br>`id`: 24-hex ObjectId string | **200 OK**<br>`{ task: TaskObject }` | **400** (Invalid ObjectId)<br>**401** (Unauthorized)<br>**404** (Not found or other user's task) |
| `PATCH` | `/api/tasks/:id` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **Path Parameter**:<br>`id`: 24-hex ObjectId string<br>**JSON Body** (Non-empty, at least 1 field):<br>`{ title?: string, description?: string|null, scheduledAt?: ISO8601, deadline?: ISO8601, priority?: "low"|"medium"|"high", tags?: string[] }` | **200 OK**<br>`{ task: TaskObject }` | **400** (Empty body, invalid date constraint)<br>**401** (Unauthorized)<br>**404** (Not found or other user's task) |
| `PUT` | `/api/tasks/:id/completion` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **Path Parameter**:<br>`id`: 24-hex ObjectId string<br>**JSON Body**:<br>`{ completed: boolean }` | **200 OK**<br>`{ task: TaskObject }`<br>*(Idempotent: preserves existing `completedAt` on re-completion)* | **400** (Validation)<br>**401** (Unauthorized)<br>**404** (Not found or other user's task) |
| `DELETE` | `/api/tasks/:id` *(verified in code: `backend/src/controllers/task.controller.ts`)* | **Yes** (Bearer JWT) | **Path Parameter**:<br>`id`: 24-hex ObjectId string | **204 No Content**<br>(Empty response body) | **400** (Invalid ObjectId)<br>**401** (Unauthorized)<br>**404** (Not found or other user's task) |

---

## 3. Data Schema Details

### 3.1 Task Schema (`TaskObject`) *(verified in code: `backend/src/models/task.model.ts`)*
```typescript
interface TaskObject {
  _id: string; // 24-character hexadecimal ObjectId
  userId: string; // Owner user ID
  title: string; // 1 to 120 characters, trimmed
  description?: string; // Optional, up to 2000 characters
  scheduledAt: string; // ISO 8601 UTC date string
  deadline: string; // ISO 8601 UTC date string (>= scheduledAt)
  priority: 'low' | 'medium' | 'high'; // Default 'medium'
  completed: boolean; // Default false
  completedAt: string | null; // ISO 8601 UTC date string or null
  tags: string[]; // Up to 10 unique strings, <= 30 chars each, lowercase
  createdAt: string; // ISO 8601 UTC timestamp (auto-managed)
  updatedAt: string; // ISO 8601 UTC timestamp (auto-managed)
}
```

### 3.2 User Schema (`UserObject`) *(verified in code: `backend/src/models/user.model.ts`)*
```typescript
interface UserObject {
  id: string; // 24-character hexadecimal ObjectId
  email: string; // Lowercased, valid email (max 254)
  createdAt: string; // ISO 8601 UTC timestamp
  updatedAt: string; // ISO 8601 UTC timestamp
}
```

---

## 4. Urgency Scoring Formula Specification *(verified in code: `backend/src/utils/urgency.ts`, `backend/src/services/task.service.ts`)*
When `sortBy=urgency` is requested on `GET /api/tasks`, the task service calculates dynamic urgency scores using a MongoDB aggregation pipeline matching the verified pure TypeScript algorithm:

1. **Overdue Status (`now > deadline`)**:
   ```
   score = 10000 * priorityWeight + min(overdueHours, 336) * 10
   ```
   - Priority weights: `high: 3`, `medium: 2`, `low: 1`.
   - Priority dominates overdue ranking.
   - Overdue penalty increases by 10 points per hour up to 336 hours (14 days cap).

2. **Upcoming Status (`now <= deadline`)**:
   ```
   timeToDeadlineHours = max(0, (deadline - now) / 3600000)
   rawScore = 1000 / (timeToDeadlineHours + 1) * priorityWeight
   score = (now < scheduledAt) ? rawScore * 0.5 : rawScore
   ```
   - Tasks not yet started (`now < scheduledAt`) receive a 0.5 damping factor.
   - `urgencyScore` is a transient computed sorting field and is stripped from the returned JSON response.
