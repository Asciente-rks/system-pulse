# System Pulse

> A self-hosted uptime and health-check platform — register URLs, dispatch probes on demand or via background workers, and track status with a 30-day rolling history of every probe result.

System Pulse is a serverless health-monitoring SaaS designed for teams that want UptimeRobot-style monitoring on their own AWS account. Invite-based onboarding, per-user system access lists, three-tier role model, and a built-in Render wake-up mode for monitoring sleeping free-tier services. Frontend is a Vite SPA on Vercel; backend is two Lambdas + DynamoDB + SQS + SNS, all provisioned idempotently from a single GitHub Actions workflow.

---

## Live Demo

- **🌐 Live app:** [system-pulse-brown.vercel.app](https://system-pulse-brown.vercel.app)
- **🔧 Backend:** AWS Lambda Function URL (`ap-southeast-1`)

> Cold start may take 1-2 seconds on the first request; subsequent requests are warm.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Database Design](#database-design)
5. [Repository Layout](#repository-layout)
6. [API Reference](#api-reference)
7. [Authentication & Credentials](#authentication--credentials)
8. [Deployment](#deployment)
9. [Cost Breakdown](#cost-breakdown)
10. [Local Development](#local-development)
11. [Author](#author)

---

## What It Does

- **Register systems** by URL, choose a deployment mode (`render` or `standard`), and Pulse runs an immediate probe on creation.
- **Probe on demand** from the dashboard, or fan out probes through SQS for batched, resilient checking.
- **Persist every probe** as a `HEALTH_LOG` row with response code, latency, attempt number, and trigger source — auto-expired after 30 days via DynamoDB TTL.
- **Email-based onboarding** — superadmins invite teammates by email; recipient activates via a tokenized link.
- **Per-user access scoping** — assign each tester the specific systems they're allowed to see (`allowedSystemIds`).
- **Forgot-password flow** with a separate token store (`ResetTokenIndex` GSI).
- **Render wake-up mode** — built-in delay logic so monitoring a Render free-tier service doesn't always show "DOWN" because of cold-start sleep.

---

## Architecture

```
┌─────────────────────────────┐
│ Browser (React + Vite SPA)  │
│  • Vercel-hosted            │
│  • react-router 6           │
│  • Tailwind 4               │
└───────────┬─────────────────┘
            │ HTTPS / REST + JWT
            │
            ▼
┌─────────────────────────────┐
│ AWS Lambda Function URL      │
│ system-pulse-{stage}-api     │  ← single-Lambda router
│ (custom router-handler.ts)   │
└──┬──────────┬──────────┬─────┘
   │          │          │
   │          │          └────► SMTP / nodemailer
   │          │                  (invites + password reset)
   │          │
   │          └────► DynamoDB single table
   │                  • USER, SYSTEM, HEALTH_LOG
   │                  • +3 GSIs (EntityType / InviteToken /
   │                    ResetToken)
   │                  • TTL on expiresAt (30-day log retention)
   │
   ▼
SQS queue ─────► AWS Lambda
(or direct        system-pulse-{stage}-health-worker
 invoke)          • probes monitored URLs
                  • persists status + log
                  • optional SNS publish
                  ↓
              ┌───────────────┐
              │ Monitored URL │  GET /health → fallback GET /
              │ (any service) │  → UP / DOWN / UNKNOWN
              └───────────────┘
                  ↓
                  │ (3 retries on failure)
                  ▼
              SQS Dead-Letter Queue
```

**Notable architectural choices:**

- **Two Lambdas, one shared codebase.** The `api` Lambda handles all incoming HTTP, the `health-worker` Lambda runs probes async — invoked either directly (`HEALTH_TRIGGER_TRANSPORT=lambda-direct`) or via SQS (`=sqs`). Toggling between transports is one env var; no code change.
- **Custom HTTP router** (`router-handler.ts`) — no Express, no `serverless-express`. ~150 lines map `{method, path}` to Lambda handlers with `:param` matching. Saves cold-start time and `node_modules` weight.
- **Probing strategy:** worker tries `GET <url>/health` first, falls back to `GET <url>` — if either returns 2xx, system is `UP`; otherwise `DOWN`. Status + response time recorded.
- **Single-table DynamoDB design** keeps reads cheap; entity discriminators on every row enable type-aware queries via `EntityTypeIndex`.
- **TTL auto-purges** old health logs after 30 days — no cron job needed.

---

## Tech Stack

### Backend

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 20 (ESM) + TypeScript 6 | Modern import syntax, latest Node LTS on Lambda |
| Framework | None — direct Lambda handlers | Saves cold-start ms; routing is ~150 LOC |
| Database | **DynamoDB single-table** | 25 GB free perpetually; single-digit ms latency |
| AWS SDK | `@aws-sdk/lib-dynamodb` v3 | Tree-shakable, modern ESM |
| Queue | **SQS** with DLQ + 3-retry redrive | 1M req/mo free, decouples slow probes |
| Pub/Sub | **SNS** topic (opt-in) | Notify on status change |
| Worker invoke | `@aws-sdk/client-lambda` direct invoke | Faster than SQS for low-volume manual triggers |
| Email | nodemailer + SMTP | Free with Gmail / any SMTP provider |
| Validation | Yup | Tiny, ergonomic |
| ID generation | `uuid` v4 | Standard |

### Frontend

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | React 18 + TypeScript 5 | Familiar, fast |
| Build | Vite 5 | Sub-second HMR, ~10x faster than CRA |
| Styling | Tailwind CSS 4 | Utility-first, latest engine |
| Routing | react-router-dom 6 | Nested layouts, route guards |
| HTTP | `fetch` (native) | No axios needed for this scope |
| Hosting | **Vercel** | Hobby tier free, global CDN, automatic deploys |

---

## Database Design

System Pulse uses a **DynamoDB single-table** design. One table holds users, systems, invites, password-reset tokens, and health logs, distinguished by an `entityType` attribute and PK/SK prefixes. Three GSIs cover the read patterns.

### Table: `system-pulse-{stage}-table`

The table is provisioned by the deployment workflow with `BillingMode: PAY_PER_REQUEST` (no fixed RCU/WCU costs).

| Item type | PK | SK | What it holds |
|-----------|----|----|---------------|
| **USER** | `USER` | `USER#<id>` | Account, role, status, allowedSystemIds |
| **SYSTEM** | `SYSTEM` | `SYS#<uuid>` | Monitored URL, current status, last probe |
| **HEALTH_LOG** | `SYSTEM#<id>` | `LOG#<iso-time>#<attempt>` | One row per probe attempt |
| **INVITE token** | `USER` | `USER#<id>` | indexed by `inviteToken` GSI |
| **RESET token** | `USER` | `USER#<id>` | indexed by `resetToken` GSI |

### Global Secondary Indexes

| Index | Hash key | Range key | Purpose |
|-------|----------|-----------|---------|
| `EntityTypeIndex` | `entityType` | `status_` | Type-aware queries (list all users, list active systems) |
| `InviteTokenIndex` | `inviteToken` | — | Look up invite by opaque token |
| `ResetTokenIndex` | `resetToken` | — | Look up password-reset by opaque token |

### USER record

| Attribute | Type | Notes |
|-----------|------|-------|
| `id` | String | UUID |
| `email` | String | unique-ish (enforced at app layer) |
| `full_name` | String | display name |
| `role` | String | `'superadmin' \| 'admin' \| 'tester'` |
| `status_` | String | `'Active' \| 'Pending' \| 'Suspended'` |
| `passwordHash` | String | scrypt: `<salt>:<derived>` |
| `createDate` | String | ISO datetime |
| `allowedSystemIds` | List<String> | per-user system access list |
| `inviteToken` | String | indexed, only set for pending invites |
| `resetToken` | String | indexed, only set for in-flight password resets |

### SYSTEM record

| Attribute | Type | Notes |
|-----------|------|-------|
| `id` | String | UUID |
| `name` | String | display name |
| `url` | String | monitored URL |
| `deploymentMode` | String | `'render' \| 'standard'` (Render mode adds wake-up grace period) |
| `status` | String | `'UP' \| 'DOWN' \| 'UNKNOWN'` |
| `createDate` | String | ISO |
| `lastChecked` | String | ISO of last probe |
| `lastResponseCode` | Number | HTTP status from last probe |
| `responseTimeMs` | Number | latency from last probe |

### HEALTH_LOG record

Sortable by attempt time within a system's partition.

| Attribute | Type | Notes |
|-----------|------|-------|
| `systemId` | String | parent system UUID |
| `status` | String | `'UP' \| 'DOWN' \| 'UNKNOWN'` |
| `checkedAt` | String | ISO |
| `responseCode` | Number | HTTP status |
| `responseTimeMs` | Number | latency |
| `checkedUrl` | String | which URL was hit (`/health` or `/`) |
| `attempt` | Number | retry attempt |
| `triggerSource` | String | `'manual' \| 'system-create' \| 'queue' \| ...` |
| `errorMessage` | String | on failure |
| `expiresAt` | Number | unix epoch — DynamoDB TTL prunes at 30 days |

**Notable design choices:**

- **Tracking number / system ID is the partition key** for related logs because every "show me probe history for system X" query is one `Query` against a single partition.
- **TTL on `expiresAt`** auto-purges health logs after 30 days — zero ops cost, no cron.
- **Invite and reset tokens** get their own GSIs because they're looked up by random opaque token, not by user.
- **`PAY_PER_REQUEST` billing** keeps cost proportional to traffic.

---

## Repository Layout

This is a **monorepo**: backend Lambdas and frontend SPA in one repository.

```
system-pulse/
├── .github/workflows/deployment.yml   # 600+ line idempotent infra+code deploy
├── backend/
│   ├── package.json                   # Node 20, ESM, AWS SDK v3
│   ├── tsconfig.json
│   └── src/
│       ├── handler.ts                 # Re-exports every Lambda function
│       ├── router-handler.ts          # Single-Lambda router
│       ├── config/                    # config.ts, db.ts (DDB doc client)
│       ├── functions/
│       │   ├── auth/                  # login, forgot-password, reset-password
│       │   ├── user/                  # invite, accept, list, get, delete,
│       │   │                          # assign-system-access
│       │   └── health/                # check-health, list-systems,
│       │                              # delete-system, trigger-health,
│       │                              # process-health-queue, get-system-logs
│       ├── services/
│       │   ├── health-service.ts      # Persist + probe + log
│       │   ├── user-service.ts
│       │   ├── email-service.ts       # SMTP via nodemailer
│       │   ├── notification-service.ts # SNS publish (opt-in)
│       │   ├── queue-service.ts       # SQS send/receive
│       │   └── worker-invoke-service.ts # Direct Lambda invoke
│       ├── types/                     # health, health-events, user
│       ├── utils/
│       │   ├── actor-auth.ts          # Token verification
│       │   ├── error-handler.ts       # Shared CORS + error helpers
│       │   ├── frontend-url.ts        # Render wake-up URL resolution
│       │   ├── health-workflow.ts     # resolveDeploymentMode()
│       │   ├── rate-limit.ts
│       │   ├── rbac.ts                # Role-based access checks
│       │   └── parse.ts, password.ts
│       ├── validation/                # yup schemas
│       └── scripts/seed-users.ts      # Bootstrap superadmin/admin/tester
└── frontend/
    ├── package.json                   # React 18, Vite 5, Tailwind 4
    ├── vite.config.ts
    ├── vercel.json
    ├── public/favicon.svg
    ├── assets/                        # Logo variants
    └── src/
        ├── App.tsx                    # Routes + role guards
        ├── main.tsx
        ├── components/                # Nav, AestheticSelect
        ├── hooks/                     # useAuth, useTheme
        ├── pages/                     # Login, AcceptInvite, AdminDashboard,
        │                              # TesterDashboard, Systems, Invite,
        │                              # AssignAccess, ForgotPassword, ResetPassword
        ├── services/api.ts            # Single typed API client
        ├── styles/index.css           # Tailwind + custom theme
        └── utils/health-status.ts
```

---

## API Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | none | Email + password → access token |
| `POST` | `/auth/forgot-password` | none | Email a password-reset link |
| `POST` | `/auth/reset-password` | reset token | Consume token + set new password |
| `POST` | `/users/invite` | superadmin | Email an invite link to a new teammate |
| `POST` | `/users/invite/accept` | invite token | Set password + activate account |
| `POST` | `/users/:id/systems` | admin+ | Replace a user's `allowedSystemIds` |
| `GET` | `/users` | admin+ | List users |
| `GET` | `/users/:id` | admin+ or self | Fetch a user |
| `DELETE` | `/users/:id` | superadmin | Remove a user |
| `GET` | `/systems` | any auth | List systems (filtered by `allowedSystemIds` for testers) |
| `POST` | `/systems` | admin+ | Register a new system + run initial probe |
| `DELETE` | `/systems/:id` | admin+ | Delete a system + its logs |
| `POST` | `/systems/:id/trigger` | any auth | Fire an on-demand probe |
| `GET` | `/systems/:id/logs` | any auth | Recent probe history (default 20, max 100) |

`OPTIONS` preflights short-circuit at the router with status 204; CORS headers are force-injected on every response.

---

## Authentication & Credentials

System Pulse is **invite-only** — no public signup. The first user is created by running the seed script after deploying.

### Seeded accounts

`npm run seed:dev` creates these three accounts. All share the password `Password123!` (note the trailing `!`).

| Email | Role | Password |
|---|---|---|
| `superadmin@example.local` | superadmin | `Password123!` |
| `admin@example.local` | admin | `Password123!` |
| `tester@example.local` | tester | `Password123!` |

### Inviting more users

1. Sign in as superadmin (or admin).
2. **Users → Invite** → enter email, role, and (for testers) `allowedSystemIds`.
3. Recipient receives an email with a tokenized invite link (`/accept-invite?token=...`).
4. They set their password — account becomes `Active`.

### Forgot password

1. From the login page → **Forgot password** → enter email.
2. Receive a reset link with `?token=...`.
3. Set new password (token expires in `PASSWORD_RESET_ELIGIBILITY_MINUTES`, default 30).

### Dev Tools quick-login

The login page ships with a floating **⚙ Dev Tools** button in the bottom-right corner. Click it to one-shot sign in as Super Admin / Admin / Tester using the seeded credentials — handy for portfolio reviewers who don't want to type anything. The button still goes through the rate-limited `/auth/login` endpoint; it just skips the typing.

---

## Hardening

Because the live demo is reachable by anyone on the public internet, the API and frontend ship a few defenses:

- **Per-IP login rate limiting** — `backend/src/utils/rate-limit.ts` keeps a DynamoDB-backed bucket per `(IP, actor, time-window)` tuple. `/auth/login` is capped at 10 attempts per 60-second window. Hitting the limit returns `429` with a generic "Too many requests" message. State is persistent across Lambda containers because it lives in DynamoDB (with a TTL that auto-evicts old buckets).
- **Hardened security headers on every response** (set in `backend/src/utils/error-handler.ts`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: cross-origin`, plus a generic `Server: SystemPulse` header to mask the runtime fingerprint.
- **Generic 500s** — the global error handler no longer leaks `error.message` or stack traces; clients always see `{ status: 500, message: "Internal server error" }`.
- **Frontend bundle hardening** — `frontend/src/utils/security.ts` runs at boot in production builds:
  - Replaces every `console.*` method with a no-op and clears the console every 1.5s, so opening DevTools shows nothing useful.
  - Disables the React DevTools global hook so the React component tree isn't browsable.
  - **Does NOT block F12, right-click, or `Ctrl+Shift+I`** — the dev tools panel itself stays open-able. The defenses are about making what's inside opaque, not about pretending the user can't open it.
- **Vite production build** — `vite.config.ts` drops every `console.*` call and `debugger` statement from the bundle, disables source maps, and rewrites entry / chunk / asset filenames as content hashes. Combined with esbuild's name mangling, the deployed JS reads as a wall of single-letter identifiers in DevTools.

---

## Deployment

### Backend → AWS Lambda (single-command CI/CD)

`.github/workflows/deployment.yml` runs on every push to `main` that touches `backend/` or the workflow itself. It is **fully idempotent** — re-running on a fresh AWS account or an existing one converges to the same end state.

What it does, in order:

1. Authenticates to AWS via either access keys (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) or OIDC role assumption (`AWS_ROLE_TO_ASSUME`) — whichever is present.
2. Builds TypeScript backend, prunes dev dependencies, zips `dist + node_modules + package.json` into `backend.zip`.
3. **Provisions or reconciles AWS resources:**
   - DynamoDB table with three GSIs and TTL on `expiresAt`
   - SQS queue with redrive policy → DLQ (`maxReceiveCount: 3`)
   - SNS topic
   - IAM role with inline policy for DDB (incl. GSIs), SQS, SNS, and Lambda invoke
4. **Deploys two Lambda functions:**
   - `system-pulse-{stage}-api` — router-handler, called from a Function URL
   - `system-pulse-{stage}-health-worker` — async health probes
5. (Optional) Adds an SQS-to-Worker event source mapping when `ENABLE_QUEUE_WORKER_MAPPING=true`.
6. Exposes the API via Lambda Function URL with `AuthType: NONE` (CORS handled in app).
7. (Optional) Encrypts Lambda environment variables with KMS when `LAMBDA_KMS_KEY_ARN` is set.

Stage and region are configurable via `workflow_dispatch` inputs (default `dev` and `ap-southeast-1`).

### Frontend → Vercel

The frontend builds with `vite build` and is hosted on Vercel. Routing fallbacks come from `frontend/vercel.json`. Set `VITE_API_BASE_URL` to your Lambda Function URL.

---

## Cost Breakdown

> **Designed for $0/month forever.** Every layer of System Pulse runs on a free tier with no expiry.

| Service | Free tier | We use | Headroom |
|---------|-----------|--------|----------|
| **AWS Lambda** | 1M invocations/mo + 400K GB-s | ~3K invocations/mo | **99.7%** |
| **DynamoDB (PAY_PER_REQUEST)** | 25 GB storage + 25 R/W units (perpetual) | <50 MB | **99%+** |
| **SQS** | 1M requests/mo | <500 req/mo | **99.95%** |
| **SNS** | 1M publishes/mo | <100/mo | **99.99%** |
| **SQS DLQ** | counts toward SQS 1M | <10 messages/mo | within limits |
| **CloudWatch Logs** | 5 GB ingestion/mo | <50 MB | **99%** |
| **Vercel Hobby** | 100 GB bandwidth, unlimited deploys | <1 GB/mo | **99%** |
| **GitHub Actions** (public repo) | unlimited minutes | ~3 min/mo | unlimited |
| **SMTP (Gmail / Resend free)** | 500/day or 100/day | <10/day | **97%+** |

**Total: $0/month**, with massive headroom on every line.

**Why each free tier was chosen:**

- **DynamoDB over RDS** — RDS free tier expires after 12 months; DynamoDB's free tier is **perpetual** and scales to single-digit-ms latency.
- **SQS + DLQ over a self-hosted queue** — built-in retry/DLQ semantics mean a flaky monitored service can't crash the worker fleet.
- **Two Lambdas, no API Gateway** — Function URLs are free (API Gateway has its own per-million pricing). One less moving part.
- **Vercel over self-hosting** — global CDN, automatic deploys, free SSL, custom domains. Not worth running our own static host.
- **Idempotent CI/CD** — re-running the deploy workflow on a fresh AWS account stands up the entire system from scratch in ~3 minutes.

---

## Local Development

### Backend

```bash
git clone https://github.com/Asciente-rks/system-pulse.git
cd system-pulse/backend
npm install
npm run build               # tsc → dist/
npm run typecheck
npm run seed -- <table-name> # Bootstrap a superadmin in your DynamoDB table
```

There's no local HTTP server — everything runs in Lambda. To test locally, point a tool like `serverless-offline` or AWS SAM at `dist/handler.js`, or invoke the compiled handlers directly via `node` for unit tests.

### Frontend

```bash
cd ../frontend
npm install
npm run dev                 # Vite dev server with HMR
npm run build               # Production bundle in dist/
npm run preview             # Serve dist/ locally
```

### Environment Variables

**Backend** (set on Lambda via CI workflow + GitHub `vars`/`secrets`):

```env
TABLE_NAME=system-pulse-dev-table
SYSTEM_PULSE_TABLE=system-pulse-dev-table
USERS_TABLE=system-pulse-dev-table

HEALTH_CHECK_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/.../health-check-queue
HEALTH_STATUS_TOPIC_ARN=arn:aws:sns:ap-southeast-1:...:health-status
HEALTH_WORKER_FUNCTION_NAME=system-pulse-dev-health-worker
HEALTH_TRIGGER_TRANSPORT=lambda-direct          # or "sqs"
ENABLE_HEALTH_LOGS=true
ENABLE_SNS_NOTIFICATIONS=false

EMAIL_USER=...
EMAIL_PASS=...
FRONTEND_URL=https://system-pulse-brown.vercel.app

INVITE_ELIGIBILITY_HOURS=24
PASSWORD_RESET_ELIGIBILITY_MINUTES=30
SHOW_INVITE_LINK=false
RENDER_WAKEUP_DELAY_SECONDS=90
```

**Frontend** (`frontend/.env`):

```env
VITE_API_BASE_URL=https://<your-lambda-function-url>
```

---

## Author

Built by **Ralph Kenneth F. Sonio** ([@Asciente-rks](https://github.com/Asciente-rks)). Live at **[system-pulse-brown.vercel.app](https://system-pulse-brown.vercel.app)**.
