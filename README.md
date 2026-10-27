# Elimu (CampusConnect v2)

### A Distributed University Platform: Real-Time Chat, Classes, Coursework, Exams, Attendance and Administration

Elimu is a university platform built on a three-node distributed backend. It started as **CampusConnect**, a real-time chat application that demonstrates multi-node architecture, cross-node event broadcasting, shared persistent storage, fault tolerance, automatic reconnection, message recovery and distributed rate limiting. Version 2 builds a full academic system on top of that core: role-based portals for students, lecturers and administrators, unit registration, class pages, assignments and timed exams, marking with controlled release of results, attendance check-ins, confidential unit evaluations, direct messaging, study groups and an administrator console.

The system uses **NestJS, TypeScript, Socket.IO, PostgreSQL, Redis-compatible Memurai, React and Vite**.

Its primary reliability principle is:

> **Persist first, broadcast second.** A message is not acknowledged as saved until it has been committed to PostgreSQL.

Three backend nodes share one database and one Redis-compatible service. Clients connected to different nodes exchange messages through a shared event channel. If a node becomes unavailable, the frontend reconnects to a healthy node and retrieves the messages it missed.

> **Honest status.** The v1 chat core was run and tested on the developer's machine. Everything added in v2 (academics, coursework, attendance, evaluations, admin console, message actions, new interface) was written and syntax-checked, and the grading logic has automated tests (`yarn test:logic`), but v2 had **not been compiled or run end to end** in the environment where it was written, because that environment could not reach the package registry. Expect to fix a few type errors on the first `yarn typecheck` / `yarn build`. They are normally one-line fixes. Do not claim a v2 feature "passed testing" in your report until you have run it yourself.

---

## Table of Contents

1. Project Overview
2. Problem Statement
3. Objectives
4. What Is in Elimu (Feature Matrix)
5. System Architecture
6. Technologies Used
7. Project Structure
8. Prerequisites
9. Initial Setup
10. PostgreSQL Configuration
11. Memurai Configuration
12. Backend Configuration
13. Starting the Three Backend Nodes
14. Gateway Setup
15. Frontend Setup
16. Running the Complete Application
17. First Run as an Administrator
18. Using Elimu (by Role)
19. Messaging in Detail
20. Coursework, Exams and Results
21. Automated Distributed Testing
22. Demonstrating Node Failure and Recovery
23. Security Design
24. Fault Tolerance and Limitations
25. Design Notes
26. Troubleshooting
27. Configuration Reference
28. Testing Evidence for the Assignment
29. Future Improvements
30. Conclusion

---

## 1. Project Overview

Elimu is a distributed client-server application in which multiple backend nodes cooperate to provide one shared service.

Unlike an application that relies on a single backend server, Elimu runs three application nodes:

- **NODE_A:** port `3001`
- **NODE_B:** port `3002`
- **NODE_C:** port `3003`

All three nodes use a common PostgreSQL database for persistent data (accounts, classes, messages, coursework, results) and a shared Redis-compatible service for cross-node messaging and distributed rate limits.

The frontend is a React application served by Vite on port `5173`. An optional gateway on port `4000` monitors backend health and recommends an available node to the client.

### Main features

- Role-based accounts: student, lecturer, administrator, with lecturer approval.
- Courses (1 to 7 years, 1 to 3 semesters a year), units, semesters and scheduled classes.
- Unit registration for students, with capacity limits.
- Class pages with stream, materials, coursework, attendance, grades, roster and evaluation tabs.
- Assignments and timed exams with multiple choice (A to D) and written answers.
- Server-side auto-marking of multiple choice, manual marking of written answers, feedback.
- Results hidden until the lecturer releases them.
- Attendance check-in with a time-limited 6-digit code.
- Confidential unit evaluations with a minimum-response rule.
- Direct messages (after a connection request is accepted), class groups and study groups.
- Message actions: reply, copy, react with emoji and delete.
- Real-time messaging through Socket.IO, shared history, cross-node broadcasting, automatic reconnection and history recovery.
- Message deduplication using client-generated identifiers.
- Health monitoring for all three nodes and distributed rate limiting.
- Notifications, themes (six backgrounds, ten accents), text size and spacing.
- Administrator console: users, approvals, courses and units, semesters, classes, reports, audit log, system status.
- Automated integration tests and performance measurements for the chat cluster.

## 2. Problem Statement

University communities need reliable channels for announcements, coursework, assessment and collaboration across classes, and they need those channels to keep working when part of the infrastructure fails.

A platform hosted on a single server is a single point of application failure. If that server becomes unavailable, students lose access to chat, coursework and results even when the database and other infrastructure remain operational.

Elimu addresses this by distributing the application across three backend nodes. Shared storage and cross-node event broadcasting let the nodes operate as parts of one system, while role-based access control protects academic data such as marks and exam content.

The project demonstrates how distributed architecture can improve availability and also introduces challenges: synchronization, authentication consistency, duplicate prevention, network failures, and shared infrastructure dependencies.

## 3. Objectives

The project aims to:

