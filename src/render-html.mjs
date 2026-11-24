// Server-side HTML renderer for Taskmarket Live Market Visualizer (TSK-BRK611AN, MIT).
// Renders live verifiable SSR KPIs + dynamic per-view Open Graph metadata + zero-tracker client shell.

export const VALID_VIEWS = ["overview", "flow", "trends", "insights", "heatmap", "posters", "feed"];

export const VIEW_DEFINITIONS = {
  overview: {
    slug: "overview",
    label: "Overview",
    title: "Taskmarket Live Market Visualizer",
    ogTitle: "Taskmarket Live Market — Measured Across Tempo & Base",
    description:
      "Live, read-only market observatory for Taskmarket across Tempo (4217 OUSD) and Base (8453 USDC): headline numbers, capital flow Sankey, trends, heatmaps, weekly posters, and live feed.",
  },
  flow: {
    slug: "flow",
    label: "Capital Flow",
    title: "Capital Flow & Swarm Convergence — Taskmarket Visualizer",
    ogTitle: "Taskmarket Capital Flow — Posters to Modes to Settlement",
    description:
      "Interactive Sankey flow from top posting wallets through task modes to paid payouts, active escrow, and expired tasks, paired with a swarm convergence scatter plot.",
  },
  trends: {
    slug: "trends",
    label: "Trends",
    title: "Market Over Time — Taskmarket Visualizer",
    ogTitle: "Taskmarket Over Time — Active Agents, Tasks & Payouts",
    description:
      "Daily and weekly active agents, task creation, rewards put up, and rewards paid across 7d, 30d, 90d, and all-time windows from api.taskmarket.dev.",
  },
  insights: {
    slug: "insights",
    label: "Insights",
    title: "Market Diagnostics & Insights — Taskmarket Visualizer",
    ogTitle: "Taskmarket Diagnostics — Concentration, Mortality & Claim Latency",
    description:
      "Non-obvious market findings from live Taskmarket data: demand Gini concentration, Tempo vs. Base mortality gap, claim latency, and 7-day momentum.",
  },
  heatmap: {
    slug: "heatmap",
    label: "Modes & Heatmap",
    title: "Modes, Statuses & Activity Heatmaps — Taskmarket Visualizer",
    ogTitle: "Taskmarket Activity Heatmaps — Hour-of-Week & Task Modes",
    description:
      "Task counts by mode and status alongside 7x24 UTC hour-of-week and mode-by-date activity heatmaps across 7d, 30d, 90d, and all-time ranges.",
  },
  posters: {
    slug: "posters",
    label: "Weekly Posters",
    title: "Weekly Distinct Task Posters — Taskmarket Visualizer",
    ogTitle: "Taskmarket Weekly Distinct Posters — Tempo & Base Demand Breadth",
    description:
      "Distinct task-posting wallets per ISO week computed deterministically from paginated /api/tasks across Tempo (4217) and Base (8453).",
  },
  feed: {
    slug: "feed",
    label: "Live Feed",
    title: "Live Activity Feed — Taskmarket Visualizer",
    ogTitle: "Taskmarket Live Activity Feed — Submissions, Claims & Payouts",
    description:
      "Filterable real-time Taskmarket platform activity feed alongside recent tasks across Tempo (4217 OUSD) and Base (8453 USDC).",
  },
};

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

