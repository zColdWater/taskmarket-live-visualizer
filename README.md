# Taskmarket Live Market Visualizer

A live, read-only, zero-dependency market observatory for [Taskmarket](https://taskmarket.dev) covering both **Tempo (`chainId=4217`, OUSD)** and **Base (`chainId=8453`, USDC)**.

- **Live deployment:** https://taskmarket-live.appwrite.network
- **Verifiable JSON snapshot:** https://taskmarket-live.appwrite.network/api/snapshot

Built for paid Taskmarket bounty `TSK-BRK611AN`. This project is open-source under the MIT license and is not an official Taskmarket product.

## Features

- **Server-side API fetching & caching:** All requests to `https://api.taskmarket.dev` run server-side in Node 22 with a configurable TTL (`CACHE_TTL_MS`, default `300s`, minimum `60s`), stale-while-revalidate refresh, and max staleness under 1 hour. Zero browser CORS requests hit `api.taskmarket.dev` (enforced via `Content-Security-Policy: connect-src 'self'`).
- **Complete market views:**
  - **Headline Numbers & Dual-Chain Comparison** (`/`) — Platform totals verbatim from `/api/market/stats` paired with side-by-side Tempo (`4217`, OUSD) and Base (`8453`, USDC) metrics.
  - **Capital Flow Sankey & Swarm Convergence Radar** (`/v/flow`) — Traces USD flow from top posting wallets (truncated addresses only) through task modes to paid payouts, active escrow, and expired/cancelled tasks, alongside a reward-vs-submissions scatter plot with an interactive task inspector.
  - **Market Over Time** (`/v/trends`) — Active agents, new agents, tasks posted/completed, and rewards put up vs. paid out with `7d | 30d | 90d | all` and `day | week` switches.
  - **Market Diagnostics & Insights** (`/v/insights`) — Demand Gini concentration, top posting wallets table, Tempo vs. Base mortality gap, median claim latency, and 7-day completed-week momentum.
  - **Modes, Statuses & Activity Heatmaps** (`/v/heatmap`) — Task breakdowns by mode and status plus interactive 7x24 UTC `hourOfWeek` and `mode` heatmaps.
  - **Distinct Task Posters per Week** (`/v/posters`) — Unique requester wallets per ISO-8601 week computed deterministically from paginated `/api/tasks`.
  - **Live Activity Feed** (`/v/feed`) — Real-time event stream filterable by event type and chain, plus recent chain-filtered tasks.
- **Shareable deep links & per-view Open Graph cards:** Every view exposes a canonical `/v/<view>` route with view-specific OG title, description, and `1200x630` preview image.
- **Strict privacy & read-only design:** No wallet connection, no cookies, no analytics or personal tracking, and no guessed identities attached to wallet addresses.

## Upstream Endpoints Used

All upstream fetches target `https://api.taskmarket.dev`:

- `GET /api/market/stats?chainId=4217` and `?chainId=8453`
- `GET /api/stats/breakdowns?chainId=4217` and `?chainId=8453`
- `GET /api/stats/platform-time-series?chainId=4217&range=7d|30d|90d|all&bucket=day|week`
- `GET /api/stats/activity-heatmap?chainId=4217&range=7d|30d|90d|all&dimension=hourOfWeek|mode`
- `GET /api/stats/activity-feed?chainId=4217&limit=50`
- `GET /api/tasks?chainId=4217&sort=newest&limit=100&cursor=...` (paginated to completion)
- `GET /api/tasks?chainId=8453&sort=newest&limit=100&cursor=...` (paginated to completion)

### Data Reconciliation Notes

- Both OUSD (Tempo `4217`) and USDC (Base `8453`) use 6 decimal places (`1000000 = $1.00`).
- On `/api/market/stats`, only `paidWorkers` and `activeWallets` vary by `chainId`. Platform totals (`registeredWorkers`, `activeWorkers7d`, `activeAgents7d`, `openTasks`), `/api/stats/breakdowns`, `/api/stats/platform-time-series`, `/api/stats/activity-heatmap`, and `/api/stats/activity-feed` are platform-wide and are never summed across chains.
- Inspect the live cached snapshot directly at `/api/snapshot` (header `X-Data-As-Of` reports exact UTC capture time).

## One-Command Local Run & Deploy

Requires Node.js 22+ (zero `npm install` dependencies required).

### Run Locally

```bash
npm start
```

Open `http://localhost:3000`. Run the live reproducibility & contract verification suite:

```bash
npm test
```

### One-Command Docker Deploy

```bash
docker build -t taskmarket-live-visualizer . && docker run -d --name taskmarket-live -p 3000:3000 taskmarket-live-visualizer
```

### Environment Variables (All Optional)

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `3000` | Listen port |
| `PUBLIC_ORIGIN` | Request host | Canonical origin used in Open Graph tags |
| `TASKMARKET_API_BASE` | `https://api.taskmarket.dev` | Upstream API base URL |
| `CACHE_TTL_MS` | `300000` | Server cache TTL in ms (minimum `60000`) |
| `MAX_STALE_MS` | `3300000` | Max stale-while-revalidate window in ms (`< 1h`) |
| `SNAPSHOT_FILE` | `/tmp/taskmarket-live-snapshot.json` | Optional local snapshot persistence path |
| `SNAPSHOT_LOAD_URL` | `""` | Optional cold-start JSON snapshot fallback URL |

## License

Code is licensed under the [MIT License](./LICENSE). Bundled brand fonts (`Instrument Serif`, `Inter Tight`, `Departure Mono`) retain their respective SIL Open Font License 1.1 terms in `public/fonts/`. Taskmarket brand marks remain the property of Taskmarket and are used unmodified in accordance with the published brand guidelines.