1. Implement a real-time application using a client-server architecture.
2. Deploy three cooperating backend server nodes.
3. Enable communication between clients connected to different nodes.
4. Persist all data in a shared PostgreSQL database.
5. Use Redis-compatible infrastructure for cross-node event delivery and shared rate limits.
6. Detect unavailable nodes and reconnect clients to healthy alternatives.
7. Recover missed messages after temporary disconnections.
8. Prevent duplicate message records when clients retry sending.
9. Provide role-based portals for students, lecturers and administrators.
10. Support the academic workflow: registration, coursework, exams, marking, controlled release of results, attendance and evaluation.
11. Apply authentication, authorization, input validation and rate limiting throughout.
12. Measure delivery latency and validate distributed behavior through automated tests.
13. Evaluate failure modes and remaining single points of failure honestly.

## 4. What Is in Elimu (Feature Matrix)

| Area | Students | Lecturers | Administrators |
|---|---|---|---|
| Sign up | Registration number, course, year of study; active immediately | Staff number, department; **waits for approval** | Created by `seed:admin` or by another administrator |
| Units | Register for the units of their own course for the current semester (capacity enforced; drop allowed while registration is open) | See assigned classes and class lists (print or CSV) | Create courses, units per year and semester, semesters; schedule classes; assign lecturers and seats |
| Messaging | Private chats after a connection request is accepted; class groups; study groups; reply, copy, react, delete | Message any of their enrolled students directly; create class groups and groups | Cannot take part in class chats unless added; can moderate by deleting messages |
| Coursework | Take assignments and timed exams (multiple choice A to D, written answers, file upload); autosave; auto-submit when time ends | Build assignments and exams; auto-mark multiple choice; mark written answers; give feedback; release or hide results | Everything a lecturer can, on any class |
| Results | See marks only after the lecturer releases them | Gradebook with weights, grade bands and attendance; print or CSV | Reports for all students, all lecturers and any class list |
| Attendance | Enter a 6-digit code during the open window | Open a check-in, see live count, correct by hand, export | Read access through reports |
| Evaluation | Confidential rating of each unit when the semester opens it | See averages and comments once at least 3 students replied | Open and close evaluations per semester |
| Account | Change password, sign out everywhere, forgot-password by email | Same | User management, approvals, password reset, suspension, activity log |
| Look and feel | Six backgrounds, ten accents, text size, spacing; saved to the account | Same | Same |

Servers are never named on public pages. Administrators see them under **System**; anyone else can switch on *Show connection details* in Settings > Privacy.

## 5. System Architecture

### 5.1 Architecture diagram

```text
                         UNIVERSITY USERS
                    (students, lecturers, admins)
                                |
                     +----------------------+
                     | React + Vite Client  |
                     | localhost:5173       |
                     +----------------------+
                                |
                   Optional health-aware gateway
                         localhost:4000
                                |
                Selects a healthy backend node
                                |
             +------------------+------------------+
             |                  |                  |
       +-----------+      +-----------+      +-----------+
       |  NODE_A   |      |  NODE_B   |      |  NODE_C   |
       | Port 3001 |      | Port 3002 |      | Port 3003 |
       | NestJS    |      | NestJS    |      | NestJS    |
       | Socket.IO |      | Socket.IO |      | Socket.IO |
       +-----------+      +-----------+      +-----------+
             |                  |                  |
             +------------------+------------------+
                                |
                 +--------------+--------------+
                 |                             |
          +-------------+              +----------------+
          | Memurai /   |              | PostgreSQL     |
          | Redis       |              | campusconnect  |
          | Port 6379   |              | Persistent data|
          +-------------+              +----------------+
```

**Important:** The optional gateway is a node selector, not a reverse proxy. The browser connects directly to the selected backend node. HTTP requests and WebSocket connections use the node's own port.

### 5.2 Component responsibilities

| Component | Responsibility |
|---|---|
| React frontend | Landing and sign-in pages, role-based portals, class pages, coursework screens, messaging, admin console, themes, connection status |
| NestJS backend | REST API, authentication, role and relation checks, validation, grading, application logic |
| Socket.IO | Real-time messages, reactions, deletions and notifications between clients and nodes |
| Memurai / Redis | Cross-node event transport (Socket.IO adapter) and distributed rate-limit counters |
| PostgreSQL | Users, courses, units, classes, registrations, messages, coursework, submissions, attendance, evaluations, audit log, files |
| Gateway | Health monitoring and healthy-node selection |
| Automated tests | `test:logic` checks grading maths; `test:cluster` validates distributed delivery, security behavior, recovery and latency |

### 5.3 Message delivery workflow

When a user sends a message:

1. The frontend creates a unique client message identifier.
2. The client submits the message (and the id of the message being replied to, if any) to its connected node.
3. The backend validates the request, rate-limits the sender and verifies conversation membership.
4. The backend inserts the message into PostgreSQL.
5. PostgreSQL confirms the transaction.
6. The backend broadcasts the persisted message through the shared Redis channel.
7. Connected clients on every node receive it and update their views.
8. A retry with the same sender and client message identifier returns the original row and never creates a second record.

