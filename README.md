# Store Analytics Dashboard

## Setup Instructions
1. Install dependencies.
   ```bash
   cd frontend && pnpm install
   cd backend && pnpm install
   ```
2. Start Redis locally with Docker.
   ```bash
   docker run -d \
     --name redis-amboras \
     -p 6379:6379 \
     -v redis_data:/data \
     redis:latest \
     redis-server --appendonly yes
   ```
3. Create a Supabase project.
   - Enable Email/Password auth.
   - Copy the project URL and anon key for the frontend.
   - Copy the Postgres connection string for the backend.
   - Use the pooler connection string if your local machine has trouble resolving the direct DB host.
4. Create env files from the examples.
   ```bash
   cp frontend/.env.example frontend/.env
   cp backend/.env.example backend/.env
   ```
5. Fill the envs.
    - Frontend needs the Supabase URL, anon key, and backend base URL.
    - Backend needs the frontend URL, Supabase URL, Postgres `DATABASE_URL`, Redis URL, ingest key, and optionally `AUTH_STORE_CONTEXT_TTL_SECONDS` for Redis-backed auth/store-context caching.
6. Start the backend. The backend bootstrap creates the public `users`, `stores`, and `analytics_events` tables plus indexes automatically.
   ```bash
   cd backend
   pnpm start:dev
   ```
7. Start the frontend.
   ```bash
   cd frontend
   pnpm dev --port 3000
   ```
8. Sign up from the UI.
   - Signup/login triggers `POST /api/v1/auth/bootstrap`.
   - The backend auto-provisions a `users` row and a default store for the authenticated owner.
9. Run verification scenarios.
   - Static correctness check. This confirms the code compiles before trying runtime scenarios.
     Frontend:
     ```bash
     cd frontend
     pnpm exec next build --webpack
     ```
     Backend:
     ```bash
     cd backend
     pnpm build
     ```
   - Dashboard bootstrap check. This validates auth, SSR, and auto-provisioning.
     1. Open `http://localhost:3000`.
     2. Sign up or log in with a Supabase email/password user and confirm on mail.
     Expected result:
     - the first dashboard load is already populated
     - protected requests succeed
     - a default store is created automatically for the user
   - Single-store realtime stream. This is the best test to confirm the logged-in user sees live dashboard movement.
     Before running it:
     - log in once so the user/store is auto-provisioned
     - use that same Supabase user UUID in the command below
     ```bash
     cd backend
     pnpm load:analytics -- --user-id YOUR_SUPABASE_USER_ID --ingest-key YOUR_INGEST_KEY --rate-per-minute 1200 --duration-seconds 30 --concurrency 25
     ```
     What this tests:
     - ingest endpoint acceptance
     - Redis materialization updates
     - websocket invalidation
     - frontend silent refetch
     Expected result:
     - KPI cards move
     - charts update live
     - recent activity keeps showing the newest 20 events
   - Assignment-style multi-store stream at 10,000 events/minute across all stores. This simulates the challenge’s total system load, not just one owner dashboard.
     ```bash
     cd backend
     export DATABASE_URL='YOUR_DATABASE_URL'
     pnpm load:analytics -- --store-count 25 --seed-stores --ingest-key YOUR_INGEST_KEY --rate-per-minute 10000 --duration-seconds 60 --concurrency 100
     ```
     What this tests:
     - Redis write throughput under aggregate load
     - Postgres batch persistence under sustained traffic
     - synthetic store creation for load scenarios
     Expected result:
     - the script should complete with a high accepted count and low or zero failures
     - backend should remain responsive
     - Postgres `analytics_events` row count should keep increasing as batches flush
   - Mixed traffic in two terminals. This combines a focused live-dashboard test with system-wide background load.
     Terminal 1:
     ```bash
     cd backend
     pnpm load:analytics -- --user-id YOUR_SUPABASE_USER_ID --ingest-key YOUR_INGEST_KEY --rate-per-minute 1200 --duration-seconds 30 --concurrency 25
     ```
     Terminal 2:
     ```bash
     cd backend
     export DATABASE_URL='YOUR_DATABASE_URL'
     pnpm load:analytics -- --store-count 25 --seed-stores --ingest-key YOUR_INGEST_KEY --rate-per-minute 10000 --duration-seconds 60 --concurrency 100
     ```
     What this tests:
     - whether one owner’s dashboard still feels live while the system is handling broader traffic
     Expected result:
     - the logged-in store keeps updating in the UI
     - the backend still accepts the wider multi-store stream
   - API latency spot-check. This is a quick manual way to observe warm endpoint timing.
     ```bash
     curl -o /dev/null -s -w "total=%{time_total}\n" \
       -H "Authorization: Bearer AUTHORIZATION_HEADER_TOKEN" \
       http://localhost:4000/api/v1/analytics/overview
     ```
     How to use it:
     - run it several times
     - ignore the first request or two because caches may still be cold
     - compare timings again while a load script is running
     Expected result:
     - warm requests should generally be faster than cold ones because auth/store resolution and analytics reads are Redis-backed
   - Postman sanity checks.
     Required headers:
     - `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>` for `GET /api/v1/analytics/overview`, `GET /api/v1/analytics/top-products`, and `GET /api/v1/analytics/recent-activity`
     - `x-ingest-key: <ANALYTICS_INGEST_API_KEY>` for `POST /api/v1/analytics/events`
     Useful things to verify:
     - overview reflects revenue and conversion changes after ingestion
     - top-products ranking changes after purchase events
     - recent-activity always returns the latest 20 events

