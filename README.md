# HandiHotel

**HandiHotel** is a full-scale 3D multiplayer browser game inspired by classic Habbo Hotel, built with TypeScript, Three.js / React Three Fiber, Socket.IO, Express, Prisma, PostgreSQL, and Redis.

---

## Features

- **Inclusive 3D Avatar Customizer**: Choose body types, skin tones, 10+ hairstyles, expressions, clothing, accessories, and mobility aids (manual/racing/power wheelchairs, forearm & underarm crutches, prosthetics, guide cane, rollator walker) with custom colors.
- **11 Pre-Furnished Public Hotel Rooms**: Explore the Main Lobby, Grand Reception, Cozy Lounge, Le Bizarre Restaurant, Neon Nightclub, Rooftop Swimming Pool, Retro Arcade, Sky Rooftop Terrace, Grand Corridor & Elevators, Turbo Wheelchair Race Arena, and Grand Event Ballroom.
- **Private Room Builder**: Create, furnish, rotate, stack, and customize your own hotel rooms with templates, floor/wall styles, and visitor permissions.
- **Real-Time Multiplayer**: Click-to-walk A* pathfinding on 3D isometric grids, sitting & furniture interactions, speech bubbles (normal, shout, whisper), emotes (wave, dance, laugh, cheer, wheelie, and more), friends list, direct messages, and room invites.
- **Economy & Trading**: 55+ nostalgic and humorous furniture & cosmetic catalog items, inventory management, player-to-player live trading, and daily streak rewards.
- **4 Multiplayer Minigames & Hotel Events**:
  - **Wheelchair Racing**
  - **Hotel Olympics**
  - **Dance Battle**
  - **Furniture Chaos**
- **Procedural Web Audio Engine**: Zero-asset synthesized sound effects and adaptive room-theme background lounge music.

---

## Architecture Overview

HandiHotel is organized as an npm workspaces monorepo:

```text
.
├── packages/
│   ├── shared/          # @handihotel/shared — Types, Socket.IO contracts, catalog, public rooms, A* pathfinding
│   ├── server/          # @handihotel/server — Express REST API, Socket.IO realtime engine, Prisma ORM
│   └── client/          # @handihotel/client — Vite + React + Three.js 3D client & Web Audio engine
├── tests/
│   ├── unit/            # Vitest unit & integration tests
│   └── e2e/             # Playwright end-to-end browser tests
├── docker-compose.yml   # Full stack: Postgres 16, Redis 7, Server, Client
├── Dockerfile.server    # Multi-stage Node 22 Alpine build for @handihotel/server
├── Dockerfile.client    # Multi-stage Node 22 Alpine + Nginx build for @handihotel/client
├── vitest.config.ts     # Vitest configuration
└── playwright.config.ts # Playwright E2E configuration
```

### Storage & Scaling Modes

By default (`STORAGE_MODE=auto`), the server connects to PostgreSQL and Redis when available and automatically falls back to a local JSON store + in-memory Socket.IO adapter if they are not running—allowing instant zero-dependency local development.

---

## Quick Start

### Option 1: Local Development

**Prerequisites:** Node.js 20+ (Node 22 recommended) and npm.

1. Copy the example environment file (optional—sensible defaults are built in):
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start both the server (port `4000`) and client (port `5173`):
   ```bash
   npm run dev
   ```
4. Open [http://localhost:5173](http://localhost:5173) in your browser.

To run individual services:
```bash
npm run dev:server   # Backend API & Socket.IO on http://localhost:4000
npm run dev:client   # Vite frontend on http://localhost:5173
```

### Option 2: Full Stack with Docker Compose

**Prerequisites:** Docker and Docker Compose v2.

1. Build and start PostgreSQL, Redis, Server, and Client:
   ```bash
   docker compose up --build
   ```
   Or detached via the npm helper script:
   ```bash
   npm run docker:up
   ```
2. Access the services:
   - **Client**: [http://localhost:5173](http://localhost:5173)
   - **Server API / Socket.IO**: [http://localhost:4000](http://localhost:4000)
   - **PostgreSQL**: `localhost:5432` (`user: handihotel`, `password: handihotel_secret`, `db: handihotel`)
   - **Redis**: `localhost:6379`
3. Stop and remove containers:
   ```bash
   npm run docker:down
   ```

---

## Database Commands (PostgreSQL + Prisma)

When using PostgreSQL locally (e.g. `docker compose up -d postgres redis`):

```bash
npm run db:generate   # Generate Prisma Client
npm run db:push       # Push Prisma schema to PostgreSQL
npm run db:seed       # Seed official public rooms and demo data
```

---

## Build & Testing

### Production Build
```bash
npm run build
```

### Unit & Integration Tests (Vitest)
Runs tests matching `packages/*/src/**/*.test.ts` and `tests/unit/**/*.test.ts`:
```bash
npm test              # Single run
npm run test:watch    # Watch mode
```

### End-to-End Tests (Playwright)
Runs headless Chromium tests in `tests/e2e/` against `http://localhost:5173` (with screenshots on failure and 60s timeout):
```bash
# Ensure the app is running (npm run dev or docker compose up)
npm run test:e2e
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `4000` | Backend HTTP & Socket.IO port |
| `NODE_ENV` | `development` | Runtime environment (`development` \| `production`) |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin for the client |
| `JWT_SECRET` | `handihotel-super-secret-dev-key-change-in-production` | Secret key for signing auth JWTs |
| `DATABASE_URL` | `postgresql://handihotel:handihotel_secret@localhost:5432/handihotel?schema=public` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `STORAGE_MODE` | `auto` | `auto`, `postgres`, or `local` |
| `VITE_API_URL` | `http://localhost:4000` | Backend REST URL used by the client |
| `VITE_SOCKET_URL` | `http://localhost:4000` | Backend Socket.IO URL used by the client |