If persistence fails, the backend must not report the message as saved.

A database write alone does not guarantee that every connected client received the broadcast; reconnect and history-recovery logic (messages are ordered by a per-conversation sequence number) make up for interruptions.

## 6. Technologies Used

| Technology | Purpose |
|---|---|
| Node.js 20+ | JavaScript runtime |
| TypeScript | Type-safe development on both sides |
| NestJS 11 | Backend framework |
| Socket.IO + Redis adapter | Real-time, bidirectional messaging across nodes |
| PostgreSQL | Relational database and durable storage |
| Memurai | Windows-compatible Redis implementation |
| React 18 | Frontend component framework |
| React Router 6 | Role-based routing with nested layouts |
| Vite | Frontend development server and build tool |
| zod | Request and socket payload validation |
| argon2id | Password hashing |
| nodemailer | Password-reset and welcome email (console output in development) |
| Yarn | Dependency management for all three parts (npm also works) |
| PowerShell | Windows development and administration |
| Git | Version control |

Memurai is used as the Redis-compatible service in the Windows development environment. A standard Redis deployment works too.

## 7. Project Structure

Example project root on Windows:

```text
C:\Users\bente\OneDrive\Documenten\campusconnect\campusconnect
```

```text
campusconnect/
|
+-- backend/                 NestJS API + Socket.IO (run once per node)
|   +-- db/
|   |   +-- migrations/      001_init (chat core), 002_campus (academic tables),
|   |                        003_message_actions (reply, delete, reactions)
|   +-- scripts/             db-init, seed-admin, seed-demo, logic-tests, cross-node-test
|   +-- src/                 auth, users, people, conversations, messages, chat, realtime,
|   |                        academic, admin, classroom, assessments, attendance,
|   |                        evaluations, files, health, rate-limit, redis, database,
|   |                        config, common, shared, main.ts
|   +-- .env.example
|   +-- package.json
|   +-- test-results.json    (generated by test:cluster)
|
+-- gateway/                 Zero-dependency node picker (optional)
|   +-- server.mjs
|   +-- package.json
|
+-- frontend/                React app
|   +-- src/
|   |   +-- pages/public/    landing, sign in, sign up, reset password
|   |   +-- pages/app/       Home, Classes, Messages, People, Registration, Grades,
|   |   |                    Gradebooks, Settings, AppShell
|   |   +-- pages/app/class/ ClassPage and its tabs (Stream, Materials, Work, Attendance,
|   |   |                    Grades, Roster, Evaluation), AssessmentEditor, AssessmentPage, Marking
|   |   +-- pages/app/admin/ Users, Courses, Terms, AdminClasses, Reports, Audit, System
|   |   +-- components/      MessageList, MessageMenu, Composer, EmojiPicker, icons, ...
|   |   +-- lib/             api client, realtime client, theme engine, types, emojiData
|   |   +-- state/           auth and chat providers
|   |   +-- styles/          base, landing, auth, app, chat and pages CSS
|   +-- .env.example
|   +-- index.html
|   +-- package.json
|   +-- vite.config.ts
|
+-- README.md
```

If you unzip a new version over an old folder, delete leftover v1 files (`AuthScreen.tsx`, `Shell.tsx`, `Sidebar.tsx`, `SidePanel.tsx`, `NewGroupDialog.tsx`, `styles.css`) or `yarn typecheck` will fail on them.

## 8. Prerequisites

### Required software

- Windows 10 or Windows 11.
- Node.js 20 or newer.
- Yarn Classic (the project uses `1.22.x`). npm also works.
- PostgreSQL 13 or newer.
- Memurai or another compatible Redis service.
- A modern web browser.
- PowerShell.

Verify:

```powershell
node --version
yarn --version
```

Confirm PostgreSQL and the Redis-compatible service are running before starting the backend.

## 9. Initial Setup

```powershell
cd "C:\Users\bente\OneDrive\Documenten\campusconnect\campusconnect"
Get-ChildItem
```

The project should contain `backend`, `frontend` and `gateway`. Do not create a second project or overwrite working source files unnecessarily.

## 10. PostgreSQL Configuration

### 10.1 Create the database

Run once in pgAdmin or `psql`:

```sql
CREATE DATABASE campusconnect;
```

If the database already exists (for example from the v1 chat), do **not** recreate it. Elimu upgrades it in place.

If `psql` is "not recognized" in PowerShell, skip this step and use pgAdmin, or add PostgreSQL's `bin` folder to `PATH`. An existing database needs no creation step.

### 10.2 Initialize or upgrade the schema

```powershell
cd backend
yarn db:init
```

This applies every migration in `backend/db/migrations` once and records them, so it is safe to run again and safe on a v1 database. Run it again whenever you receive a new migration (for example `003_message_actions.sql` for reply, delete and reactions).

Do not run destructive reset commands against a database holding data you need.

## 11. Memurai Configuration

### 11.1 Verify

```powershell
redis-cli -h localhost -p 6379 ping
```

Expected response: `PONG`. If `redis-cli` is unavailable, check Memurai under Windows Services.