function fmtUsdExact(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUtc(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return String(iso || "");
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function fmtDelta(pct) {
  if (pct == null || !Number.isFinite(pct)) return "n/a";
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

export function renderHtml(snapshot, opts = {}) {
  const view = VALID_VIEWS.includes(opts.view) ? opts.view : "overview";
  const def = VIEW_DEFINITIONS[view] || VIEW_DEFINITIONS.overview;
  const origin = String(opts.origin || "https://taskmarket-live.appwrite.network").replace(/\/+$/, "");
  const ogFile = opts.hasViewOg ? `${view}.png` : "default.png";
  const canonicalUrl = view === "overview" ? `${origin}/` : `${origin}/v/${view}`;
  const ogImageUrl = `${origin}/og/${ogFile}`;

  const plat = snapshot.headline?.platform || {};
  const tempo = snapshot.headline?.byChain?.["4217"] || {};
  const base = snapshot.headline?.byChain?.["8453"] || {};
  const allScope = snapshot.scopes?.all || {};
  const tempoScope = snapshot.scopes?.["4217"] || {};
  const baseScope = snapshot.scopes?.["8453"] || {};
  const mom = snapshot.momentum;
  const actorTypes = snapshot.breakdowns?.platform?.actorType || [];
  const agentRow = actorTypes.find((x) => x.actorType === "agent");
  const humanRow = actorTypes.find((x) => x.actorType === "human");
  const breakdownTaskTotal = (snapshot.breakdowns?.platform?.status || []).reduce((s, r) => s + Number(r.count || 0), 0);

  const safeJson = JSON.stringify(snapshot).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const asOfUtc = fmtUtc(snapshot.dataAsOf);

  const navLinks = VALID_VIEWS.map((slug) => {
    const d = VIEW_DEFINITIONS[slug];
    const href = slug === "overview" ? "/" : `/v/${slug}`;
    const cls = slug === view ? "view-tab active" : "view-tab";
    return `<a class="${cls}" href="${href}" data-view-tab="${slug}" aria-current="${slug === view ? "page" : "false"}">${esc(d.label)}</a>`;
  }).join("");

  const endpointsHtml = (snapshot.endpointsUsed || [])
    .map((ep) => `<li>GET ${esc(snapshot.apiBase)}${esc(ep)}</li>`)
    .join("");

  const secClass = (slug) => (view === "overview" || view === slug ? "section" : "section hidden-view");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(def.title)}</title>
  <meta name="description" content="${esc(def.description)}" />
  <link rel="canonical" href="${esc(canonicalUrl)}" />
  <meta name="theme-color" content="#12100E" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Taskmarket Live Market Visualizer" />
  <meta property="og:url" content="${esc(canonicalUrl)}" />
  <meta property="og:title" content="${esc(def.ogTitle)}" />
  <meta property="og:description" content="${esc(def.description)}" />
  <meta property="og:image" content="${esc(ogImageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(def.ogTitle)}" />
  <meta name="twitter:description" content="${esc(def.description)}" />
  <meta name="twitter:image" content="${esc(ogImageUrl)}" />

  <link rel="icon" type="image/png" href="/assets/brand/taskmarket-mark.png" />
  <link rel="preload" href="/assets/fonts/DepartureMono-Regular.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/assets/fonts/InstrumentSerif-Regular.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="preload" href="/assets/fonts/InstrumentSerif-Italic.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="stylesheet" href="/assets/styles.css" />
</head>
<body data-initial-view="${esc(view)}">
  <div class="shell">
    <header class="topbar">
      <a class="brand-lockup" href="/" aria-label="Taskmarket Live Market Visualizer home">
        <img src="/assets/brand/taskmarket-lockup.png" alt="Taskmarket" width="144" height="28" />
        <span class="brand-tag">taskmarket.dev · live market</span>
      </a>
      <div class="topbar-meta">
        <span class="asof-pill" title="Exact UTC timestamp of server-side snapshot">
          <span class="live-dot" aria-hidden="true"></span>
          <span id="dataAsOfDisplay">Data as of ${esc(asOfUtc)}</span>
        </span>
        <button id="copyViewLinkBtn" type="button" class="btn-salmon">Copy View Link</button>
        <button id="refreshDataBtn" type="button" class="btn-ghost">Refresh</button>
        <a class="btn-ghost" href="/api/snapshot" target="_blank" rel="noopener">Raw JSON</a>
      </div>
    </header>

    <section class="hero">
      <div>
        <p class="eyebrow">READ-ONLY MARKET OBSERVATORY · TEMPO 4217 (OUSD) &amp; BASE 8453 (USDC)</p>
        <h1>The live market, <span class="accent-italic">measured</span>.</h1>
        <p class="hero-sub">
          Every figure below is fetched server-side from <span class="mono paper">api.taskmarket.dev</span>,
          cached with a ${esc(snapshot.cacheTtlSeconds)}s TTL, and traceable to exact upstream endpoints without wallet login or tracking.
        </p>
      </div>
      <aside class="hero-aside" aria-label="7-day platform momentum summary">
        <p class="hero-aside-title">7-DAY COMPLETED UTC WEEK VS. PRIOR WEEK</p>
        <div class="hero-aside-grid">
          <div>
            <span class="aside-stat-label">Tasks Created</span>
            <span class="aside-stat-val">${mom ? fmtInt(mom.tasksCreated.current) : "--"}</span>
            <span class="aside-stat-delta">${mom ? fmtDelta(mom.tasksCreated.deltaPct) + " vs " + fmtInt(mom.tasksCreated.prior) : "--"}</span>
          </div>
          <div>
            <span class="aside-stat-label">Rewards Put Up</span>
            <span class="aside-stat-val">${mom ? fmtUsdExact(mom.rewardUsd.current) : "--"}</span>
            <span class="aside-stat-delta">${mom ? fmtDelta(mom.rewardUsd.deltaPct) + " vs " + fmtUsdExact(mom.rewardUsd.prior) : "--"}</span>
          </div>
          <div>
            <span class="aside-stat-label">Rewards Paid</span>
            <span class="aside-stat-val">${mom ? fmtUsdExact(mom.paidUsd.current) : "--"}</span>
            <span class="aside-stat-delta">${mom ? fmtDelta(mom.paidUsd.deltaPct) + " vs " + fmtUsdExact(mom.paidUsd.prior) : "--"}</span>
          </div>
          <div>
            <span class="aside-stat-label">Avg Daily Active Agents</span>
            <span class="aside-stat-val">${mom ? fmtInt(mom.avgDailyActiveAgents.current) : "--"}</span>
            <span class="aside-stat-delta">${mom ? fmtDelta(mom.avgDailyActiveAgents.deltaPct) + " vs " + fmtInt(mom.avgDailyActiveAgents.prior) : "--"}</span>
          </div>
        </div>
      </aside>
    </section>

    <nav class="controls-bar" aria-label="Visualizer views and filters">
      <div class="controls-inner">
        <div class="view-tabs" role="tablist">${navLinks}</div>
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Chain</span>
            <div class="seg-group" role="group" aria-label="Chain filter">
              <button type="button" class="seg-btn active" data-chain-btn="all">All Chains</button>
              <button type="button" class="seg-btn" data-chain-btn="4217">Tempo 4217 · OUSD</button>
              <button type="button" class="seg-btn" data-chain-btn="8453">Base 8453 · USDC</button>
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">Range</span>
            <div class="seg-group" role="group" aria-label="Date range">
              <button type="button" class="seg-btn" data-range-btn="7d">7d</button>
              <button type="button" class="seg-btn active" data-range-btn="30d">30d</button>
              <button type="button" class="seg-btn" data-range-btn="90d">90d</button>
              <button type="button" class="seg-btn" data-range-btn="all">All</button>
            </div>
            <span class="filter-label" style="margin-left:6px;">Bucket</span>
            <div class="seg-group" role="group" aria-label="Time bucket">
              <button type="button" class="seg-btn active" data-bucket-btn="day">Day</button>
              <button type="button" class="seg-btn" data-bucket-btn="week">Week</button>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <main>
      <!-- SECTION 1: HEADLINE NUMBERS & BOTH CHAINS (always visible on overview) -->
      <section class="${secClass("overview")}" data-section="overview">
        <div class="section-head">
          <div>
            <h2 class="section-title">Headline Market Numbers</h2>
            <p class="section-note">
              Platform-wide totals verbatim from <span class="mono">/api/market/stats</span> (never summed across chains), paired with chain-scoped figures for Tempo (OUSD) and Base (USDC).
            </p>
          </div>
          <span class="source-badge">/api/market/stats · /api/tasks</span>
        </div>

        <div class="grid-4" style="margin-bottom:16px;">
          <div class="kpi-card">
            <span class="kpi-label">Registered Workers</span>
            <span class="kpi-val">${fmtInt(plat.registeredWorkers)}</span>
            <span class="kpi-sub">${fmtInt(agentRow?.count || 0)} agents · ${fmtInt(humanRow?.count || 0)} humans</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Active Workers (7d)</span>
            <span class="kpi-val">${fmtInt(plat.activeWorkers7d)}</span>
            <span class="kpi-sub">${fmtInt(plat.activeAgents7d)} active agents in last 7 days</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Open Active Tasks</span>
            <span class="kpi-val">${fmtInt(plat.openTasks)}</span>
            <span class="kpi-sub">Active open count from /api/market/stats</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Indexed Volume (4217 + 8453)</span>
            <span class="kpi-val">${fmtUsdExact(allScope.totalVolumeUsd)}</span>
            <span class="kpi-sub">${fmtUsdExact(allScope.paidVolumeUsd)} paid · ${fmtUsdExact(allScope.escrowVolumeUsd)} escrow</span>
          </div>
        </div>

        <div class="grid-2">
          <article class="chain-card">
            <div class="chain-head">
              <h3 class="chain-name">Tempo</h3>
              <span class="chain-pill">chainId 4217 · OUSD (6 dec)</span>
            </div>
            <div class="chain-metrics">
              <div>
                <span class="cm-label">Paid Workers</span>
                <span class="cm-val">${fmtInt(tempo.paidWorkers)}</span>
                <span class="cm-sub">from /api/market/stats</span>
              </div>
              <div>
                <span class="cm-label">Active Wallets</span>
                <span class="cm-val">${fmtInt(tempo.activeWallets)}</span>
                <span class="cm-sub">from /api/market/stats</span>
              </div>
              <div>
                <span class="cm-label">Indexed Tasks</span>
                <span class="cm-val">${fmtInt(tempo.totalTasks)}</span>
                <span class="cm-sub">${fmtInt(tempo.uniquePosters)} distinct posters</span>
              </div>
              <div>
                <span class="cm-label">Total Put Up</span>
                <span class="cm-val">${fmtUsdExact(tempo.totalVolumeUsd)}</span>
                <span class="cm-sub">OUSD across all tasks</span>
              </div>
              <div>
                <span class="cm-label">Paid / Active Escrow</span>
                <span class="cm-val">${fmtUsdExact(tempo.paidVolumeUsd)}</span>
                <span class="cm-sub">${fmtUsdExact(tempo.escrowVolumeUsd)} in active escrow</span>
              </div>
              <div>
                <span class="cm-label">Completion / Mortality</span>
                <span class="cm-val">${(tempoScope.insights?.completionRatePct ?? 0).toFixed(1)}%</span>
                <span class="cm-sub">${(tempoScope.insights?.deadPct ?? 0).toFixed(1)}% expired or cancelled</span>
              </div>
            </div>
          </article>

          <article class="chain-card">
            <div class="chain-head">
              <h3 class="chain-name">Base</h3>
              <span class="chain-pill">chainId 8453 · USDC (6 dec)</span>
            </div>
            <div class="chain-metrics">
              <div>
                <span class="cm-label">Paid Workers</span>
                <span class="cm-val">${fmtInt(base.paidWorkers)}</span>
                <span class="cm-sub">from /api/market/stats</span>
              </div>
              <div>
                <span class="cm-label">Active Wallets</span>
                <span class="cm-val">${fmtInt(base.activeWallets)}</span>
                <span class="cm-sub">from /api/market/stats</span>
              </div>
              <div>
                <span class="cm-label">Indexed Tasks</span>
                <span class="cm-val">${fmtInt(base.totalTasks)}</span>
                <span class="cm-sub">${fmtInt(base.uniquePosters)} distinct posters</span>
              </div>
              <div>
                <span class="cm-label">Total Put Up</span>
                <span class="cm-val">${fmtUsdExact(base.totalVolumeUsd)}</span>
                <span class="cm-sub">USDC across all tasks</span>
              </div>
              <div>
                <span class="cm-label">Paid / Active Escrow</span>
                <span class="cm-val">${fmtUsdExact(base.paidVolumeUsd)}</span>
                <span class="cm-sub">${fmtUsdExact(base.escrowVolumeUsd)} in active escrow</span>
              </div>
              <div>
                <span class="cm-label">Completion / Mortality</span>
                <span class="cm-val">${(baseScope.insights?.completionRatePct ?? 0).toFixed(1)}%</span>
                <span class="cm-sub">${(baseScope.insights?.deadPct ?? 0).toFixed(1)}% expired or cancelled</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- SECTION 2: CAPITAL FLOW SANKEY & SWARM CONVERGENCE RADAR -->
      <section class="${secClass("flow")}" data-section="flow">
        <div class="section-head">
          <div>
            <h2 class="section-title">Capital Flow &amp; Swarm Convergence</h2>
            <p class="section-note">
              Traces every dollar from top posting wallets (truncated addresses only) through task modes into paid payouts, live active escrow, or expired and cancelled reclaimed escrow. Hover any stream or node to inspect exact totals.
            </p>
          </div>
          <span class="source-badge" id="sankeySourceBadge">/api/tasks</span>
        </div>

        <div class="panel" style="margin-bottom:16px;">
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-swatch" style="background:#D9A097;"></span>Paid to winners</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#E74079;"></span>Held in active escrow</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#6E655D;"></span>Expired or cancelled</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#EFE9E2;opacity:0.45;"></span>Poster to mode allocation</span>
          </div>
          <div class="chart-scroll">
            <div class="chart-box" id="sankeyChart" style="min-width:680px;"></div>
          </div>
        </div>

        <div class="panel">
          <div class="section-head" style="margin-bottom:10px;">
            <div>
              <h3 class="serif paper" style="font-size:24px;margin:0;">Swarm Convergence Radar</h3>
              <p class="section-note">
                Reward size (log scale) versus worker submission volume across the highest-activity and highest-value tasks. Select any point to inspect the underlying task.
              </p>
            </div>
            <div class="chart-legend" style="margin:0;">
              <span class="legend-item"><span class="legend-swatch" style="background:#E74079;border-radius:50%;"></span>Open</span>
              <span class="legend-item"><span class="legend-swatch" style="background:#D9A097;border-radius:50%;"></span>Completed</span>
              <span class="legend-item"><span class="legend-swatch" style="background:#6E655D;border-radius:50%;"></span>Expired / Cancelled</span>
            </div>
          </div>
          <div class="chart-box" id="swarmRadarChart"></div>
          <div class="inspector-box" id="swarmInspector"></div>
        </div>
      </section>

      <!-- SECTION 3: MARKET OVER TIME -->
      <section class="${secClass("trends")}" data-section="trends">
        <div class="section-head">
          <div>
            <h2 class="section-title">Market Over Time</h2>
            <p class="section-note">
              Daily or weekly active agents, tasks posted, and rewards put up versus paid out. Use the range (7d, 30d, 90d, All) and bucket (Day, Week) controls above.
            </p>
          </div>
          <span class="source-badge" id="trendsSourceBadge">/api/stats/platform-time-series</span>
        </div>

        <div class="panel" style="margin-bottom:14px;">
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-swatch" style="background:#E74079;"></span>Active agents</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#EFE9E2;"></span>New agents (dashed)</span>
          </div>
          <div class="chart-box" id="trendsAgentsChart"></div>
        </div>

        <div class="grid-2" style="margin-bottom:14px;">
          <div class="panel">
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-swatch" style="background:#EFE9E2;opacity:0.45;"></span>Tasks created (bars)</span>
              <span class="legend-item"><span class="legend-swatch" style="background:#D9A097;"></span>Completed tasks (line)</span>
            </div>
            <div class="chart-box" id="trendsTasksChart"></div>
          </div>
          <div class="panel">
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-swatch" style="background:#EFE9E2;opacity:0.45;"></span>Rewards put up USD (bars)</span>
              <span class="legend-item"><span class="legend-swatch" style="background:#D9A097;"></span>Rewards paid USD (line)</span>
            </div>
            <div class="chart-box" id="trendsVolumeChart"></div>
          </div>
        </div>

        <div class="panel" id="chainTrendsWrap" style="display:none;">
          <p class="eyebrow" id="chainTrendsTitle" style="margin-bottom:10px;">CHAIN-SCOPED DAILY VOLUME</p>
          <div class="chart-box" id="chainTrendsChart"></div>
        </div>
      </section>

      <!-- SECTION 4: NON-OBVIOUS INSIGHTS -->
      <section class="${secClass("insights")}" data-section="insights">
        <div class="section-head">
          <div>
            <h2 class="section-title">Market Diagnostics &amp; Insights</h2>
            <p class="section-note">
              Structural patterns computed directly from paginated task records and platform time-series — never extrapolated or invented.
            </p>
          </div>
          <span class="source-badge">Derived from /api/tasks + /api/stats/platform-time-series</span>
        </div>

        <div class="grid-2" id="insightsCards" style="margin-bottom:16px;"></div>

        <div class="panel">
          <div class="section-head" style="margin-bottom:10px;">
            <div>
              <h3 class="serif paper" style="font-size:24px;margin:0;">Top Posting Wallets by Volume</h3>
              <p class="section-note">
                Truncated on-chain requester addresses only. No names or off-chain identities are guessed or attached.
              </p>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Requester Wallet</th>
                  <th class="num">Tasks</th>
                  <th class="num">Volume Put Up</th>
                  <th class="num">Share</th>
                  <th class="num">Completed</th>
                  <th class="num">Expired / Cancelled</th>
                </tr>
              </thead>
              <tbody id="topPostersBody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- SECTION 5: MODES, STATUSES & DUAL ACTIVITY HEATMAPS -->
      <section class="${secClass("heatmap")}" data-section="heatmap">
        <div class="section-head">
          <div>
            <h2 class="section-title">Modes, Statuses &amp; Activity Heatmaps</h2>
            <p class="section-note">
              Exact task counts by mode and lifecycle status, followed by UTC hour-of-week and mode-by-date intensity heatmaps.
            </p>
          </div>
          <span class="source-badge" id="breakdownSourceBadge">/api/stats/breakdowns</span>
        </div>

        <div class="grid-2" style="margin-bottom:16px;">
          <div class="panel">
            <p class="eyebrow">TASKS BY MODE</p>
            <div id="modesBars"></div>
          </div>
          <div class="panel">
            <p class="eyebrow">TASKS BY STATUS</p>
            <div id="statusBars"></div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:16px;">
          <div class="section-head" style="margin-bottom:10px;">
            <div>
              <h3 class="serif paper" style="font-size:24px;margin:0;">Activity by Hour of Week (UTC)</h3>
              <p class="section-note">Day of week (rows) versus 00:00–23:00 UTC (columns). Hover any cell for exact event volume.</p>
            </div>
            <span class="source-badge" id="heatmapSourceBadge">/api/stats/activity-heatmap</span>
          </div>
          <div class="chart-scroll">
            <div class="chart-box" id="heatmapHourChart" style="min-width:620px;"></div>
          </div>
        </div>

        <div class="panel">
          <div class="section-head" style="margin-bottom:10px;">
            <div>
              <h3 class="serif paper" style="font-size:24px;margin:0;">Activity by Mode &amp; Date</h3>
              <p class="section-note">Task modes across daily UTC buckets for the active range (up to latest 45 days on All).</p>
            </div>
          </div>
          <div class="chart-scroll">
            <div class="chart-box" id="heatmapModeChart" style="min-width:580px;"></div>
          </div>
        </div>
      </section>

      <!-- SECTION 6: WEEKLY DISTINCT TASK POSTERS -->
      <section class="${secClass("posters")}" data-section="posters">
        <div class="section-head">
          <div>
            <h2 class="section-title">Distinct Task Posters per Week</h2>
            <p class="section-note">
              Unique requester wallets posting at least one task per ISO week (bars) overlaid with weekly task volume (cream line), computed by paginating <span class="mono">/api/tasks</span>.
            </p>
          </div>
          <span class="source-badge" id="postersSourceBadge">Computed from /api/tasks</span>
        </div>

        <div class="panel" style="margin-bottom:16px;">
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-swatch" style="background:#D9A097;"></span>Distinct posting wallets (left axis)</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#E74079;"></span>Peak week</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#EFE9E2;"></span>Tasks posted (right axis)</span>
          </div>
          <div class="chart-box" id="weeklyPostersChart"></div>
        </div>

        <div class="panel">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ISO Week</th>
                  <th>Week Start (UTC)</th>
                  <th class="num">Distinct Posters</th>
                  <th class="num">Tasks Posted</th>
                  <th class="num">Tasks / Poster</th>
                  <th class="num">Rewards Put Up</th>
                  <th class="num">Paid Out</th>
                </tr>
              </thead>
              <tbody id="weeklyPostersBody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- SECTION 7: LIVE ACTIVITY FEED -->
      <section class="${secClass("feed")}" data-section="feed">
        <div class="section-head">
          <div>
            <h2 class="section-title">Live Activity Feed</h2>
            <p class="section-note">
              Most recent platform events from <span class="mono">/api/stats/activity-feed</span> paired with the newest chain-filtered tasks from <span class="mono">/api/tasks</span>.
            </p>
          </div>
          <span class="source-badge">/api/stats/activity-feed · /api/tasks</span>
        </div>

        <div class="panel" style="margin-bottom:16px;">
          <div class="feed-controls">
            <span class="mono muted" id="feedFilterNote" style="font-size:11px;">Latest platform events</span>
            <div class="seg-group" role="group" aria-label="Event type filter">
              <button type="button" class="seg-btn active" data-feed-type="all">All</button>
              <button type="button" class="seg-btn" data-feed-type="submitted">Submitted</button>
              <button type="button" class="seg-btn" data-feed-type="paid">Settled</button>
              <button type="button" class="seg-btn" data-feed-type="created">Created</button>
              <button type="button" class="seg-btn" data-feed-type="claimed">Claimed</button>
            </div>
          </div>
          <div class="feed-list" id="feedList"></div>
        </div>

        <div class="panel">
          <p class="eyebrow" style="margin-bottom:10px;">RECENT INDEXED TASKS (CHAIN-FILTERED VIA /API/TASKS)</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Chain</th>
                  <th>Task</th>
                  <th>Mode / Status</th>
                  <th>Poster</th>
                  <th class="num">Reward</th>
                  <th class="num">Subs</th>
                </tr>
              </thead>
              <tbody id="recentChainTasksBody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </main>

    <!-- METHODS, REPRODUCIBILITY & MANDATORY DISCLAIMER FOOTER -->
    <footer class="methods-panel" id="methods">
      <div class="section-head" style="margin-bottom:6px;">
        <div>
          <h2 class="section-title" style="font-size:28px;">Methods &amp; Data Reproducibility</h2>
          <p class="section-note">
            Snapshot captured server-side at <span class="mono paper">${esc(snapshot.dataAsOf)}</span> (${esc(snapshot.fetchedMs)} ms upstream fetch, ${esc(snapshot.cacheTtlSeconds)}s cache TTL, max staleness under 1 hour).
          </p>
        </div>
        <a class="btn-ghost" href="/api/snapshot" target="_blank" rel="noopener">Inspect Verifiable JSON</a>
      </div>

      <div class="methods-grid">
        <div>
          <p class="eyebrow" style="margin-bottom:8px;">UPSTREAM ENDPOINTS FETCHED SERVER-SIDE</p>
          <ul class="methods-list">${endpointsHtml}</ul>
        </div>
        <div class="methods-prose">
          <p class="eyebrow" style="margin-bottom:8px;">RECONCILIATION NOTES</p>
          <p>
            <strong>Token precision:</strong> Both Tempo (<span class="mono">chainId=4217</span>, OUSD) and Base (<span class="mono">chainId=8453</span>, USDC) report reward amounts in 6-decimal atomic integers (<span class="mono">1000000 = $1.00</span>).
          </p>
          <p>
            <strong>Platform-wide vs. chain-scoped fields:</strong> On <span class="mono">/api/market/stats</span>, only <span class="mono">paidWorkers</span> and <span class="mono">activeWallets</span> vary by <span class="mono">chainId</span>. <span class="mono">registeredWorkers</span>, <span class="mono">activeWorkers7d</span>, <span class="mono">activeAgents7d</span>, <span class="mono">openTasks</span>, <span class="mono">/api/stats/breakdowns</span>, <span class="mono">/api/stats/platform-time-series</span>, <span class="mono">/api/stats/activity-heatmap</span>, and <span class="mono">/api/stats/activity-feed</span> report platform-wide figures and are never summed across chains.
          </p>
          <p>
            <strong>Count reconciliation:</strong> <span class="mono">/api/stats/breakdowns</span> reports ${fmtInt(breakdownTaskTotal)} total platform tasks, while paginating active <span class="mono">/api/tasks</span> for Tempo (${fmtInt(tempo.totalTasks)}) and Base (${fmtInt(base.totalTasks)}) lists ${fmtInt(allScope.totalTasks)} indexed tasks. Similarly, <span class="mono">openTasks</span> (${fmtInt(plat.openTasks)}) reflects currently active open tasks on <span class="mono">/api/market/stats</span>, whereas raw <span class="mono">status=open</span> rows in <span class="mono">/api/tasks</span> include tasks awaiting expiry transition.
          </p>
          <p>
            <strong>Weekly distinct posters:</strong> Computed deterministically from paginated <span class="mono">/api/tasks?chainId=4217</span> and <span class="mono">8453</span> by grouping lowercase <span class="mono">requester</span> addresses into ISO-8601 UTC weeks.
          </p>
          <p>
            <strong>Privacy &amp; read-only guarantee:</strong> No wallet connection, no browser calls to <span class="mono">api.taskmarket.dev</span>, no cookies, no analytics or tracking scripts, and no guessed names attached to wallet addresses.
          </p>
        </div>
      </div>

      <div class="footer-disclaimer">
        <div>
          <strong>Disclaimer:</strong> Built for a paid Taskmarket bounty (<span class="mono">TSK-BRK611AN</span>). Independent, open-source (MIT), read-only community visualizer — not an official Taskmarket product.
        </div>
        <div class="mono" style="font-size:11px;">
          <a href="https://github.com/zColdWater/taskmarket-live-visualizer" target="_blank" rel="noopener">MIT Source</a>
          &nbsp;·&nbsp;
          <a href="https://taskmarket.dev" target="_blank" rel="noopener">taskmarket.dev</a>
          &nbsp;·&nbsp;
          <a href="/api/health" target="_blank" rel="noopener">/api/health</a>
        </div>
      </div>
    </footer>
  </div>

  <div class="tm-tooltip" id="tmTooltip" role="status" aria-live="polite"></div>
  <script id="tm-snapshot" type="application/json">${safeJson}</script>
  <script src="/assets/app.js" defer></script>
</body>
</html>`;
}
