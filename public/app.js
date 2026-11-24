/* Taskmarket Live Market Visualizer — Zero-Dependency Interactive SVG Client (MIT)
 * Strictly read-only. Zero browser calls to api.taskmarket.dev.
 * Zero cookies, zero personal tracking, zero wallet connect, zero guessed wallet names.
 */

(function () {
  "use strict";

  const VALID_VIEWS = ["overview", "flow", "trends", "insights", "heatmap", "posters", "feed"];
  const VALID_CHAINS = ["all", "4217", "8453"];
  const VALID_RANGES = ["7d", "30d", "90d", "all"];
  const VALID_BUCKETS = ["day", "week"];

  const VIEW_META = {
    overview: {
      title: "Taskmarket Live Market Visualizer",
      eyebrow: "LIVE MARKET OBSERVATORY · TEMPO 4217 (OUSD) & BASE 8453 (USDC)",
    },
    flow: {
      title: "Capital Flow & Swarm Convergence — Taskmarket Visualizer",
      eyebrow: "CAPITAL FLOW SANKEY & SWARM CONVERGENCE RADAR",
    },
    trends: {
      title: "Market Trends Over Time — Taskmarket Visualizer",
      eyebrow: "ACTIVE AGENTS, TASK CREATION & REWARD SETTLEMENT OVER TIME",
    },
    insights: {
      title: "Market Diagnostics & Insights — Taskmarket Visualizer",
      eyebrow: "DEMAND CONCENTRATION, MORTALITY & LATENCY DIAGNOSTICS",
    },
    heatmap: {
      title: "Modes, Statuses & Activity Heatmaps — Taskmarket Visualizer",
      eyebrow: "TASK BREAKDOWNS, HOUR-OF-WEEK & MODE HEATMAPS",
    },
    posters: {
      title: "Weekly Distinct Task Posters — Taskmarket Visualizer",
      eyebrow: "DISTINCT DEMAND WALLETS PER ISO WEEK FROM /API/TASKS",
    },
    feed: {
      title: "Live Activity Feed — Taskmarket Visualizer",
      eyebrow: "REAL-TIME PLATFORM EVENTS & RECENT CHAIN TASKS",
    },
  };

  let snapshot = null;
  const state = {
    view: "overview",
    chain: "all",
    range: "30d",
    bucket: "day",
    feedType: "all",
    selectedTaskRef: null,
  };

  // --- Formatting helpers ---
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

  function fmtUsd(n, decimals) {
    const v = Number(n) || 0;
    const d = decimals != null ? decimals : v >= 1000 ? 0 : 2;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtUsdExact(n) {
    const v = Number(n) || 0;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "n/a";
    return v.toFixed(1) + "%";
  }

  function fmtDelta(pct) {
    if (pct == null || !Number.isFinite(pct)) return "n/a";
    const sign = pct > 0 ? "+" : "";
    return sign + pct.toFixed(1) + "%";
  }

  function fmtUtcShort(iso) {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }

  function fmtRelTime(iso, refIso) {
    const t = Date.parse(iso || "");
    const ref = Date.parse(refIso || "") || Date.now();
    if (!Number.isFinite(t)) return "--";
    const diffSec = Math.max(0, Math.round((ref - t) / 1000));
    if (diffSec < 60) return diffSec + "s ago";
    if (diffSec < 3600) return Math.floor(diffSec / 60) + "m ago";
    if (diffSec < 86400) return Math.floor(diffSec / 3600) + "h ago";
    return Math.floor(diffSec / 86400) + "d ago";
  }

  function chainLabel(chainId) {
    return Number(chainId) === 8453 ? "Base 8453 (USDC)" : "Tempo 4217 (OUSD)";
  }

  function chainShort(chainId) {
    return Number(chainId) === 8453 ? "Base · USDC" : "Tempo · OUSD";
  }

  function tokenForScope(chainKey) {
    if (chainKey === "4217") return "OUSD";
    if (chainKey === "8453") return "USDC";
    return "USD eq.";
  }

  function currentScope() {
    if (!snapshot || !snapshot.scopes) return null;
    return snapshot.scopes[state.chain] || snapshot.scopes.all;
  }

  // --- Tooltip ---
  let tooltipEl = null;

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.getElementById("tmTooltip");
    }
    return tooltipEl;
  }

  function showTooltip(evt, head, rows) {
    const el = ensureTooltip();
    if (!el) return;
    let html = '<div class="tm-tooltip-head">' + esc(head) + "</div>";
    for (let i = 0; i < rows.length; i++) {
      html +=
        '<div class="tm-tooltip-row"><span>' +
        esc(rows[i][0]) +
        "</span><strong>" +
        esc(rows[i][1]) +
        "</strong></div>";
    }
    el.innerHTML = html;
    el.classList.add("visible");
    moveTooltip(evt);
  }

  function moveTooltip(evt) {
    const el = ensureTooltip();
    if (!el || !evt) return;
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    let x = (evt.clientX || 0) + 16;
    let y = (evt.clientY || 0) - 12;
    if (x + rect.width + pad > vw) x = Math.max(pad, (evt.clientX || 0) - rect.width - 14);
    if (y + rect.height + pad > vh) y = Math.max(pad, vh - rect.height - pad);
    if (y < pad) y = pad;
    el.style.left = x + "px";
    el.style.top = y + "px";
  }

  function hideTooltip() {
    const el = ensureTooltip();
    if (el) el.classList.remove("visible");
  }

  // --- URL & State Sync ---
  function readInitialState() {
    const body = document.body;
    const initView = body?.dataset?.initialView || "overview";
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view") || initView;
    const c = params.get("chain") || "all";
    const r = params.get("range") || "30d";
    const b = params.get("bucket") || "day";
    state.view = VALID_VIEWS.includes(v) ? v : "overview";
    state.chain = VALID_CHAINS.includes(c) ? c : "all";
    state.range = VALID_RANGES.includes(r) ? r : "30d";
    state.bucket = VALID_BUCKETS.includes(b) ? b : "day";
  }

  function buildShareUrl() {
    const origin = window.location.origin;
    const path = state.view === "overview" ? "/" : "/v/" + state.view;
    const params = new URLSearchParams();
    if (state.chain !== "all") params.set("chain", state.chain);
    if (state.range !== "30d") params.set("range", state.range);
    if (state.bucket !== "day") params.set("bucket", state.bucket);
    const qs = params.toString();
    return origin + path + (qs ? "?" + qs : "");
  }

  function syncUrl() {
    try {
      const url = buildShareUrl();
      window.history.replaceState(null, "", url);
      const meta = VIEW_META[state.view] || VIEW_META.overview;
      document.title = meta.title;
    } catch (_) {}
  }

  function applyVisibility() {
    const sections = document.querySelectorAll("[data-section]");
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const key = sec.getAttribute("data-section");
      const show = state.view === "overview" || state.view === key;
      sec.classList.toggle("hidden-view", !show);
    }

    const tabs = document.querySelectorAll("[data-view-tab]");
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const active = t.getAttribute("data-view-tab") === state.view;
      t.classList.toggle("active", active);
      t.setAttribute("aria-current", active ? "page" : "false");
    }

    document.querySelectorAll("[data-chain-btn]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-chain-btn") === state.chain);
    });
    document.querySelectorAll("[data-range-btn]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-range-btn") === state.range);
    });
    document.querySelectorAll("[data-bucket-btn]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-bucket-btn") === state.bucket);
    });
  }

  // --- SVG Chart 1: 3-Column Capital Flow Sankey ---
  function renderSankey() {
    const container = document.getElementById("sankeyChart");
    const badge = document.getElementById("sankeySourceBadge");
    if (!container || !snapshot) return;
    const scope = currentScope();
    if (!scope || !scope.capitalFlow) return;

    const cf = scope.capitalFlow;
    const unit = tokenForScope(state.chain);
    if (badge) {
      badge.textContent =
        "/api/tasks (" +
        (state.chain === "all" ? "4217 + 8453" : "chainId=" + state.chain) +
        ") · " +
        fmtInt(scope.totalTasks) +
        " tasks · " +
        fmtUsdExact(cf.totalUsd) +
        " " +
        unit;
    }

    const W = 1020;
    const H = 460;
    const padTop = 38;
    const padBot = 28;
    const usableH = H - padTop - padBot;
    const nodeW = 14;
    const colX = [185, 495, 790];
    const gap = 14;

    function layoutColumn(items, x, minH) {
      const totalVal = items.reduce((s, it) => s + Math.max(0.01, it.usd), 0) || 1;
      const avail = Math.max(80, usableH - gap * Math.max(0, items.length - 1));
      const nodes = [];
      let y = padTop;
      const rawHeights = items.map((it) => Math.max(minH, (Math.max(0.01, it.usd) / totalVal) * avail));
      const sumH = rawHeights.reduce((a, b) => a + b, 0);
      const scale = sumH > avail ? avail / sumH : 1;

      for (let i = 0; i < items.length; i++) {
        const h = Math.max(10, rawHeights[i] * scale);
        nodes.push({
          ...items[i],
          x,
          y,
          w: nodeW,
          h,
          outY: y,
          inY: y,
        });
        y += h + gap;
      }
      return nodes;
    }

    const pNodes = layoutColumn(cf.posters || [], colX[0], 28);
    const mNodes = layoutColumn(cf.modes || [], colX[1], 24);
    const oNodes = layoutColumn(cf.outcomes || [], colX[2], 32);

    const nodeMap = new Map();
    [...pNodes, ...mNodes, ...oNodes].forEach((n) => nodeMap.set(n.id, n));

    // Calculate node outgoing/incoming totals for accurate ribbon scaling
    const outTotals = new Map();
    const inTotals = new Map();
    for (const l of cf.links || []) {
      outTotals.set(l.source, (outTotals.get(l.source) || 0) + l.usd);
      inTotals.set(l.target, (inTotals.get(l.target) || 0) + l.usd);
    }

    function outcomeColor(id) {
      if (id === "o_paid") return "#D9A097";
      if (id === "o_escrow") return "#E74079";
      return "#6E655D";
    }

    let svg =
      '<svg viewBox="0 0 ' +
      W +
      " " +
      H +
      '" role="img" aria-label="Taskmarket capital flow from posters through task modes to settlement outcomes">';

    // Column Headers
    svg +=
      '<text x="' +
      colX[0] +
      '" y="18" text-anchor="end" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="11" letter-spacing="1">DEMAND WALLETS</text>';
    svg +=
      '<text x="' +
      (colX[1] + nodeW / 2) +
      '" y="18" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="11" letter-spacing="1">TASK MODES</text>';
    svg +=
      '<text x="' +
      (colX[2] + nodeW) +
      '" y="18" text-anchor="start" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="11" letter-spacing="1">SETTLEMENT OUTCOME</text>';

    // Draw Links (sorted largest first for clean overlap)
    const linksSorted = [...(cf.links || [])].sort((a, b) => b.usd - a.usd);
    const linkData = [];

    for (let i = 0; i < linksSorted.length; i++) {
      const l = linksSorted[i];
      const src = nodeMap.get(l.source);
      const tgt = nodeMap.get(l.target);
      if (!src || !tgt || l.usd <= 0) continue;

      const srcTot = outTotals.get(src.id) || l.usd;
      const tgtTot = inTotals.get(tgt.id) || l.usd;
      const hSrc = Math.max(1.8, (l.usd / srcTot) * src.h);
      const hTgt = Math.max(1.8, (l.usd / tgtTot) * tgt.h);

      const y0 = src.outY + hSrc / 2;
      const y1 = tgt.inY + hTgt / 2;
      src.outY += hSrc;
      tgt.inY += hTgt;

      const x0 = src.x + src.w;
      const x1 = tgt.x;
      const cx = (x0 + x1) / 2;
      const strokeW = Math.max(1.8, (hSrc + hTgt) / 2);

      const isOutcomeLink = l.target.startsWith("o_");
      const strokeColor = isOutcomeLink ? outcomeColor(l.target) : "#EFE9E2";
      const baseOpacity = isOutcomeLink ? (l.target === "o_escrow" ? 0.56 : 0.44) : 0.2;
      const pathD = "M" + x0 + "," + y0.toFixed(1) + " C" + cx + "," + y0.toFixed(1) + " " + cx + "," + y1.toFixed(1) + " " + x1 + "," + y1.toFixed(1);

      linkData.push({ idx: i, src, tgt, l, unit, pathD, strokeColor, strokeW, baseOpacity });
      svg +=
        '<path class="sankey-link" data-slink="' +
        i +
        '" data-src="' +
        esc(src.id) +
        '" data-tgt="' +
        esc(tgt.id) +
        '" d="' +
        pathD +
        '" fill="none" stroke="' +
        strokeColor +
        '" stroke-width="' +
        strokeW.toFixed(1) +
        '" stroke-opacity="' +
        baseOpacity +
        '"/>';

      if (l.target === "o_escrow" && strokeW >= 3) {
        svg +=
          '<path class="sankey-pulse" d="' +
          pathD +
          '" fill="none" stroke="#FFF6E8" stroke-width="1.3" stroke-opacity="0.55"/>';
      }
    }

    // Draw Nodes & Labels with vertical collision avoidance so 2-line labels never touch
    function drawColNodes(nodes, align) {
      let lastLabelY = -999;
      for (const n of nodes) {
        const fill =
          n.id === "o_paid"
            ? "#D9A097"
            : n.id === "o_escrow"
            ? "#E74079"
            : n.id === "o_reclaimed"
            ? "#6E655D"
            : n.id.startsWith("m_")
            ? "#EFE9E2"
            : "#D9A097";
        svg +=
          '<g class="sankey-node" data-snode="' +
          esc(n.id) +
          '">' +
          '<rect x="' +
          n.x +
          '" y="' +
          n.y.toFixed(1) +
          '" width="' +
          n.w +
          '" height="' +
          n.h.toFixed(1) +
          '" rx="3" fill="' +
          fill +
          '"/>';

        const midY = Math.min(H - 16, Math.max(n.y + n.h / 2, lastLabelY + 30));
        lastLabelY = midY;
        if (align === "left") {
          svg +=
            '<text class="sankey-label" x="' +
            (n.x - 10) +
            '" y="' +
            (midY - 2).toFixed(1) +
            '" text-anchor="end" fill="#FFF6E8" font-family="Departure Mono, monospace" font-size="11">' +
            esc(n.label) +
            "</text>" +
            '<text class="sankey-label" x="' +
            (n.x - 10) +
            '" y="' +
            (midY + 11).toFixed(1) +
            '" text-anchor="end" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">' +
            fmtUsd(n.usd) +
            " · " +
            fmtInt(n.tasks) +
            "t</text>";
        } else if (align === "center") {
          svg +=
            '<text class="sankey-label" x="' +
            (n.x + n.w + 9) +
            '" y="' +
            (midY - 2).toFixed(1) +
            '" text-anchor="start" fill="#FFF6E8" font-family="Inter Tight, sans-serif" font-size="12" font-weight="500">' +
            esc(n.label) +
            "</text>" +
            '<text class="sankey-label" x="' +
            (n.x + n.w + 9) +
            '" y="' +
            (midY + 11).toFixed(1) +
            '" text-anchor="start" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">' +
            fmtUsd(n.usd) +
            " · " +
            fmtInt(n.tasks) +
            "t</text>";
        } else {
          svg +=
            '<text class="sankey-label" x="' +
            (n.x + n.w + 10) +
            '" y="' +
            (midY - 2).toFixed(1) +
            '" text-anchor="start" fill="#FFF6E8" font-family="Inter Tight, sans-serif" font-size="12.5" font-weight="500">' +
            esc(n.label) +
            "</text>" +
            '<text class="sankey-label" x="' +
            (n.x + n.w + 10) +
            '" y="' +
            (midY + 12).toFixed(1) +
            '" text-anchor="start" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10.5">' +
            fmtUsdExact(n.usd) +
            " (" +
            fmtPct(cf.totalUsd > 0 ? (n.usd / cf.totalUsd) * 100 : 0) +
            ") · " +
            fmtInt(n.tasks) +
            " tasks</text>";
        }
        svg += "</g>";
      }
    }

    drawColNodes(pNodes, "left");
    drawColNodes(mNodes, "center");
    drawColNodes(oNodes, "right");
    svg += "</svg>";
    container.innerHTML = svg;

    // Bind hover interactions
    const allLinkEls = container.querySelectorAll("[data-slink]");
    allLinkEls.forEach((el) => {
      const idx = Number(el.getAttribute("data-slink"));
      const rec = linkData.find((d) => d.idx === idx);
      if (!rec) return;
      el.addEventListener("mouseenter", (e) => {
        allLinkEls.forEach((other) => {
          other.setAttribute("stroke-opacity", other === el ? "0.92" : "0.08");
        });
        const rows = [
          ["Flow volume", fmtUsdExact(rec.l.usd) + " " + rec.unit],
          ["Share of total", fmtPct(cf.totalUsd > 0 ? (rec.l.usd / cf.totalUsd) * 100 : 0)],
        ];
        if (rec.l.tasks != null) rows.push(["Tasks", fmtInt(rec.l.tasks)]);
        showTooltip(e, rec.src.label + " -> " + rec.tgt.label, rows);
      });
      el.addEventListener("mousemove", moveTooltip);
      el.addEventListener("mouseleave", () => {
        allLinkEls.forEach((other) => {
          const oi = Number(other.getAttribute("data-slink"));
          const orec = linkData.find((d) => d.idx === oi);
          other.setAttribute("stroke-opacity", orec ? String(orec.baseOpacity) : "0.25");
        });
        hideTooltip();
      });
    });

    container.querySelectorAll("[data-snode]").forEach((el) => {
      const nid = el.getAttribute("data-snode");
      const n = nodeMap.get(nid);
      if (!n) return;
      el.addEventListener("mouseenter", (e) => {
        allLinkEls.forEach((other) => {
          const connected = other.getAttribute("data-src") === nid || other.getAttribute("data-tgt") === nid;
          other.setAttribute("stroke-opacity", connected ? "0.85" : "0.07");
        });
        const rows = [
          ["Volume", fmtUsdExact(n.usd) + " " + unit],
          ["Share", fmtPct(cf.totalUsd > 0 ? (n.usd / cf.totalUsd) * 100 : 0)],
          ["Tasks", fmtInt(n.tasks)],
        ];
        if (n.completed != null) rows.push(["Completed / Dead", fmtInt(n.completed) + " / " + fmtInt(n.dead || 0)]);
        showTooltip(e, n.label, rows);
      });
      el.addEventListener("mousemove", moveTooltip);
      el.addEventListener("mouseleave", () => {
        allLinkEls.forEach((other) => {
          const oi = Number(other.getAttribute("data-slink"));
          const orec = linkData.find((d) => d.idx === oi);
          other.setAttribute("stroke-opacity", orec ? String(orec.baseOpacity) : "0.25");
        });
        hideTooltip();
      });
    });
  }

  // --- SVG Chart 2: Swarm Convergence Radar ---
  function renderSwarmRadar() {
    const container = document.getElementById("swarmRadarChart");
    const inspector = document.getElementById("swarmInspector");
    if (!container || !snapshot) return;
    const scope = currentScope();
    const pts = (scope && scope.swarmPoints) || [];
    if (!pts.length) {
      container.innerHTML = '<p class="muted mono">No tasks available for this filter.</p>';
      return;
    }

    const W = 940;
    const H = 300;
    const m = { t: 24, r: 28, b: 44, l: 58 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxReward = Math.max(50, ...pts.map((p) => p.rewardUsd));
    const maxSubs = Math.max(20, ...pts.map((p) => p.submissions));
    const minLog = Math.log10(0.1);
    const maxLog = Math.log10(maxReward * 1.25);

    const xPos = (usd) => {
      const clamped = Math.max(0.1, usd);
      return m.l + ((Math.log10(clamped) - minLog) / (maxLog - minLog)) * iw;
    };
    const yPos = (subs) => {
      return m.t + ih - (Math.sqrt(Math.max(0, subs)) / Math.sqrt(maxSubs * 1.08)) * ih;
    };

    const xTicks = [0.25, 1, 5, 25, 100, 250].filter((v) => v <= maxReward * 1.2);
    const yTicks = [0, 10, 50, 150, 350, 600].filter((v) => v <= maxSubs * 1.05);

    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Task reward versus submission count scatter plot">';

    // Gridlines
    for (const xt of xTicks) {
      const x = xPos(xt);
      svg +=
        '<line x1="' + x.toFixed(1) + '" y1="' + m.t + '" x2="' + x.toFixed(1) + '" y2="' + (m.t + ih) + '" stroke="#453E37" stroke-opacity="0.45" stroke-dasharray="2 4"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10.5">$' + xt + "</text>";
    }
    for (const yt of yTicks) {
      const y = yPos(yt);
      svg +=
        '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + y.toFixed(1) + '" stroke="#453E37" stroke-opacity="0.45"/>' +
        '<text x="' + (m.l - 10) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10.5">' + yt + "</text>";
    }

    svg +=
      '<text x="' + (m.l + iw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">REWARD AMOUNT (USD EQ., LOG SCALE)</text>' +
      '<text x="14" y="' + (m.t + ih / 2) + '" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10" transform="rotate(-90 14 ' + (m.t + ih / 2) + ')">SUBMISSIONS</text>';

    // Plot dots
    const defaultPick = pts.find((p) => p.ref === state.selectedTaskRef) || pts[0];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const cx = xPos(p.rewardUsd);
      const cy = yPos(p.submissions);
      const isSelected = defaultPick && p.ref === defaultPick.ref;
      const fill = p.status === "open" ? "#E74079" : p.status === "completed" ? "#D9A097" : "#6E655D";
      const r = isSelected ? 7.5 : p.submissions > 100 || p.rewardUsd >= 50 ? 6 : 4.5;
      svg +=
        '<circle data-swarm-idx="' +
        i +
        '" cx="' +
        cx.toFixed(1) +
        '" cy="' +
        cy.toFixed(1) +
        '" r="' +
        r +
        '" fill="' +
        fill +
        '" fill-opacity="' +
        (isSelected ? "1" : "0.78") +
        '" stroke="' +
        (isSelected ? "#FFF6E8" : "#12100E") +
        '" stroke-width="' +
        (isSelected ? "2" : "1") +
        '" style="cursor:pointer"/>';
    }

    // Label top outlier clearly
    const topSub = pts[0];
    if (topSub && topSub.submissions >= 50) {
      const lx = Math.min(W - 140, xPos(topSub.rewardUsd) + 10);
      const ly = Math.max(m.t + 12, yPos(topSub.submissions) + 4);
      svg +=
        '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#FFF6E8" font-family="Departure Mono, monospace" font-size="10">' +
        esc(topSub.ref) + " (" + fmtInt(topSub.submissions) + " subs)</text>";
    }

    svg += "</svg>";
    container.innerHTML = svg;

    function updateInspector(p) {
      if (!inspector || !p) return;
      state.selectedTaskRef = p.ref;
      inspector.innerHTML =
        '<div><p class="inspector-title">' +
        esc(p.title) +
        '</p><div class="inspector-meta"><span>' +
        esc(p.ref) +
        "</span><span>" +
        esc(chainShort(p.chainId)) +
        "</span><span>mode: " +
        esc(p.mode) +
        "</span><span>status: " +
        esc(p.status) +
        "</span><span>poster: " +
        esc(p.requester) +
        "</span></div></div>" +
        '<div class="inspector-meta"><span class="paper">' +
        fmtUsdExact(p.rewardUsd) +
        "</span><span>" +
        fmtInt(p.submissions) +
        " submissions</span><span>" +
        fmtInt(p.awards) +
        " awards</span></div>";
    }

    updateInspector(defaultPick);

    container.querySelectorAll("[data-swarm-idx]").forEach((el) => {
      const idx = Number(el.getAttribute("data-swarm-idx"));
      const p = pts[idx];
      if (!p) return;
      el.addEventListener("mouseenter", (e) => {
        showTooltip(e, p.ref + " · " + chainShort(p.chainId), [
          ["Reward", fmtUsdExact(p.rewardUsd)],
          ["Submissions", fmtInt(p.submissions)],
          ["Status / Mode", p.status + " / " + p.mode],
          ["Poster", p.requester],
        ]);
      });
      el.addEventListener("mousemove", moveTooltip);
      el.addEventListener("mouseleave", hideTooltip);
      el.addEventListener("click", () => {
        updateInspector(p);
        renderSwarmRadar();
      });
    });
  }

  // --- SVG Chart 3: Time-Series Suite ---
  function renderLineBarChart(container, series, cfg) {
    if (!container) return;
    if (!series || !series.length) {
      container.innerHTML = '<p class="muted mono">No time-series buckets for this selection.</p>';
      return;
    }

    const W = cfg.compact ? 620 : 940;
    const H = cfg.compact ? 225 : 225;
    const m = { t: 18, r: 22, b: 36, l: cfg.compact ? 58 : 56 };
    const axisFont = cfg.compact ? 11.5 : 10.5;
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxVal = Math.max(
      1,
      ...series.map((d) => Math.max(Number(d[cfg.aKey] || 0), cfg.bKey ? Number(d[cfg.bKey] || 0) : 0))
    );
    const niceMax = maxVal <= 5 ? Math.ceil(maxVal) : Math.ceil(maxVal * 1.12);
    const n = series.length;
    const stepX = n > 1 ? iw / (n - 1) : iw;
    const barSlot = iw / Math.max(1, n);
    const barW = Math.max(2, Math.min(22, barSlot * 0.62));

    const xOf = (i) => (cfg.mode === "line" ? (n > 1 ? m.l + i * stepX : m.l + iw / 2) : m.l + i * barSlot + barSlot / 2);
    const yOf = (v) => m.t + ih - (Math.max(0, Number(v) || 0) / niceMax) * ih;

    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(cfg.aria) + '">';

    // 4 horizontal gridlines
    for (let g = 0; g <= 3; g++) {
      const val = (niceMax * g) / 3;
      const y = yOf(val);
      svg +=
        '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + y.toFixed(1) + '" stroke="#453E37" stroke-opacity="0.45"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="' + axisFont + '">' +
        esc(cfg.fmtY(val)) +
        "</text>";
    }

    // Series A
    if (cfg.mode === "line") {
      const ptsA = series.map((d, i) => xOf(i).toFixed(1) + "," + yOf(d[cfg.aKey]).toFixed(1));
      const areaA =
        "M" + xOf(0).toFixed(1) + "," + (m.t + ih) + " L" + ptsA.join(" L") + " L" + xOf(n - 1).toFixed(1) + "," + (m.t + ih) + " Z";
      svg +=
        '<path d="' + areaA + '" fill="' + cfg.aColor + '" fill-opacity="0.12"/>' +
        '<polyline fill="none" stroke="' + cfg.aColor + '" stroke-width="2.1" points="' + ptsA.join(" ") + '"/>';
      if (cfg.bKey) {
        const ptsB = series.map((d, i) => xOf(i).toFixed(1) + "," + yOf(d[cfg.bKey]).toFixed(1));
        svg += '<polyline fill="none" stroke="' + cfg.bColor + '" stroke-width="1.6" stroke-dasharray="4 3" points="' + ptsB.join(" ") + '"/>';
      }
    } else {
      for (let i = 0; i < n; i++) {
        const d = series[i];
        const cx = xOf(i);
        const yA = yOf(d[cfg.aKey]);
        const hA = Math.max(0, m.t + ih - yA);
        svg +=
          '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + yA.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + hA.toFixed(1) + '" rx="1.5" fill="' + cfg.aColor + '" fill-opacity="0.34"/>';
      }
      if (cfg.bKey) {
        const ptsB = series.map((d, i) => xOf(i).toFixed(1) + "," + yOf(d[cfg.bKey]).toFixed(1));
        svg += '<polyline fill="none" stroke="' + cfg.bColor + '" stroke-width="2.1" points="' + ptsB.join(" ") + '"/>';
        if (n <= 45) {
          for (let i = 0; i < n; i++) {
            svg += '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(series[i][cfg.bKey]).toFixed(1) + '" r="2.7" fill="' + cfg.bColor + '"/>';
          }
        }
      }
    }

    // X-axis labels (up to 6 evenly spaced)
    const tickCount = Math.min(6, n);
    const shownIdx = new Set();
    for (let t = 0; t < tickCount; t++) {
      const idx = tickCount === 1 ? 0 : Math.round((t * (n - 1)) / (tickCount - 1));
      if (shownIdx.has(idx)) continue;
      shownIdx.add(idx);
      const lbl = String(series[idx].bucket || "").slice(5);
      svg +=
        '<text x="' + xOf(idx).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="' + axisFont + '">' +
        esc(lbl || series[idx].bucket) +
        "</text>";
    }

    // Interactive invisible hover hitbands
    for (let i = 0; i < n; i++) {
      const xStart = i === 0 ? m.l : (xOf(i - 1) + xOf(i)) / 2;
      const xEnd = i === n - 1 ? W - m.r : (xOf(i) + xOf(i + 1)) / 2;
      svg +=
        '<rect data-ts-idx="' +
        i +
        '" x="' +
        xStart.toFixed(1) +
        '" y="' +
        m.t +
        '" width="' +
        Math.max(2, xEnd - xStart).toFixed(1) +
        '" height="' +
        ih +
        '" fill="transparent" style="cursor:crosshair"/>';
    }

    svg += "</svg>";
    container.innerHTML = svg;

    container.querySelectorAll("[data-ts-idx]").forEach((el) => {
      const idx = Number(el.getAttribute("data-ts-idx"));
      const d = series[idx];
      if (!d) return;
      el.addEventListener("mouseenter", (e) => {
        const rows = [[cfg.aLabel, cfg.fmtTooltip(d[cfg.aKey])]];
        if (cfg.bKey) rows.push([cfg.bLabel, cfg.fmtTooltip(d[cfg.bKey])]);
        if (cfg.extra) rows.push(...cfg.extra(d));
        showTooltip(e, d.bucket, rows);
      });
      el.addEventListener("mousemove", moveTooltip);
      el.addEventListener("mouseleave", hideTooltip);
    });
  }

  function renderTrends() {
    if (!snapshot) return;
    const bucketMap = snapshot.platformTimeSeries[state.bucket] || snapshot.platformTimeSeries.day;
    const series = bucketMap[state.range] || bucketMap["30d"] || [];
    const badge = document.getElementById("trendsSourceBadge");
    if (badge) {
      badge.textContent =
        "/api/stats/platform-time-series?range=" + state.range + "&bucket=" + state.bucket + " (platform-wide)";
    }

    renderLineBarChart(document.getElementById("trendsAgentsChart"), series, {
      mode: "line",
      aKey: "activeAgents",
      aLabel: "Active agents",
      aColor: "#E74079",
      bKey: "newAgents",
      bLabel: "New agents",
      bColor: "#EFE9E2",
      fmtY: (v) => fmtInt(v),
      fmtTooltip: (v) => fmtInt(v),
      aria: "Active agents and new agents over time",
    });

    renderLineBarChart(document.getElementById("trendsTasksChart"), series, {
      mode: "bar",
      compact: true,
      aKey: "tasksCreated",
      aLabel: "Tasks created",
      aColor: "#EFE9E2",
      bKey: "completedTasks",
      bLabel: "Completed tasks",
      bColor: "#D9A097",
      fmtY: (v) => fmtInt(v),
      fmtTooltip: (v) => fmtInt(v),
      extra: (d) => [["Settlements", fmtInt(d.settlements)]],
      aria: "Tasks created and completed over time",
    });

    renderLineBarChart(document.getElementById("trendsVolumeChart"), series, {
      mode: "bar",
      compact: true,
      aKey: "rewardUsd",
      aLabel: "Rewards put up",
      aColor: "#EFE9E2",
      bKey: "paidUsd",
      bLabel: "Rewards paid",
      bColor: "#D9A097",
      fmtY: (v) => "$" + Math.round(v),
      fmtTooltip: (v) => fmtUsdExact(v),
      aria: "Rewards put up versus rewards paid over time",
    });

    // Chain-scoped daily chart from /api/tasks when a single chain is selected
    const chainWrap = document.getElementById("chainTrendsWrap");
    if (chainWrap) {
      if (state.chain === "all") {
        chainWrap.style.display = "none";
      } else {
        chainWrap.style.display = "block";
        const scope = currentScope();
        let ds = (scope && scope.dailySeries) || [];
        if (state.range === "7d") ds = ds.slice(-7);
        else if (state.range === "30d") ds = ds.slice(-30);
        else if (state.range === "90d") ds = ds.slice(-90);
        const titleEl = document.getElementById("chainTrendsTitle");
        if (titleEl) {
          titleEl.textContent =
            chainLabel(state.chain) + " — Daily Rewards Put Up vs. Paid (from /api/tasks?chainId=" + state.chain + ")";
        }
        renderLineBarChart(document.getElementById("chainTrendsChart"), ds, {
          mode: "bar",
          aKey: "rewardUsd",
          aLabel: "Put up (" + tokenForScope(state.chain) + ")",
          aColor: "#EFE9E2",
          bKey: "paidUsd",
          bLabel: "Paid (" + tokenForScope(state.chain) + ")",
          bColor: "#D9A097",
          fmtY: (v) => "$" + Math.round(v),
          fmtTooltip: (v) => fmtUsdExact(v),
          extra: (d) => [
            ["Tasks posted", fmtInt(d.tasksCreated)],
            ["Distinct posters", fmtInt(d.distinctPosters)],
          ],
          aria: "Chain-scoped daily reward volume",
        });
      }
    }
  }

  // --- Breakdowns + Dual Activity Heatmaps ---
  function renderBreakdownsAndHeatmaps() {
    if (!snapshot) return;
    const isAll = state.chain === "all";
    const scope = currentScope();

    const modeRows = isAll
      ? [...(snapshot.breakdowns?.platform?.mode || [])].sort((a, b) => b.count - a.count)
      : scope?.byMode || [];
    const statusRows = isAll
      ? [...(snapshot.breakdowns?.platform?.status || [])].sort((a, b) => b.count - a.count)
      : scope?.byStatus || [];

    const bdBadge = document.getElementById("breakdownSourceBadge");
    if (bdBadge) {
      bdBadge.textContent = isAll
        ? "/api/stats/breakdowns (platform-wide)"
        : "/api/tasks?chainId=" + state.chain + " (" + chainShort(state.chain) + ")";
    }

    function fillBars(elId, rows, labelKey, colorFn) {
      const el = document.getElementById(elId);
      if (!el) return;
      const total = rows.reduce((s, r) => s + Number(r.count || 0), 0) || 1;
      const maxC = Math.max(1, ...rows.map((r) => Number(r.count || 0)));
      el.innerHTML = rows
        .map((r) => {
          const pctW = Math.max(2, (Number(r.count || 0) / maxC) * 100);
          const share = ((Number(r.count || 0) / total) * 100).toFixed(1);
          return (
            '<div class="bar-row">' +
            '<span class="bar-label">' + esc(r[labelKey]) + "</span>" +
            '<div class="bar-track"><div class="bar-fill ' + colorFn(r[labelKey]) + '" style="width:' + pctW.toFixed(1) + '%"></div></div>' +
            '<span class="bar-val">' + fmtInt(r.count) + " <span class='muted'>(" + share + "%)</span></span>" +
            "</div>"
          );
        })
        .join("");
    }

    fillBars("modesBars", modeRows, "mode", (m) => (m === "bounty" ? "" : m === "claim" ? "cream" : "muted"));
    fillBars("statusBars", statusRows, "status", (s) =>
      s === "completed" ? "" : s === "open" ? "magenta" : s === "expired" || s === "cancelled" ? "muted" : "cream"
    );

    // Heatmap color helper (Brand Kit perceptual ramp: inset -> warm umber -> salmon -> magenta)
    function heatColor(ratio) {
      if (ratio <= 0) return "#191613";
      if (ratio < 0.2) return "#33221F";
      if (ratio < 0.45) return "#6A3F3A";
      if (ratio < 0.72) return "#B57870";
      if (ratio < 0.9) return "#D9A097";
      return "#E74079";
    }

    // 1. hourOfWeek 7x24 heatmap
    const hmHour = snapshot.heatmaps?.hourOfWeek?.[state.range] || snapshot.heatmaps?.hourOfWeek?.["30d"];
    const hourEl = document.getElementById("heatmapHourChart");
    const hmBadge = document.getElementById("heatmapSourceBadge");
    if (hmBadge) {
      hmBadge.textContent = "/api/stats/activity-heatmap?range=" + state.range + " (hourOfWeek & mode · platform-wide)";
    }

    if (hourEl && hmHour) {
      const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const fmtDow = (k) => (/^[0-6]$/.test(String(k)) ? DOW_NAMES[Number(k)] : String(k));
      const fmtHr = (k) => String(k).padStart(2, "0") + ":00";
      const rows = hmHour.rowKeys || ["0", "1", "2", "3", "4", "5", "6"];
      const cols = hmHour.colKeys || [];
      const maxC = Math.max(1, Number(hmHour.maxCount || 1));
      const lookup = new Map();
      for (const c of hmHour.cells || []) lookup.set(c.row + "|" + c.col, Number(c.count || 0));

      const cellW = 28;
      const cellH = 22;
      const padL = 46;
      const padT = 24;
      const W = padL + cols.length * cellW + 12;
      const H = padT + rows.length * cellH + 14;

      let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Activity heatmap by day of week and UTC hour">';
      for (let c = 0; c < cols.length; c++) {
        if (c % 3 === 0) {
          svg +=
            '<text x="' + (padL + c * cellW + cellW / 2) + '" y="15" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="9.5">' +
            esc(String(cols[c]).padStart(2, "0")) +
            "h</text>";
        }
      }
      for (let r = 0; r < rows.length; r++) {
        const dayLabel = fmtDow(rows[r]);
        svg +=
          '<text x="' + (padL - 8) + '" y="' + (padT + r * cellH + 14.5) + '" text-anchor="end" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">' +
          esc(dayLabel) +
          "</text>";
        for (let c = 0; c < cols.length; c++) {
          const val = lookup.get(rows[r] + "|" + cols[c]) || 0;
          const ratio = val / maxC;
          svg +=
            '<rect data-hm-r="' + esc(dayLabel) + '" data-hm-c="' + esc(fmtHr(cols[c])) + '" data-hm-v="' + val + '" x="' +
            (padL + c * cellW + 1.5) +
            '" y="' +
            (padT + r * cellH + 1.5) +
            '" width="' +
            (cellW - 3) +
            '" height="' +
            (cellH - 3) +
            '" rx="3" fill="' +
            heatColor(ratio) +
            '" stroke="#12100E" stroke-width="0.6" style="cursor:pointer"/>';
        }
      }
      svg += "</svg>";
      hourEl.innerHTML = svg;

      hourEl.querySelectorAll("[data-hm-v]").forEach((cell) => {
        cell.addEventListener("mouseenter", (e) => {
          showTooltip(e, cell.getAttribute("data-hm-r") + " · " + cell.getAttribute("data-hm-c") + " UTC", [
            ["Activity events", fmtInt(cell.getAttribute("data-hm-v"))],
            ["Window", state.range],
          ]);
        });
        cell.addEventListener("mousemove", moveTooltip);
        cell.addEventListener("mouseleave", hideTooltip);
      });
    }

    // 2. mode x date heatmap
    const hmMode = snapshot.heatmaps?.mode?.[state.range] || snapshot.heatmaps?.mode?.["30d"];
    const modeEl = document.getElementById("heatmapModeChart");
    if (modeEl && hmMode) {
      const rows = hmMode.rowKeys || [];
      const allCols = hmMode.colKeys || [];
      // Show at most the latest 45 columns cleanly if range=all so cells stay sharp & clickable
      const cols = allCols.length > 45 ? allCols.slice(-45) : allCols;
      const lookup = new Map();
      let localMax = 1;
      for (const c of hmMode.cells || []) {
        const v = Number(c.count || 0);
        lookup.set(c.row + "|" + c.col, v);
        if (cols.includes(c.col) && v > localMax) localMax = v;
      }

      const padL = 86;
      const padT = 24;
      const cellH = 24;
      const availW = 640;
      const cellW = Math.max(10, Math.min(34, availW / Math.max(1, cols.length)));
      const W = padL + cols.length * cellW + 14;
      const H = padT + rows.length * cellH + 16;

      let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Activity heatmap by task mode and date">';
      const stepLbl = Math.max(1, Math.ceil(cols.length / 6));
      for (let c = 0; c < cols.length; c += stepLbl) {
        svg +=
          '<text x="' + (padL + c * cellW + cellW / 2) + '" y="15" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="9.5">' +
          esc(String(cols[c]).slice(5)) +
          "</text>";
      }
      for (let r = 0; r < rows.length; r++) {
        svg +=
          '<text x="' + (padL - 10) + '" y="' + (padT + r * cellH + 15.5) + '" text-anchor="end" fill="#EFE9E2" font-family="Departure Mono, monospace" font-size="10.5">' +
          esc(rows[r]) +
          "</text>";
        for (let c = 0; c < cols.length; c++) {
          const val = lookup.get(rows[r] + "|" + cols[c]) || 0;
          svg +=
            '<rect data-mm-r="' + esc(rows[r]) + '" data-mm-c="' + esc(cols[c]) + '" data-mm-v="' + val + '" x="' +
            (padL + c * cellW + 1) +
            '" y="' +
            (padT + r * cellH + 1.5) +
            '" width="' +
            Math.max(4, cellW - 2) +
            '" height="' +
            (cellH - 3) +
            '" rx="2.5" fill="' +
            heatColor(val / localMax) +
            '" style="cursor:pointer"/>';
        }
      }
      svg += "</svg>";
      modeEl.innerHTML = svg;

      modeEl.querySelectorAll("[data-mm-v]").forEach((cell) => {
        cell.addEventListener("mouseenter", (e) => {
          showTooltip(e, cell.getAttribute("data-mm-r") + " · " + cell.getAttribute("data-mm-c"), [
            ["Tasks / events", fmtInt(cell.getAttribute("data-mm-v"))],
          ]);
        });
        cell.addEventListener("mousemove", moveTooltip);
        cell.addEventListener("mouseleave", hideTooltip);
      });
    }
  }

  // --- SVG Chart 4: Weekly Distinct Task Posters ---
  function renderWeeklyPosters() {
    const chartEl = document.getElementById("weeklyPostersChart");
    const tableBody = document.getElementById("weeklyPostersBody");
    const badge = document.getElementById("postersSourceBadge");
    if (!chartEl || !snapshot) return;

    const scope = currentScope();
    const weeks = (scope && scope.weeklyPosters) || [];
    if (badge) {
      badge.textContent =
        "Computed from paginated /api/tasks (" +
        (state.chain === "all" ? "4217 + 8453" : "chainId=" + state.chain) +
        ") · " +
        fmtInt(scope?.uniquePosters || 0) +
        " cumulative distinct wallets";
    }

    if (!weeks.length) {
      chartEl.innerHTML = '<p class="muted mono">No weekly poster records found.</p>';
      if (tableBody) tableBody.innerHTML = "";
      return;
    }

    const W = 940;
    const H = 250;
    const m = { t: 22, r: 52, b: 42, l: 48 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxP = Math.max(5, ...weeks.map((w) => w.distinctPosters));
    const maxT = Math.max(10, ...weeks.map((w) => w.tasks));
    const niceP = Math.ceil(maxP * 1.15);
    const niceT = Math.ceil(maxT * 1.15);

    const n = weeks.length;
    const slot = iw / n;
    const barW = Math.max(6, Math.min(30, slot * 0.58));
    const xOf = (i) => m.l + i * slot + slot / 2;
    const yP = (v) => m.t + ih - (v / niceP) * ih;
    const yT = (v) => m.t + ih - (v / niceT) * ih;

    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Distinct task posters and tasks posted per ISO week">';

    for (let g = 0; g <= 3; g++) {
      const vp = (niceP * g) / 3;
      const vt = (niceT * g) / 3;
      const y = yP(vp);
      svg +=
        '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + y.toFixed(1) + '" stroke="#453E37" stroke-opacity="0.45"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="#D9A097" font-family="Departure Mono, monospace" font-size="10">' + fmtInt(vp) + "</text>" +
        '<text x="' + (W - m.r + 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="start" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">' + fmtInt(vt) + "</text>";
    }

    // Bars: distinct posters
    for (let i = 0; i < n; i++) {
      const w = weeks[i];
      const cx = xOf(i);
      const y = yP(w.distinctPosters);
      const h = Math.max(1.5, m.t + ih - y);
      const isPeak = w.distinctPosters === maxP;
      svg +=
        '<rect data-wp-idx="' + i + '" x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (isPeak ? "#E74079" : "#D9A097") + '" fill-opacity="0.88" style="cursor:pointer"/>';
    }

    // Line: tasks created that week
    const pts = weeks.map((w, i) => xOf(i).toFixed(1) + "," + yT(w.tasks).toFixed(1));
    svg += '<polyline fill="none" stroke="#EFE9E2" stroke-width="2" points="' + pts.join(" ") + '"/>';
    for (let i = 0; i < n; i++) {
      svg += '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yT(weeks[i].tasks).toFixed(1) + '" r="3" fill="#FFF6E8" stroke="#12100E" stroke-width="1"/>';
    }

    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      svg +=
        '<text x="' + xOf(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" fill="#B0A79D" font-family="Departure Mono, monospace" font-size="10">' +
        esc(weeks[i].week) +
        "</text>";
    }
    svg += "</svg>";
    chartEl.innerHTML = svg;

    chartEl.querySelectorAll("[data-wp-idx]").forEach((el) => {
      const w = weeks[Number(el.getAttribute("data-wp-idx"))];
      if (!w) return;
      el.addEventListener("mouseenter", (e) => {
        const ratio = w.distinctPosters > 0 ? (w.tasks / w.distinctPosters).toFixed(2) : "0";
        showTooltip(e, w.week + " (starts " + w.weekStart + ")", [
          ["Distinct posters", fmtInt(w.distinctPosters)],
          ["Tasks posted", fmtInt(w.tasks)],
          ["Tasks / poster", ratio],
          ["Rewards put up", fmtUsdExact(w.rewardUsd)],
          ["Paid out", fmtUsdExact(w.paidUsd)],
        ]);
      });
      el.addEventListener("mousemove", moveTooltip);
      el.addEventListener("mouseleave", hideTooltip);
    });

    if (tableBody) {
      const desc = [...weeks].reverse();
      tableBody.innerHTML = desc
        .map((w) => {
          const tpp = w.distinctPosters > 0 ? (w.tasks / w.distinctPosters).toFixed(2) : "0.00";
          return (
            "<tr>" +
            '<td class="mono paper">' + esc(w.week) + "</td>" +
            '<td class="mono muted">' + esc(w.weekStart) + "</td>" +
            '<td class="num paper">' + fmtInt(w.distinctPosters) + "</td>" +
            '<td class="num">' + fmtInt(w.tasks) + "</td>" +
            '<td class="num muted">' + tpp + "</td>" +
            '<td class="num">' + fmtUsdExact(w.rewardUsd) + "</td>" +
            '<td class="num">' + fmtUsdExact(w.paidUsd) + "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
  }

  // --- Non-Obvious Insights Observatory ---
  function renderInsights() {
    const cardsEl = document.getElementById("insightsCards");
    const postersBody = document.getElementById("topPostersBody");
    if (!cardsEl || !snapshot) return;

    const scope = currentScope();
    const ins = scope?.insights;
    const tScope = snapshot.scopes["4217"]?.insights;
    const bScope = snapshot.scopes["8453"]?.insights;
    const mom = snapshot.momentum;
    if (!ins) return;

    const claimMins = ins.medianClaimHours != null ? Math.max(1, Math.round(ins.medianClaimHours * 60)) : null;
    const mortRatio =
      tScope && bScope && tScope.deadPct > 0 ? (bScope.deadPct / tScope.deadPct).toFixed(1) + "x" : "n/a";

    const cards = [
      {
        tag: "DEMAND CONCENTRATION",
        headline: "Top three wallets supply over a third of capital",
        stat: fmtPct(ins.top3ShareVolPct) + " · Gini " + Number(ins.giniVolume || 0).toFixed(2),
        body:
          "Across " +
          fmtInt(ins.uniquePosters) +
          " distinct posting wallets (" +
          ins.tasksPerPoster +
          " tasks/poster), the largest single requester accounts for " +
          fmtPct(ins.top1ShareVolPct) +
          " of posted volume. Tempo concentrates " +
          fmtInt(snapshot.headline?.byChain?.["4217"]?.totalTasks || 0) +
          " tasks into " +
          fmtInt(tScope?.uniquePosters || 0) +
          " repeat wallets; Base spreads " +
          fmtInt(snapshot.headline?.byChain?.["8453"]?.totalTasks || 0) +
          " tasks across " +
          fmtInt(bScope?.uniquePosters || 0) +
          " distinct posters.",
      },
      {
        tag: "CHAIN MORTALITY GAP",
        headline: "Base expires or cancels tasks " + mortRatio + " more often than Tempo",
        stat: fmtPct(tScope?.deadPct || 0) + " Tempo vs. " + fmtPct(bScope?.deadPct || 0) + " Base",
        body:
          "In this scope, " +
          fmtInt(ins.deadCount) +
          " tasks (" +
          fmtPct(ins.deadPct) +
          ", " +
          fmtUsdExact(ins.deadUsd) +
          ") expired or were cancelled. Notably, " +
          fmtPct(ins.deadZeroSubPct) +
          " of dead tasks received zero submissions before closing — pointing to unfilled liquidity rather than rejected work.",
      },
      {
        tag: "SWARM SPEED & DENSITY",
        headline: "Claim tasks are taken in minutes; bounties draw crowds",
        stat: (claimMins != null ? claimMins + "m median claim" : "n/a") + " · " + ins.avgSubsPerBounty + " subs/bounty",
        body:
          "Across " +
          fmtInt(ins.claimSampleSize) +
          " claimed tasks, median claim latency is " +
          (claimMins != null ? claimMins + " minutes (" + ins.medianClaimHours + "h)" : "n/a") +
          ". Bounties average " +
          ins.avgSubsPerBounty +
          " submissions at a " +
          fmtUsdExact(ins.medianBountyUsd) +
          " median reward" +
          (ins.topSwarm
            ? ", peaking at " + fmtInt(ins.topSwarm.submissions) + " submissions on " + ins.topSwarm.ref + "."
            : "."),
      },
      {
        tag: "7-DAY MOMENTUM (PLATFORM-WIDE)",
        headline: "Completed weekly payouts rose steeply week-over-week",
        stat: mom ? fmtDelta(mom.paidUsd.deltaPct) + " paid · " + fmtDelta(mom.tasksCreated.deltaPct) + " tasks" : "n/a",
        body: mom
          ? "Comparing full UTC weeks (" +
            mom.windowCurrent +
            " vs. " +
            mom.windowPrior +
            "): tasks created grew from " +
            fmtInt(mom.tasksCreated.prior) +
            " to " +
            fmtInt(mom.tasksCreated.current) +
            ", rewards posted rose from " +
            fmtUsdExact(mom.rewardUsd.prior) +
            " to " +
            fmtUsdExact(mom.rewardUsd.current) +
            ", and paid volume rose from " +
            fmtUsdExact(mom.paidUsd.prior) +
            " to " +
            fmtUsdExact(mom.paidUsd.current) +
            "."
          : "Insufficient daily series history for week-over-week delta.",
      },
    ];

    cardsEl.innerHTML = cards
      .map(
        (c) =>
          '<article class="insight-card">' +
          '<span class="insight-tag">' + esc(c.tag) + "</span>" +
          '<h3 class="insight-headline">' + esc(c.headline) + "</h3>" +
          '<div class="insight-stat">' + esc(c.stat) + "</div>" +
          '<p class="insight-body">' + esc(c.body) + "</p>" +
          "</article>"
      )
      .join("");

    if (postersBody) {
      const unit = tokenForScope(state.chain);
      postersBody.innerHTML = (ins.topPostersTable || [])
        .map(
          (p, i) =>
            "<tr>" +
            '<td class="mono muted">#' + (i + 1) + "</td>" +
            '<td class="mono paper">' + esc(p.addr) + "</td>" +
            '<td class="num">' + fmtInt(p.tasks) + "</td>" +
            '<td class="num paper">' + fmtUsdExact(p.usd) + " <span class='muted'>" + unit + "</span></td>" +
            '<td class="num">' + fmtPct(p.shareUsdPct) + "</td>" +
            '<td class="num">' + fmtInt(p.completed) + "</td>" +
            '<td class="num muted">' + fmtInt(p.dead) + "</td>" +
            "</tr>"
        )
        .join("");
    }
  }

  // --- Live Activity Feed + Recent Chain Tasks ---
  function renderFeed() {
    const listEl = document.getElementById("feedList");
    const recentEl = document.getElementById("recentChainTasksBody");
    const feedNote = document.getElementById("feedFilterNote");
    if (!listEl || !snapshot) return;

    const allEvents = snapshot.feed || [];
    const filtered = allEvents.filter((ev) => {
      if (state.chain !== "all" && String(ev.chainId) !== state.chain) return false;
      if (state.feedType !== "all") {
        if (state.feedType === "paid") {
          return ev.type.includes("paid") || ev.type.includes("settled") || ev.type.includes("award") || ev.type.includes("completed");
        }
        if (state.feedType === "submitted") return ev.type.includes("submit");
        if (state.feedType === "created") return ev.type.includes("create");
        if (state.feedType === "claimed") return ev.type.includes("claim");
      }
      return true;
    });

    const maxItems = state.view === "feed" ? 50 : 12;
    const slice = filtered.slice(0, maxItems);

    if (feedNote) {
      feedNote.textContent =
        "Showing " +
        fmtInt(slice.length) +
        " of " +
        fmtInt(filtered.length) +
        " events from /api/stats/activity-feed (latest 50 platform-wide events)";
    }

    if (!slice.length) {
      listEl.innerHTML =
        '<p class="muted" style="padding:14px 4px;margin:0;">No events match this filter in the latest 50 platform-wide feed entries. Recent tasks for ' +
        esc(state.chain === "all" ? "both chains" : chainLabel(state.chain)) +
        " are listed directly below from /api/tasks.</p>";
    } else {
      listEl.innerHTML = slice
        .map((ev) => {
          const cls =
            ev.type.includes("paid") || ev.type.includes("award") || ev.type.includes("completed")
              ? "paid"
              : ev.type.includes("create")
              ? "created"
              : "";
          const label = ev.type.replace(/^task_/, "").replace(/_/g, " ");
          return (
            '<div class="feed-row">' +
            '<span class="event-badge ' + cls + '">' + esc(label) + "</span>" +
            '<span class="mono muted feed-time">' + esc(fmtRelTime(ev.timestamp, snapshot.dataAsOf)) + " · " + (ev.chainId === 8453 ? "Base" : "Tempo") + "</span>" +
            '<span class="feed-title" title="' + esc(ev.taskTitle) + '">' + esc(ev.taskTitle || ev.taskId.slice(0, 14)) + "</span>" +
            '<span class="feed-actor">' + esc(ev.actor) + "</span>" +
            '<span class="feed-amt">' + (ev.amountUsd != null ? fmtUsdExact(ev.amountUsd) : "--") + "</span>" +
            "</div>"
          );
        })
        .join("");
    }

    if (recentEl) {
      const scope = currentScope();
      const recent = (scope && scope.recentTasks) || [];
      recentEl.innerHTML = recent
        .slice(0, state.view === "feed" ? 15 : 8)
        .map(
          (t) =>
            "<tr>" +
            '<td class="mono paper">' + esc(t.ref) + "</td>" +
            '<td class="mono muted">' + (t.chainId === 8453 ? "Base" : "Tempo") + "</td>" +
            "<td>" + esc(t.title) + "</td>" +
            '<td class="mono muted">' + esc(t.mode) + " / " + esc(t.status) + "</td>" +
            '<td class="mono muted">' + esc(t.requester) + "</td>" +
            '<td class="num paper">' + fmtUsdExact(t.rewardUsd) + "</td>" +
            '<td class="num">' + fmtInt(t.submissions) + "</td>" +
            "</tr>"
        )
        .join("");
    }
  }

  function renderAll() {
    applyVisibility();
    syncUrl();
    renderSankey();
    renderSwarmRadar();
    renderTrends();
    renderBreakdownsAndHeatmaps();
    renderWeeklyPosters();
    renderInsights();
    renderFeed();
  }

  function bindControls() {
    document.querySelectorAll("[data-view-tab]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const v = btn.getAttribute("data-view-tab");
        if (VALID_VIEWS.includes(v)) {
          state.view = v;
          renderAll();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });

    document.querySelectorAll("[data-chain-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.getAttribute("data-chain-btn");
        if (VALID_CHAINS.includes(c)) {
          state.chain = c;
          renderAll();
        }
      });
    });

    document.querySelectorAll("[data-range-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = btn.getAttribute("data-range-btn");
        if (VALID_RANGES.includes(r)) {
          state.range = r;
          renderAll();
        }
      });
    });

    document.querySelectorAll("[data-bucket-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = btn.getAttribute("data-bucket-btn");
        if (VALID_BUCKETS.includes(b)) {
          state.bucket = b;
          renderAll();
        }
      });
    });

    document.querySelectorAll("[data-feed-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.feedType = btn.getAttribute("data-feed-type") || "all";
        document.querySelectorAll("[data-feed-type]").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        renderFeed();
      });
    });

    const copyBtn = document.getElementById("copyViewLinkBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const url = buildShareUrl();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            const ta = document.createElement("textarea");
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          const orig = copyBtn.textContent;
          copyBtn.textContent = "Copied view link";
          setTimeout(() => {
            copyBtn.textContent = orig;
          }, 1800);
        } catch (_) {}
      });
    }

    const refreshBtn = document.getElementById("refreshDataBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        const orig = refreshBtn.textContent;
        refreshBtn.textContent = "Refreshing...";
        refreshBtn.disabled = true;
        try {
          const res = await fetch("/api/snapshot", { headers: { Accept: "application/json" } });
          if (res.ok) {
            snapshot = await res.json();
            const asofEl = document.getElementById("dataAsOfDisplay");
            if (asofEl) asofEl.textContent = "Data as of " + fmtUtcShort(snapshot.dataAsOf);
            renderAll();
          }
        } catch (_) {
        } finally {
          refreshBtn.textContent = orig;
          refreshBtn.disabled = false;
        }
      });
    }
  }

  function boot() {
    const rawEl = document.getElementById("tm-snapshot");
    if (!rawEl) return;
    try {
      snapshot = JSON.parse(rawEl.textContent || "{}");
    } catch (err) {
      console.error("[visualizer] failed to parse embedded snapshot:", err);
      return;
    }
    readInitialState();
    bindControls();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