### 11.2 Connection

```dotenv
REDIS_URL=redis://localhost:6379
```

All three nodes must use the same Redis-compatible service, otherwise cross-node delivery and shared rate limits break.

**Development safety:** do not run `FLUSHDB` or `FLUSHALL` to fix a rate-limit problem. Investigate the specific key or wait for the window to expire.

## 12. Backend Configuration

### 12.1 Create the environment file

```powershell
cd backend
Copy-Item .env.example .env
```

If `.env` exists, back it up before editing. Never commit it.

### 12.2 Database URL

```dotenv
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/campusconnect
```

Percent-encode reserved characters in the password (`@` becomes `%40`, `:` becomes `%3A`, `/` becomes `%2F`, `#` becomes `%23`, `?` becomes `%3F`, `%` becomes `%25`).

### 12.3 Access-token secret

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```dotenv
JWT_ACCESS_SECRET=PASTE_YOUR_GENERATED_SECRET_HERE
```

All three nodes must share the same value. Never publish it in reports, screenshots or repositories.

### 12.4 Other settings

```dotenv
CORS_ORIGINS=http://localhost:5173
HOST=127.0.0.1
COOKIE_SAMESITE=lax
TRUST_PROXY=0
```

Email (password reset and welcome messages). Leave `SMTP_HOST` empty in development and the message, including the reset link, is printed in the server console:

```dotenv
# APP_URL=http://localhost:5173
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=Elimu <no-reply@your-university.ac.ke>
# SMTP_SECURE=false
```

Reset links look like `APP_URL/reset-password?token=...`, work once and expire after 30 minutes.

Use only variables that `.env.example` and the validation code support. If the backend reports `Invalid environment configuration`, the message lists exactly what is missing.

## 13. Starting the Three Backend Nodes

| Node | Port | Health endpoint |
|---|---:|---|
| NODE_A | 3001 | `http://localhost:3001/api/health` |
| NODE_B | 3002 | `http://localhost:3002/api/health` |
| NODE_C | 3003 | `http://localhost:3003/api/health` |

Stop any older backend first so the ports are free.

```powershell
cd backend
yarn install
yarn db:init
yarn build
yarn cluster
```

`yarn cluster` starts all three nodes in one terminal and stops them together. Alternatively start each in its own terminal with `yarn start:a`, `yarn start:b`, `yarn start:c`. Do not use both approaches at once.

Verify from another terminal:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3002/api/health
Invoke-RestMethod http://localhost:3003/api/health
```

A healthy answer from NODE_A does not prove NODE_B and NODE_C are running. Check all three.

## 14. Gateway Setup

The gateway is optional. It polls each node's health and tells the browser which one to use. It does not proxy traffic.

```powershell
cd gateway
yarn start
```

It listens on port `4000`. Inspect `http://localhost:4000/cluster` to see the nodes and their observed health. Without the gateway, set `VITE_GATEWAY_URL=` (empty) and the browser probes each node itself.

## 15. Frontend Setup

```powershell
cd frontend
Copy-Item .env.example .env     # only if you need to change the defaults
yarn install
yarn typecheck
yarn build
yarn dev
```

Open **http://localhost:5173**. Use `localhost` consistently, never `127.0.0.1`, because the refresh-token cookie is shared across the local node origins.

Default `.env`:

```dotenv
VITE_NODES=NODE_A=http://localhost:3001,NODE_B=http://localhost:3002,NODE_C=http://localhost:3003
VITE_GATEWAY_URL=http://localhost:4000
```

If `tsc` is not recognized, check `Test-Path node_modules\.bin\tsc.cmd` and run `yarn install` again.

Vite is pinned to port `5173` with `strictPort: true`. If it is occupied, stop the conflicting process; the backend's CORS list expects this exact origin.

## 16. Running the Complete Application

| Order | Component | Command |
|---|---|---|
| 1 | PostgreSQL | Windows service |
| 2 | Memurai | Windows service, port 6379 |
| 3 | Backend | `yarn cluster` in `backend` |
| 4 | Gateway (optional) | `yarn start` in `gateway` |
| 5 | Frontend | `yarn dev` in `frontend` |

Then open `http://localhost:5173`. If the app shows "Can't reach the chat servers", check that the nodes are running and that `CORS_ORIGINS` matches the page origin exactly.

## 17. First Run as an Administrator

Create the first administrator (prints a temporary password, shown once):

```powershell
cd backend
yarn seed:admin you@example.com "Your Name"
```

Optional demo data (a course, units, a lecturer and students). **Never run it on a real system**:

```powershell
yarn seed:demo
```

All demo accounts share the password `ElimuDemo2026`, for example lecturer `j.kamau@demo.elimu.test` and student `amina.wanjiru@demo.elimu.test`.

Then, signed in as administrator (you are forced to choose a new password on first sign-in):

1. **Courses and units:** add a course (duration and semesters per year) and its units for each year and semester.
2. **Semesters:** create one, make it current, open registration.
3. **Classes:** schedule units for the semester, choose lecturers and capacity.
4. **Approvals:** approve lecturers who signed up.