## Architecture Decisions

### Data Aggregation Strategy
- Decision: Use Redis as the materialized hot-read layer and Postgres in Supabase as the durable event store, with lazy cache rebuilds from Postgres when Redis misses.
- Why: The dashboard endpoints need fast reads, while events still need durable storage and replayability. Redis gives cheap counter and sorted-set reads, and Postgres gives durable recovery plus ad hoc querying.
- Trade-offs: I gained fast read paths and simple rebuild logic, but I sacrificed perfect architectural cleanliness because the current implementation still blends app logic, aggregation, and persistence.

### Real-time vs. Batch Processing
- Decision: Hybrid. Events update Redis immediately for realtime dashboards, and the raw events are batch-flushed to Postgres on an interval or batch-size threshold.
- Why: That gives the UI realtime feedback without paying Postgres write cost per event.
- Trade-offs: I gained better perceived speed and lower DB write amplification, but I sacrificed strict durability during the in-memory batch window because a process crash before flush can delay persistence until the next replay source exists.

### Frontend Data Fetching
- Decision: Server-render the initial dashboard snapshot, then switch to websocket-triggered silent refetches for overview, top-products, and recent activity so cards, charts, and the activity feed stay live after hydration.
- Why: This keeps first paint fast through SSR while letting the backend remain the single source of truth. The websocket only acts as an invalidation trigger, and the frontend reloads the latest Redis-backed API data without showing a blocking loading state.
- Trade-offs: I gained a simpler realtime model and avoided duplicating aggregation logic in the browser, but I sacrificed some efficiency because every invalidation still results in HTTP refetches instead of pushing fully shaped analytics payloads over the socket.

### Performance Optimizations
- Redis counters and sorted sets for overview, top-products, and recent activity.
- Redis-backed store-context caching for authenticated users so warm protected reads can skip Postgres owner/store resolution.
- Batched Postgres inserts with `ON CONFLICT DO NOTHING` for event durability.
- Automatic DB bootstrap indexes on `stores`, `users`, and `analytics_events`.
- Rebuild de-duplication so concurrent cold reads do not all rehydrate Redis at once.
- Initial SSR fetch plus websocket invalidation to avoid loading spinners after hydration.
- Deterministic store auto-provisioning so local testers do not need manual SQL before using the app.

## Known Limitations
- The auth path still verifies Supabase JWTs on every protected request, so even with Redis-backed store-context caching there is still non-trivial auth overhead before analytics reads.
- The batching queue is in-process. For real production scale, a dedicated queue or stream would be safer than process memory.
- The load test generator is great for local and interview-style validation, but it is not a replacement for a real distributed load test.
- The analytics schema is optimized for this challenge, not for warehouse-grade long-term analytics workloads.
- Top products display `product_id` directly instead of joining to a richer product catalog.
- The current database bootstrap lives in application startup code rather than a proper migration system.

## What I'd Improve With More Time
- Move high-volume analytics storage and longer-horizon reporting to a warehouse-oriented system such as Google BigQuery or AWS Redshift.
- Split ingestion and aggregation into separate workers or streams instead of relying on a single Nest process queue.
- Embed store resolution metadata in claims or add smarter invalidation around the Redis auth cache so tenant context changes propagate instantly without waiting for TTL expiry.
- Add observability for ingest lag, Redis hit rate, batch flush time, websocket fan-out, and API latency percentiles.
- Add real automated tests for auth bootstrap, Redis rebuilds, ingest batching, dashboard hydration, and load-test regression checks.
- Replace startup SQL bootstrap with explicit migrations and seed tooling.

## Time Spent
Approximately 5-6 hours.