Students can now register for their units and lecturers see their classes. When the semester ends, open **evaluation** for it.

## 18. Using Elimu (by Role)

### Student

1. Sign up with registration number, course and year; you can sign in immediately.
2. **Registration:** pick units for the current semester (own course only). Drop them while registration is open.
3. **Classes:** open a class for the stream (announcements), materials, coursework, attendance, grades, class list and evaluation.
4. **Work:** do assignments (text and/or file) and timed exams. Answers autosave; the server enforces the time limit.
5. **Attendance:** enter the 6-digit code while the lecturer's window is open.
6. **Grades:** marks appear only after the lecturer releases them.
7. **People and Messages:** send a connection request to a lecturer or student; once accepted you can chat privately. Join class groups and study groups.
8. **Settings:** theme, accent, text size, spacing, password, sign out everywhere, privacy.

### Lecturer

1. Sign up with staff number and department, then wait for an administrator to approve the account.
2. **Classes:** post to the stream, upload materials, create assignments and exams (multiple choice and written), publish or close them.
3. **Marking:** multiple choice is auto-marked; mark written answers, give feedback, then **release** results (and optionally show correct answers). Results can be hidden again.
4. **Attendance:** open a check-in window, watch the live count, correct entries by hand, export.
5. **Gradebooks:** weighted totals, grade bands and attendance; print or CSV.
6. **Evaluation:** see averages and comments once at least three students have replied.

### Administrator

Manage users (approve, suspend, reset password, change role), courses and units, semesters, classes and lecturer assignments, run reports (all students, all lecturers, any class list), read the audit log and view node health under **System**. An administrator cannot demote, suspend or lock themselves out, nor remove the last administrator.

## 19. Messaging in Detail

- **Conversation types:** direct (after an accepted connection request), class (one per scheduled class), group (study or project groups with invitation codes).
- **Click (or right-click) a message** to open its menu: **Reply**, **Copy**, **React** and **Delete**. Hovering also shows quick reply and emoji tools.
- **Reply** quotes the original above your message; click the quote to jump to it.
- **React** with the quick row or the full **emoji picker**: about 1,890 emojis in categories, with search, skin tones, flags and a "recently used" row. Reactions toggle per person and update live on every node.
- **Delete** erases the text for everyone and leaves a "message deleted" placeholder. You can delete your own messages; class or group owners and administrators can delete others' (moderation). The server enforces this.
- **Composer:** Enter sends, Shift+Enter adds a line, an emoji button opens the picker, and a reply bar shows what you are replying to. The typing box stays pinned to the bottom of the screen while the message list scrolls above it.
- **Reliability:** messages sent offline are queued and sent on reconnect with the same id, so there are no duplicates. The queue lives in memory only; closing the tab discards unsent messages.

Run `yarn db:init` to apply migration `003_message_actions.sql` before using these features.

## 20. Coursework, Exams and Results

- Marks stay hidden until a lecturer releases them, per coursework. Lecturers can hide them again.
- Multiple choice is marked on the server from the stored key. Students never receive the correct answers unless the lecturer chooses to show them after release.
- Exam questions are not sent to the browser until the student starts. The timer is enforced by the server (a short grace period covers slow networks), so closing the tab does not stop the clock.
- Late submissions are flagged against the deadline.
- Files live in PostgreSQL (10 MB limit, extension allow-list, content sniffing, downloaded as attachments). Fine for a university project; use object storage in production.
- Grade bands: **A 70+, B 60+, C 50+, D 40+, E below.** Change them in `backend/src/common/grading.ts`.
- Evaluations: lecturers never see who answered. The API returns only averages and comments, and only after three responses, so a small class cannot identify a student. The student id is stored with each response solely to prevent duplicate submissions, so a database administrator could technically see it. This is **confidential**, not cryptographically anonymous. For true anonymity, store a one-way token instead of the id.
- CSV exports neutralise spreadsheet formulas.

## 21. Automated Distributed Testing

Two scripts live in `backend`:

```powershell
yarn test:logic       # grading maths, no database needed
yarn test:cluster     # needs PostgreSQL, Memurai and the three nodes running
```

### 21.1 Prepare

Ensure PostgreSQL and Memurai are running, `yarn db:init` has been run and all three nodes are up.

### 21.2 What `test:cluster` checks

- Communication between clients connected to different nodes.
- Message delivery counts and measured latency (median and p95).
- Duplicate-message prevention.
- Conversation membership authorization.
- Request validation.
- Rejection of missing or forged authentication tokens.
- History recovery after switching nodes.
- Rate limiting.

It creates temporary test users. Check its cleanup behavior before running it against a database with data you care about.

### 21.3 Test with two nodes

```powershell
$env:TEST_NODES = "NODE_A=http://localhost:3001,NODE_C=http://localhost:3003"
yarn test:cluster
Remove-Item Env:TEST_NODES -ErrorAction SilentlyContinue
```

### 21.4 Results

```powershell
Get-Content .\test-results.json
```

Use the values from your own run. Never substitute estimated figures.

### 21.5 Rate-limit failures

Each run registers 7 users and sign-ups are capped at 20 per hour per IP. On HTTP `429`, stop repeating, read the retry information and wait for the window to expire (or use an isolated test environment). Do not flush the shared Redis database.

## 22. Demonstrating Node Failure and Recovery

### 22.1 Prepare

1. Start PostgreSQL, Memurai, all three nodes, the frontend and optionally the gateway.
2. Open two browser sessions (one normal, one private) and sign in with two accounts.
3. Open the same conversation. As an administrator, **System** shows which node each client uses.

### 22.2 Stop a node

Inspect the listener first:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

Once you have confirmed it is the project's node:

```powershell
Stop-Process -Id <PROCESS_ID>
```

Or simply close the terminal that runs it. Do not kill a process only because it holds a port.

### 22.3 Observe

- The connection indicator shows *Reconnecting...* briefly, then *Connected* on another node, with a banner naming it.
- Send messages from the other browser mid-switch; they appear once the first client reconnects (it fetches everything newer than the last message it saw).
- Reactions and deletions made during the gap are refreshed during the same catch-up.

### 22.4 Restart the node

Start it again. It shows *Recovering*, then *Healthy* after two clean checks, and reads shared data from PostgreSQL.

### 22.5 Other failures

- **Redis stopped:** nodes report *degraded*; users on the same node still receive messages, the ack says `delivery: "local"`, and clients re-sync when Redis returns. Sign-in and joining are refused (fail closed).
- **PostgreSQL stopped:** sending fails with "could not save"; the message stays marked unsent instead of being falsely acknowledged.
- **Browser offline:** messages queue and send on reconnect. They do not survive a page refresh or closing the tab.

## 23. Security Design

| Area | What is done |
|---|---|
| Passwords | Argon2id (OWASP parameters); constant-time-ish login (dummy hash for unknown emails); 10+ characters, letter and number. Temporary passwords are hashed too and must be changed at first sign-in |
| Sessions | 15-minute JWT access tokens (HS256, algorithm pinned, issuer and audience checked). 7-day refresh token in an `HttpOnly`, `SameSite` cookie scoped to `/api/auth`, stored **hashed** in the database |
| Token theft | Refresh tokens rotate on every use. Reusing an old one revokes the whole session family (10 s grace window for two tabs refreshing at once) |
| Brute force | Per-account+IP lockout (5 tries / 15 min), per-IP limits on login and sign-up. These **fail closed** if Redis is down |
| Rate limits | Counters live in Redis, so they apply across all nodes. 20 messages / 10 s per user; reactions and deletes are limited too; invite-code guessing limited to 10 / min |
| Role checks | A `Roles` guard on every route; relation checks in SQL (a lecturer reaches only their own classes, a student only their own submissions) |
| Live account state | Every request reloads the user, so suspension or a forced password change takes effect immediately and live sockets are closed |
| Password reset | Random, stored hashed, single use, 30-minute expiry; the "forgot password" response is identical whether or not the email exists |
| Authorisation | Membership is checked in the same SQL statement that inserts a message. Non-members get 404 (not 403). Socket rooms are joined only from database membership. Reply targets must belong to the same conversation. Deleting needs sender, administrator or conversation owner (non-direct) |
| Idempotency | `UNIQUE (sender_id, client_message_id)`: a retry returns the original row |
| Exams and marks | Answer keys never leave the server before release; server-enforced timers; marks hidden until released |
| Input | Every body, query and socket event validated with zod (`.strict()`, length caps). Emoji reactions must be a single grapheme that is an emoji. Control and bidi-override characters stripped. All SQL parameterised. Messages render as text, never HTML |
| Transport | CORS allow-list; WebSocket `Origin` checked; 10 KB JSON and 16 KB socket payload caps; Helmet with a deny-all CSP; `Cache-Control: no-store` on auth responses; CSRF guard (Origin check + SameSite) on cookie endpoints |
| Files | Extension allow-list, content sniffing, size cap, served as attachments |
| Audit | Administrative changes are written to an audit log; an administrator cannot demote, suspend or lock themselves out, nor remove the last administrator |
| Errors | One error shape; unexpected errors are logged server-side and returned as a generic 500 |

These controls should be confirmed against the code. Their presence here is not a substitute for review or security testing.

### Production considerations

- Serve over HTTPS and secure WebSockets; set `NODE_ENV=production` (turns on secure cookies) and `TRUST_PROXY` to the number of proxies in front.
- Keep secrets out of source control; use least-privilege database credentials.
- Restrict database and Redis access to trusted hosts; configure backups and restore tests.
- Configure real SMTP and `APP_URL`; never run `seed:demo`.
- Monitor logs and failed sign-ins; review dependency vulnerabilities.
- Move uploaded files to object storage.

A local Windows demonstration is not automatically production-ready.

## 24. Fault Tolerance and Limitations

| Failure scenario | Behavior | Limitation |
|---|---|---|
| One backend node stops | Other nodes keep serving; clients reconnect to a healthy node within about a second and fetch missed messages | Depends on health detection, client retry logic and remaining capacity |
| Redis stops | Cross-node broadcasts stop; each node still delivers to its own clients and says so (`delivery: "local"`); clients re-sync when Redis returns | Sign-in, joining and rate-limited actions are refused (fail closed) |
| PostgreSQL stops | Writes are not acknowledged and stay marked unsent; nothing is falsely reported as saved | Nothing can be saved until the database returns |
| Browser goes offline | Messages queue and send on reconnect | Queue is in memory; unsent messages are lost if the tab closes |
| A node restarts | Shared data comes from PostgreSQL | In-memory state (live sockets) is not restored automatically |
| All nodes stop | Application unavailable | No surviving application node |

**Single points of failure in this demo:** one Redis and one PostgreSQL instance. State this in your report; production would use replicated, failover-capable versions of both.

Three nodes improve resilience only when the shared dependencies, persistence guarantees and recovery behavior are understood and tested. The system also distinguishes **persistence** from **delivery**: a message committed to the database stays saved even if a broadcast fails, and recovery logic makes it visible to clients that missed the live event.

## 25. Design Notes

- **Servers are hidden from ordinary users.** Public pages never name nodes. Administrators see them under **System**; others can enable *Show connection details* in Settings > Privacy.
- **Themes** are CSS variables (`--bg`, `--panel`, `--text`, `--accent`, ...) applied by a theme engine and saved to the account, so appearance follows the user across devices.
- **Soft delete.** Deleting a message clears its body and records who deleted it and when; reactions are removed. The database constraint allows an empty body only when `deleted_at` is set.
- **Sequence-based catch-up.** Each conversation has an increasing `seq`; clients ask for everything after the last `seq` they saw.
- **Emoji data** is generated offline (validated with Unicode `RGI_Emoji`) into `frontend/src/lib/emojiData.ts`; skin tones are applied at render time.

## 26. Troubleshooting

### 26.1 `tsc` is not recognized

```powershell
yarn install
Test-Path node_modules\.bin\tsc.cmd
yarn typecheck
```

### 26.2 TypeScript errors about `AuthScreen`, `Shell`, `Sidebar` and similar

Leftover v1 files from unzipping over an old folder. Delete `AuthScreen.tsx`, `Shell.tsx`, `Sidebar.tsx`, `SidePanel.tsx`, `NewGroupDialog.tsx` and `styles.css` from `frontend/src`.

### 26.3 `EADDRINUSE` on 3001, 3002, 3003 or 5173

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

An older backend is probably still running. Confirm the owning process before stopping it.

### 26.4 `password authentication failed`

Wrong password in `DATABASE_URL`, unencoded special characters, or a database user that lacks permission.

### 26.5 `psql` is not recognized

Use pgAdmin, or add PostgreSQL's `bin` folder to `PATH`. If the `campusconnect` database already exists you do not need `psql` at all; just run `yarn db:init`.

### 26.6 `Invalid environment configuration`

The message lists the missing or invalid `.env` values. Fix them and restart.

### 26.7 `Can't reach the chat servers`

No nodes running, wrong `VITE_NODES`, gateway configured but down, or `CORS_ORIGINS` not matching `http://localhost:5173`. Check each health endpoint and the browser console.

### 26.8 Signed in on one node, 401 on another

The nodes have different `JWT_ACCESS_SECRET` values, or different databases, or you are mixing `localhost` and `127.0.0.1`.

### 26.9 Cross-node messages not delivered

All nodes running? Same `REDIS_URL`? Memurai up? Clients in the right conversation? Membership correct? Check which node each client uses.

### 26.10 HTTP 429

A registration, login or messaging limit was reached. Read the retry information and wait. Do not delete shared Redis state.

### 26.11 Message features (reply, delete, reactions) fail

Migration 003 has not been applied. Run `yarn db:init` in `backend`, then restart the nodes.

### 26.12 Typing box not at the bottom of the chat

Replace `frontend/src/styles/chat.css` with the latest version and hard-refresh the browser (Ctrl+F5).

### 26.13 Demoing from a phone on the same Wi-Fi

Set `HOST=0.0.0.0`, add the page's origin to `CORS_ORIGINS`, and set `VITE_NODES` and `VITE_GATEWAY_URL` to your PC's LAN address. Cookies are per host, so open the app through that same address.

### 26.14 No emails arrive

With `SMTP_HOST` empty, emails are printed in the server console. Set the `SMTP_*` values and `APP_URL` for real mail.

## 27. Configuration Reference

### Backend (`backend/.env`)

| Variable | Purpose |
|---|---|
| `NODE_ID`, `PORT`, `HOST` | Identity and listening address (the `start:a/b/c` scripts override node and port) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis-compatible service |
| `JWT_ACCESS_SECRET` | Access-token signing secret (same on every node) |
| `ACCESS_TOKEN_TTL_SEC` | Access-token lifetime (default 900) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh-token lifetime (default 7) |
| `CORS_ORIGINS` | Allowed browser origins, comma separated |
| `COOKIE_SAMESITE`, `COOKIE_SECURE` | Cookie policy |
| `TRUST_PROXY` | Number of trusted reverse proxies |
| `ALLOWED_EMAIL_DOMAINS` | Optional sign-up domain restriction, e.g. `students.uni.ac.ke` |
| `DB_POOL_MAX` | Maximum database connections |
| `APP_URL` | Address used in emailed links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Outgoing email; empty host prints emails to the console |

### Gateway

| Variable | Purpose |
|---|---|
| `GATEWAY_PORT`, `GATEWAY_HOST` | Listening address (default `4000`, `127.0.0.1`) |
| `NODES` | Backend node names and URLs |
| `POLL_INTERVAL_MS`, `PROBE_TIMEOUT_MS` | Health-check timing |
| `CORS_ORIGINS` | Allowed gateway origins |

### Frontend

| Variable | Purpose |
|---|---|
| `VITE_NODES` | Comma-separated `NAME=URL` backend nodes |
| `VITE_GATEWAY_URL` | Optional gateway URL; empty disables it |

Vite exposes `VITE_` variables to the browser. Never put secrets in them.

### Scripts

| Where | Command | Purpose |
|---|---|---|
| backend | `yarn db:init` | Apply migrations (safe to repeat) |
| backend | `yarn seed:admin <email> "<name>"` | Create an administrator, prints a temporary password |
| backend | `yarn seed:demo` | Demo course, units, lecturer and students (development only) |
| backend | `yarn build` / `yarn cluster` | Build and run three nodes |
| backend | `yarn test:logic` | Grading logic tests |
| backend | `yarn test:cluster` | Cross-node integration tests and latency |
| backend | `yarn typecheck` | TypeScript check |
| frontend | `yarn dev` / `yarn build` / `yarn typecheck` | Dev server, production build, type check |
| gateway | `yarn start` | Node picker |

## 28. Testing Evidence for the Assignment

### Recommended evidence

1. **Architecture:** diagram with frontend, three nodes, shared messaging service, database and gateway.
2. **Health checks:** responses from the three health endpoints.
3. **Real-time messaging:** two clients exchanging messages, including a reply and a reaction.
4. **Cross-node delivery:** the nodes each client used and successful exchange between them.
5. **Performance:** measured median and p95 latency from `test-results.json`.
6. **Duplicate prevention:** a retry with the same client message id creates no second record.
7. **Authorization:** a non-member cannot access a conversation; a student cannot see unreleased marks or exam answers.
8. **Authentication:** missing and forged tokens are rejected.
9. **History recovery:** messages missed during a disconnection are recovered.
10. **Failover:** stop one node and record whether clients reconnect.
11. **Dependency failure:** observed behavior with Redis or PostgreSQL stopped in a controlled test.
12. **Academic workflow:** registration, an exam taken, marked and released, attendance, evaluation. Record what you actually ran.
13. **Limitations:** remaining single points of failure and anything not fully implemented or tested.

### Results table template

| Test | Expected result | Observed result |
|---|---|---|
| Three-node health check | All three nodes healthy | Record result |
| Cross-node messaging | Messages reach intended recipients | Record result |
| Duplicate prevention | Retry creates no duplicate | Record result |
| Invalid authentication | Invalid tokens rejected | Record result |
| Membership authorization | Non-members denied | Record result |
| History recovery | Missed messages retrieved | Record result |
| Single-node failure | Clients recover on a healthy node | Record result |
| Latency | Median and p95 recorded | Insert measured values |
| Result release | Marks hidden until released | Record result |
| Exam timer | Server enforces the time limit | Record result |

Do not claim a test passed unless it ran and its output supports the claim.

## 29. Future Improvements

Implemented in v2 and therefore no longer on this list: reply, copy, delete and emoji reactions on messages.

Possible extensions (not existing functionality unless built and tested):

- Forward, pin and download actions on messages (visible in some chat designs but not implemented).
- Replicated PostgreSQL with automatic failover; highly available Redis.
- A production reverse proxy or load balancer.
- Persistent client-side storage for unsent messages.
- Read receipts, typing indicators and presence.
- Message search and pagination controls.
- Push notifications.
- Object storage for files, with virus scanning.
- True anonymous evaluations using one-way tokens.
- Timetables, fee status and transcripts.
- Centralized logging, metrics and tracing; containerized deployment.
- Stronger recovery testing under network partitions and simultaneous failures.

## 30. Conclusion

Elimu shows how a real university platform can be designed as a distributed system rather than around one application server. Three NestJS nodes with shared PostgreSQL persistence and Redis-compatible messaging provide a practical environment for studying real-time communication, distributed state, deduplication, health monitoring, reconnection, recovery, role-based security and failure handling, while the academic features (registration, coursework, exams, controlled release of results, attendance and evaluation) give it a realistic workload.

The key engineering principle remains: **multiple application nodes improve resilience only when shared dependencies, persistence guarantees and recovery behavior are understood and tested.** The final evaluation should therefore combine functional tests with measured results, controlled failure demonstrations, and an honest discussion of the limitations.
