// Server-side data fetcher, TTL/SWR cache, and deterministic analytics engine
// for Taskmarket Live Market Visualizer (TSK-BRK611AN, MIT).
// Zero external dependencies. Strictly read-only public API calls (https://api.taskmarket.dev).
// Never attaches guessed identities to wallet addresses; never invents numbers.

import fs from "node:fs";
import path from "node:path";

export const API_BASE = (process.env.TASKMARKET_API_BASE || "https://api.taskmarket.dev").replace(/\/+$/, "");
export const CHAINS = {
  4217: { id: 4217, name: "Tempo", token: "OUSD", decimals: 6 },
  8453: { id: 8453, name: "Base", token: "USDC", decimals: 6 },
};

export const CACHE_TTL_MS = Math.max(60_000, Number(process.env.CACHE_TTL_MS || 300_000)); // >= 60s, default 5m
export const MAX_STALE_MS = Math.max(CACHE_TTL_MS, Number(process.env.MAX_STALE_MS || 3_300_000)); // <= 55m (< 1h)
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || "/tmp/taskmarket-live-snapshot.json";
const SNAPSHOT_LOAD_URL = process.env.SNAPSHOT_LOAD_URL || "";

export const UPSTREAM_ENDPOINTS = [
  "/api/market/stats?chainId=4217",
  "/api/market/stats?chainId=8453",
  "/api/stats/breakdowns?chainId=4217",
  "/api/stats/breakdowns?chainId=8453",
  "/api/stats/platform-time-series?chainId=4217&range=7d|30d|90d|all&bucket=day|week",
  "/api/stats/activity-heatmap?chainId=4217&range=7d|30d|90d|all&dimension=hourOfWeek|mode",
  "/api/stats/activity-feed?chainId=4217&limit=50",
  "/api/tasks?chainId=4217&sort=newest&limit=100&cursor=...",
  "/api/tasks?chainId=8453&sort=newest&limit=100&cursor=...",
];

let memSnapshot = null;
let inFlight = null;

export function shortAddr(addr) {
  const s = String(addr || "").trim();
  if (!s || s.length < 12) return s || "unknown";
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

export function atomicToUsd(raw) {
  try {
    const s = String(raw ?? "0").trim();
    if (!s || s === "0") return 0;
    if (/^\d+$/.test(s)) return Number(BigInt(s)) / 1e6;
    const n = Number(s);
    return Number.isFinite(n) ? n / 1e6 : 0;
  } catch {
    return 0;
  }
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function isoWeekKey(isoDateStr) {
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function weekStartDate(isoDateStr) {
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - (day - 1));
  return utc.toISOString().slice(0, 10);
}

function cleanTitle(desc, refCode) {
  const raw = String(desc || "").replace(/\r/g, "").trim();
  if (!raw) return refCode || "Untitled task";
  const firstLine = raw.split("\n").map((l) => l.trim()).find(Boolean) || raw;
  const clean = firstLine.replace(/^#+\s*/, "").replace(/\s+/g, " ");
  return clean.length > 92 ? `${clean.slice(0, 89)}...` : clean;
}

function median(nums) {
  const arr = nums.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function giniCoefficient(values) {
  const arr = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = arr.length;
  if (n === 0) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (2 * (i + 1) - n - 1) * arr[i];
  return Math.max(0, Math.min(1, weighted / (n * sum)));
}

async function fetchJson(ep, timeoutMs = 15_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${ep}`, {
      headers: { Accept: "application/json", "User-Agent": "taskmarket-live-visualizer/1.0" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${ep}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllTasksForChain(chainId, maxPages = 35) {
  const all = [];
  let cursor = null;
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const ep =
      `/api/tasks?chainId=${chainId}&sort=newest&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await fetchJson(ep, 18_000);
    const batch = Array.isArray(data?.tasks) ? data.tasks : [];
    for (const t of batch) {
      all.push({
        id: String(t.id || ""),
        ref: String(t.referenceCode || ""),
        chainId: Number(t.chainId || chainId),
        requester: String(t.requester || "").toLowerCase(),
        status: String(t.status || "unknown"),
        mode: String(t.mode || "unknown"),
        rewardAtomic: String(t.reward || "0"),
        rewardUsd: atomicToUsd(t.reward),
        createdAt: t.createdAt || null,
        expiryTime: t.expiryTime || null,
        claimedAt: t.claimedAt || null,
        claimedBy: t.claimedBy ? String(t.claimedBy).toLowerCase() : null,
        submissions: Number(t.submissionCount || 0),
        awards: Number(t.awardCount || 0),
        primaryWinner: t.primaryAward?.workerAddress ? String(t.primaryAward.workerAddress).toLowerCase() : null,
        rating: t.primaryAward?.rating != null ? Number(t.primaryAward.rating) : null,
        title: cleanTitle(t.description, t.referenceCode),
        stakeRequired: Boolean(t.stakeRequired),
        tapVerified: Array.isArray(t.verifiedBy) && t.verifiedBy.length > 0,
      });
    }
    pages++;
    if (!data?.hasMore || !data?.nextCursor || batch.length === 0) break;
    cursor = data.nextCursor;
    if (pages === maxPages) truncated = true;
  }

  // Deduplicate by task id in case a new task shifts cursor boundaries during pagination
  const seen = new Set();
  const deduped = [];
  for (const t of all) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push(t);
  }
  return { chainId, pages, truncated, tasks: deduped };
}

function classifyOutcome(status) {
  if (status === "completed") return "paid";
  if (status === "expired" || status === "cancelled") return "reclaimed";
  return "escrow";
}

function computeScopeMetrics(tasks) {
  const byStatus = {};
  const byMode = {};
  const byModeUsd = {};
  const posterStats = new Map();
  const weeklyMap = new Map();
  const dailyMap = new Map();

  let totalAtomic = 0n;
  let paidAtomic = 0n;
  let escrowAtomic = 0n;
  let reclaimedAtomic = 0n;
  let expiredCount = 0;
  let cancelledCount = 0;
  let deadZeroSubCount = 0;
  let completedCount = 0;
  let openCount = 0;
  let openWithSubsCount = 0;
  let totalSubmissions = 0;
  let bountyCount = 0;
  let bountySubs = 0;
  let totalAwards = 0;
  let topSwarm = null;

  const claimLatenciesHrs = [];
  const durationHrsByMode = {};
  const bountyRewards = [];

  for (const t of tasks) {
    const rw = BigInt(/^\d+$/.test(t.rewardAtomic) ? t.rewardAtomic : "0");
    totalAtomic += rw;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byMode[t.mode] = (byMode[t.mode] || 0) + 1;
    byModeUsd[t.mode] = (byModeUsd[t.mode] || 0n) + rw;

    const outcome = classifyOutcome(t.status);
    if (outcome === "paid") {
      paidAtomic += rw;
      completedCount++;
    } else if (outcome === "reclaimed") {
      reclaimedAtomic += rw;
      if (t.status === "expired") expiredCount++;
      if (t.status === "cancelled") cancelledCount++;
      if (t.submissions === 0) deadZeroSubCount++;
    } else {
      escrowAtomic += rw;
      if (t.status === "open") {
        openCount++;
        if (t.submissions > 0) openWithSubsCount++;
      }
    }

    totalSubmissions += t.submissions;
    totalAwards += t.awards;
    if (t.mode === "bounty") {
      bountyCount++;
      bountySubs += t.submissions;
      if (t.rewardUsd > 0) bountyRewards.push(t.rewardUsd);
    }
    if (!topSwarm || t.submissions > topSwarm.submissions) {
      topSwarm = {
        ref: t.ref,
        chainId: t.chainId,
        title: t.title,
        status: t.status,
        mode: t.mode,
        rewardUsd: round2(t.rewardUsd),
        submissions: t.submissions,
        awards: t.awards,
      };
    }

    if (t.requester) {
      let ps = posterStats.get(t.requester);
      if (!ps) {
        ps = { addr: t.requester, tasks: 0, atomic: 0n, completed: 0, dead: 0, byMode: {} };
        posterStats.set(t.requester, ps);
      }
      ps.tasks++;
      ps.atomic += rw;
      if (outcome === "paid") ps.completed++;
      if (outcome === "reclaimed") ps.dead++;
      ps.byMode[t.mode] = (ps.byMode[t.mode] || 0n) + rw;
    }

    if (t.createdAt) {
      const wk = isoWeekKey(t.createdAt);
      const ws = weekStartDate(t.createdAt);
      if (wk && ws) {
        let wRec = weeklyMap.get(wk);
        if (!wRec) {
          wRec = { week: wk, weekStart: ws, posters: new Set(), tasks: 0, atomic: 0n, paidAtomic: 0n, completed: 0 };
          weeklyMap.set(wk, wRec);
        }
        if (t.requester) wRec.posters.add(t.requester);
        wRec.tasks++;
        wRec.atomic += rw;
        if (outcome === "paid") {
          wRec.paidAtomic += rw;
          wRec.completed++;
        }
      }

      const dayKey = String(t.createdAt).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        let dRec = dailyMap.get(dayKey);
        if (!dRec) {
          dRec = { bucket: dayKey, tasksCreated: 0, rewardAtomic: 0n, paidAtomic: 0n, completedTasks: 0, posters: new Set() };
          dailyMap.set(dayKey, dRec);
        }
        dRec.tasksCreated++;
        dRec.rewardAtomic += rw;
        if (outcome === "paid") {
          dRec.paidAtomic += rw;
          dRec.completedTasks++;
        }
        if (t.requester) dRec.posters.add(t.requester);
      }

      const cMs = Date.parse(t.createdAt);
      if (t.claimedAt) {
        const clMs = Date.parse(t.claimedAt);
        if (Number.isFinite(cMs) && Number.isFinite(clMs) && clMs >= cMs) {
          claimLatenciesHrs.push((clMs - cMs) / 3_600_000);
        }
      }
      if (t.expiryTime) {
        const exMs = Date.parse(t.expiryTime);
        if (Number.isFinite(cMs) && Number.isFinite(exMs) && exMs > cMs) {
          const hrs = (exMs - cMs) / 3_600_000;
          if (!durationHrsByMode[t.mode]) durationHrsByMode[t.mode] = [];
          durationHrsByMode[t.mode].push(hrs);
        }
      }
    }
  }

  // Distinct weekly posters sorted chronologically
  const weeklyPosters = [...weeklyMap.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((w) => ({
      week: w.week,
      weekStart: w.weekStart,
      distinctPosters: w.posters.size,
      tasks: w.tasks,
      rewardUsd: round2(Number(w.atomic) / 1e6),
      paidUsd: round2(Number(w.paidAtomic) / 1e6),
      completed: w.completed,
    }));

  const dailySeries = [...dailyMap.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((d) => ({
      bucket: d.bucket,
      tasksCreated: d.tasksCreated,
      rewardUsd: round2(Number(d.rewardAtomic) / 1e6),
      paidUsd: round2(Number(d.paidAtomic) / 1e6),
      completedTasks: d.completedTasks,
      distinctPosters: d.posters.size,
    }));

  // Poster concentration & Capital Flow Sankey (Top 6 posters by USD + Other)
  const sortedPosters = [...posterStats.values()].sort((a, b) => (b.atomic > a.atomic ? 1 : b.atomic < a.atomic ? -1 : b.tasks - a.tasks));
  const totalUsd = Number(totalAtomic) / 1e6;
  const top1Usd = sortedPosters.slice(0, 1).reduce((s, p) => s + Number(p.atomic) / 1e6, 0);
  const top3Usd = sortedPosters.slice(0, 3).reduce((s, p) => s + Number(p.atomic) / 1e6, 0);
  const top5Usd = sortedPosters.slice(0, 5).reduce((s, p) => s + Number(p.atomic) / 1e6, 0);
  const top3Tasks = sortedPosters.slice(0, 3).reduce((s, p) => s + p.tasks, 0);

  const topPosters = sortedPosters.slice(0, 6);
  const otherPosters = sortedPosters.slice(6);
  const posterNodes = topPosters.map((p, idx) => ({
    id: `p_${idx}`,
    label: shortAddr(p.addr),
    fullAddr: p.addr,
    usd: round2(Number(p.atomic) / 1e6),
    tasks: p.tasks,
    completed: p.completed,
    dead: p.dead,
  }));
  if (otherPosters.length > 0) {
    const oAtomic = otherPosters.reduce((s, p) => s + p.atomic, 0n);
    const oTasks = otherPosters.reduce((s, p) => s + p.tasks, 0);
    const oComp = otherPosters.reduce((s, p) => s + p.completed, 0);
    const oDead = otherPosters.reduce((s, p) => s + p.dead, 0);
    posterNodes.push({
      id: "p_other",
      label: `Other (${otherPosters.length} wallets)`,
      fullAddr: null,
      usd: round2(Number(oAtomic) / 1e6),
      tasks: oTasks,
      completed: oComp,
      dead: oDead,
    });
  }

  const modeOrder = ["bounty", "claim", "benchmark", "pitch", "auction"];
  const modeNodes = modeOrder
    .filter((m) => (byMode[m] || 0) > 0)
    .map((m) => ({
      id: `m_${m}`,
      mode: m,
      label: m.charAt(0).toUpperCase() + m.slice(1),
      usd: round2(Number(byModeUsd[m] || 0n) / 1e6),
      tasks: byMode[m] || 0,
    }));

  const outcomeNodes = [
    { id: "o_paid", key: "paid", label: "Paid to winners", usd: round2(Number(paidAtomic) / 1e6), tasks: completedCount },
    { id: "o_escrow", key: "escrow", label: "Held in active escrow", usd: round2(Number(escrowAtomic) / 1e6), tasks: tasks.length - completedCount - expiredCount - cancelledCount },
    { id: "o_reclaimed", key: "reclaimed", label: "Expired or cancelled", usd: round2(Number(reclaimedAtomic) / 1e6), tasks: expiredCount + cancelledCount },
  ].filter((o) => o.tasks > 0 || o.usd > 0);

  // Links: Poster -> Mode
  const pmLinks = [];
  topPosters.forEach((p, idx) => {
    for (const [m, amt] of Object.entries(p.byMode)) {
      if (amt > 0n) pmLinks.push({ source: `p_${idx}`, target: `m_${m}`, usd: round2(Number(amt) / 1e6) });
    }
  });
  if (otherPosters.length > 0) {
    const otherByMode = {};
    for (const p of otherPosters) {
      for (const [m, amt] of Object.entries(p.byMode)) {
        otherByMode[m] = (otherByMode[m] || 0n) + amt;
      }
    }
    for (const [m, amt] of Object.entries(otherByMode)) {
      if (amt > 0n) pmLinks.push({ source: "p_other", target: `m_${m}`, usd: round2(Number(amt) / 1e6) });
    }
  }

  // Links: Mode -> Outcome
  const moMap = new Map();
  for (const t of tasks) {
    const rw = BigInt(/^\d+$/.test(t.rewardAtomic) ? t.rewardAtomic : "0");
    const outKey = classifyOutcome(t.status);
    const k = `m_${t.mode}|o_${outKey}`;
    const cur = moMap.get(k) || { source: `m_${t.mode}`, target: `o_${outKey}`, atomic: 0n, tasks: 0 };
    cur.atomic += rw;
    cur.tasks++;
    moMap.set(k, cur);
  }
  const moLinks = [...moMap.values()]
    .filter((x) => x.atomic > 0n)
    .map((x) => ({ source: x.source, target: x.target, usd: round2(Number(x.atomic) / 1e6), tasks: x.tasks }));

  // Swarm Convergence Radar: top 60 informative tasks (highest submissions + highest reward + open opportunities)
  const bySubs = [...tasks].sort((a, b) => b.submissions - a.submissions || b.rewardUsd - a.rewardUsd).slice(0, 35);
  const byReward = [...tasks].sort((a, b) => b.rewardUsd - a.rewardUsd).slice(0, 25);
  const openZero = tasks.filter((t) => t.status === "open" && t.submissions === 0).sort((a, b) => b.rewardUsd - a.rewardUsd).slice(0, 15);
  const radarSeen = new Set();
  const swarmPoints = [];
  for (const t of [...bySubs, ...byReward, ...openZero]) {
    if (radarSeen.has(t.id) || swarmPoints.length >= 65) continue;
    radarSeen.add(t.id);
    swarmPoints.push({
      ref: t.ref,
      id: t.id,
      chainId: t.chainId,
      title: t.title,
      status: t.status,
      mode: t.mode,
      rewardUsd: round2(t.rewardUsd),
      submissions: t.submissions,
      awards: t.awards,
      requester: shortAddr(t.requester),
      createdAt: t.createdAt,
      tapVerified: t.tapVerified,
    });
  }

  const deadCount = expiredCount + cancelledCount;
  const medianWindowByMode = {};
  for (const [m, arr] of Object.entries(durationHrsByMode)) {
    const med = median(arr);
    if (med != null) medianWindowByMode[m] = round2(med);
  }

  const recentTasks = [...tasks]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 15)
    .map((t) => ({
      ref: t.ref,
      id: t.id,
      chainId: t.chainId,
      title: t.title,
      status: t.status,
      mode: t.mode,
      rewardUsd: round2(t.rewardUsd),
      submissions: t.submissions,
      requester: shortAddr(t.requester),
      createdAt: t.createdAt,
    }));

  return {
    totalTasks: tasks.length,
    uniquePosters: posterStats.size,
    totalVolumeUsd: round2(totalUsd),
    paidVolumeUsd: round2(Number(paidAtomic) / 1e6),
    escrowVolumeUsd: round2(Number(escrowAtomic) / 1e6),
    reclaimedVolumeUsd: round2(Number(reclaimedAtomic) / 1e6),
    byStatus: Object.entries(byStatus)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byMode: Object.entries(byMode)
      .map(([mode, count]) => ({ mode, count, usd: round2(Number(byModeUsd[mode] || 0n) / 1e6) }))
      .sort((a, b) => b.count - a.count),
    weeklyPosters,
    dailySeries,
    recentTasks,
    capitalFlow: {
      totalUsd: round2(totalUsd),
      posters: posterNodes,
      modes: modeNodes,
      outcomes: outcomeNodes,
      links: [...pmLinks, ...moLinks],
    },
    swarmPoints,
    insights: {
      uniquePosters: posterStats.size,
      tasksPerPoster: posterStats.size > 0 ? round2(tasks.length / posterStats.size) : 0,
      top1ShareVolPct: totalUsd > 0 ? round2((top1Usd / totalUsd) * 100) : 0,
      top3ShareVolPct: totalUsd > 0 ? round2((top3Usd / totalUsd) * 100) : 0,
      top5ShareVolPct: totalUsd > 0 ? round2((top5Usd / totalUsd) * 100) : 0,
      top3ShareTasksPct: tasks.length > 0 ? round2((top3Tasks / tasks.length) * 100) : 0,
      giniVolume: round2(giniCoefficient(sortedPosters.map((p) => Number(p.atomic) / 1e6))),
      completedCount,
      completionRatePct: tasks.length > 0 ? round2((completedCount / tasks.length) * 100) : 0,
      expiredCount,
      cancelledCount,
      deadCount,
      deadPct: tasks.length > 0 ? round2((deadCount / tasks.length) * 100) : 0,
      deadUsd: round2(Number(reclaimedAtomic) / 1e6),
      deadZeroSubCount,
      deadZeroSubPct: deadCount > 0 ? round2((deadZeroSubCount / deadCount) * 100) : 0,
      openCount,
      openWithSubsCount,
      openCompetitionPct: openCount > 0 ? round2((openWithSubsCount / openCount) * 100) : 0,
      totalSubmissions,
      avgSubsPerBounty: bountyCount > 0 ? round2(bountySubs / bountyCount) : 0,
      medianBountyUsd: median(bountyRewards) != null ? round2(median(bountyRewards)) : 0,
      totalAwards,
      medianClaimHours: median(claimLatenciesHrs) != null ? round2(median(claimLatenciesHrs)) : null,
      claimSampleSize: claimLatenciesHrs.length,
      medianWindowHoursByMode: medianWindowByMode,
      topSwarm,
      topPostersTable: sortedPosters.slice(0, 8).map((p) => ({
        addr: shortAddr(p.addr),
        tasks: p.tasks,
        usd: round2(Number(p.atomic) / 1e6),
        shareUsdPct: totalUsd > 0 ? round2((Number(p.atomic) / 1e6 / totalUsd) * 100) : 0,
        completed: p.completed,
        dead: p.dead,
      })),
    },
  };
}

function normalizeTimeSeries(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((row) => ({
    bucket: String(row.bucket || ""),
    tasksCreated: Number(row.tasksCreated || 0),
    completedTasks: Number(row.completedTasks || 0),
    newAgents: Number(row.newAgents || 0),
    activeAgents: Number(row.activeAgents || 0),
    rewardAtomic: String(row.rewardVolume || "0"),
    rewardUsd: round2(atomicToUsd(row.rewardVolume)),
    paidAtomic: String(row.paidVolume || "0"),
    paidUsd: round2(atomicToUsd(row.paidVolume)),
    settlements: Number(row.settlements || 0),
    ratings: Number(row.ratings || 0),
  }));
}

function computeMomentum(series30d) {
  // Exclude today's partial UTC bucket if present so WoW compares two full 7-day periods cleanly
  if (!Array.isArray(series30d) || series30d.length < 15) return null;
  const complete = series30d.slice(0, -1);
  const curr = complete.slice(-7);
  const prev = complete.slice(-14, -7);
  const sum = (list, key) => list.reduce((s, x) => s + Number(x[key] || 0), 0);
  const avg = (list, key) => (list.length ? sum(list, key) / list.length : 0);
  const pct = (c, p) => (p > 0 ? round2(((c - p) / p) * 100) : null);

  const currTasks = sum(curr, "tasksCreated");
  const prevTasks = sum(prev, "tasksCreated");
  const currPaid = round2(sum(curr, "paidUsd"));
  const prevPaid = round2(sum(prev, "paidUsd"));
  const currReward = round2(sum(curr, "rewardUsd"));
  const prevReward = round2(sum(prev, "rewardUsd"));
  const currAgents = round2(avg(curr, "activeAgents"));
  const prevAgents = round2(avg(prev, "activeAgents"));
  const currSettle = sum(curr, "settlements");
  const prevSettle = sum(prev, "settlements");

  return {
    windowCurrent: `${curr[0]?.bucket} to ${curr[curr.length - 1]?.bucket}`,
    windowPrior: `${prev[0]?.bucket} to ${prev[prev.length - 1]?.bucket}`,
    tasksCreated: { current: currTasks, prior: prevTasks, deltaPct: pct(currTasks, prevTasks) },
    rewardUsd: { current: currReward, prior: prevReward, deltaPct: pct(currReward, prevReward) },
    paidUsd: { current: currPaid, prior: prevPaid, deltaPct: pct(currPaid, prevPaid) },
    avgDailyActiveAgents: { current: currAgents, prior: prevAgents, deltaPct: pct(currAgents, prevAgents) },
    settlements: { current: currSettle, prior: prevSettle, deltaPct: pct(currSettle, prevSettle) },
  };
}

export async function buildFreshSnapshot() {
  const startedAt = Date.now();
  const [
    stats4217,
    stats8453,
    bd4217,
    bd8453,
    ts7dDay,
    ts30dDay,
    ts90dDay,
    tsAllDay,
    ts7dWeek,
    ts30dWeek,
    ts90dWeek,
    tsAllWeek,
    hm7dHour,
    hm30dHour,
    hm90dHour,
    hmAllHour,
    hm7dMode,
    hm30dMode,
    hm90dMode,
    hmAllMode,
    feedRaw,
    tasks4217Res,
    tasks8453Res,
  ] = await Promise.all([
    fetchJson("/api/market/stats?chainId=4217"),
    fetchJson("/api/market/stats?chainId=8453"),
    fetchJson("/api/stats/breakdowns?chainId=4217"),
    fetchJson("/api/stats/breakdowns?chainId=8453"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=7d&bucket=day"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=30d&bucket=day"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=90d&bucket=day"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=all&bucket=day"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=7d&bucket=week"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=30d&bucket=week"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=90d&bucket=week"),
    fetchJson("/api/stats/platform-time-series?chainId=4217&range=all&bucket=week"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=7d&dimension=hourOfWeek"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=30d&dimension=hourOfWeek"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=90d&dimension=hourOfWeek"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=all&dimension=hourOfWeek"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=7d&dimension=mode"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=30d&dimension=mode"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=90d&dimension=mode"),
    fetchJson("/api/stats/activity-heatmap?chainId=4217&range=all&dimension=mode"),
    fetchJson("/api/stats/activity-feed?chainId=4217&limit=50"),
    fetchAllTasksForChain(4217),
    fetchAllTasksForChain(8453),
  ]);

  const dataAsOf = new Date().toISOString();
  const allTasks = [...tasks4217Res.tasks, ...tasks8453Res.tasks];

  const scopeAll = computeScopeMetrics(allTasks);
  const scope4217 = computeScopeMetrics(tasks4217Res.tasks);
  const scope8453 = computeScopeMetrics(tasks8453Res.tasks);

  const norm30dDay = normalizeTimeSeries(ts30dDay);
  const momentum = computeMomentum(norm30dDay);

  const feedItems = (Array.isArray(feedRaw?.items) ? feedRaw.items : []).map((it) => ({
    type: String(it.type || "event"),
    timestamp: it.timestamp || null,
    taskId: String(it.taskId || ""),
    taskTitle: cleanTitle(it.taskTitle, ""),
    chainId: Number(it.chainId || 4217),
    actor: shortAddr(it.actor),
    actorType: String(it.actorType || "agent"),
    amountUsd: it.amount != null ? round2(atomicToUsd(it.amount)) : null,
    rating: it.rating != null ? Number(it.rating) : null,
  }));

  const snapshot = {
    version: "1.0.0",
    dataAsOf,
    fetchedMs: Date.now() - startedAt,
    apiBase: API_BASE,
    endpointsUsed: UPSTREAM_ENDPOINTS,
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    headline: {
      // Exact unmodified upstream values for instant 5-number audit verification
      raw: {
        4217: stats4217,
        8453: stats8453,
      },
      platform: {
        registeredWorkers: Number(stats4217.registeredWorkers || 0),
        activeWorkers7d: Number(stats4217.activeWorkers7d || 0),
        activeAgents7d: Number(stats4217.activeAgents7d || 0),
        openTasks: Number(stats4217.openTasks || 0),
      },
      byChain: {
        4217: {
          chainId: 4217,
          name: "Tempo",
          token: "OUSD",
          paidWorkers: Number(stats4217.paidWorkers || 0),
          activeWallets: Number(stats4217.activeWallets || 0),
          totalTasks: scope4217.totalTasks,
          openTasksFromList: scope4217.insights.openCount,
          completedTasks: scope4217.insights.completedCount,
          totalVolumeUsd: scope4217.totalVolumeUsd,
          paidVolumeUsd: scope4217.paidVolumeUsd,
          escrowVolumeUsd: scope4217.escrowVolumeUsd,
          uniquePosters: scope4217.uniquePosters,
        },
        8453: {
          chainId: 8453,
          name: "Base",
          token: "USDC",
          paidWorkers: Number(stats8453.paidWorkers || 0),
          activeWallets: Number(stats8453.activeWallets || 0),
          totalTasks: scope8453.totalTasks,
          openTasksFromList: scope8453.insights.openCount,
          completedTasks: scope8453.insights.completedCount,
          totalVolumeUsd: scope8453.totalVolumeUsd,
          paidVolumeUsd: scope8453.paidVolumeUsd,
          escrowVolumeUsd: scope8453.escrowVolumeUsd,
          uniquePosters: scope8453.uniquePosters,
        },
      },
    },
    breakdowns: {
      // Direct verbatim API /api/stats/breakdowns (platform-wide)
      platform: bd4217,
      raw8453Same: JSON.stringify(bd4217) === JSON.stringify(bd8453),
    },
    platformTimeSeries: {
      day: {
        "7d": normalizeTimeSeries(ts7dDay),
        "30d": norm30dDay,
        "90d": normalizeTimeSeries(ts90dDay),
        all: normalizeTimeSeries(tsAllDay),
      },
      week: {
        "7d": normalizeTimeSeries(ts7dWeek),
        "30d": normalizeTimeSeries(ts30dWeek),
        "90d": normalizeTimeSeries(ts90dWeek),
        all: normalizeTimeSeries(tsAllWeek),
      },
    },
    heatmaps: {
      hourOfWeek: {
        "7d": hm7dHour,
        "30d": hm30dHour,
        "90d": hm90dHour,
        all: hmAllHour,
      },
      mode: {
        "7d": hm7dMode,
        "30d": hm30dMode,
        "90d": hm90dMode,
        all: hmAllMode,
      },
    },
    feed: feedItems,
    scopes: {
      all: scopeAll,
      4217: scope4217,
      8453: scope8453,
    },
    momentum,
    paginationMeta: {
      4217: { pages: tasks4217Res.pages, tasks: tasks4217Res.tasks.length, truncated: tasks4217Res.truncated },
      8453: { pages: tasks8453Res.pages, tasks: tasks8453Res.tasks.length, truncated: tasks8453Res.truncated },
    },
  };

  memSnapshot = snapshot;
  persistSnapshotBestEffort(snapshot);
  return snapshot;
}

function persistSnapshotBestEffort(snapshot) {
  try {
    const dir = path.dirname(SNAPSHOT_FILE);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot), "utf8");
  } catch {}
}

async function loadColdSnapshotBestEffort() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
      if (parsed && parsed.dataAsOf && parsed.headline && parsed.scopes) {
        return parsed;
      }
    }
  } catch {}
  if (SNAPSHOT_LOAD_URL) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3500);
      const r = await fetch(SNAPSHOT_LOAD_URL, { signal: ac.signal });
      clearTimeout(t);
      if (r.ok) {
        const parsed = await r.json();
        if (parsed && parsed.dataAsOf && parsed.headline && parsed.scopes) {
          return parsed;
        }
      }
    } catch {}
  }
  return null;
}

function triggerBackgroundRefresh() {
  if (inFlight) return inFlight;
  inFlight = buildFreshSnapshot()
    .catch((err) => {
      console.error("[snapshot] background refresh failed:", err?.message || err);
      return memSnapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function getSnapshot({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    return await triggerBackgroundRefresh();
  }

  if (!memSnapshot) {
    const cold = await loadColdSnapshotBestEffort();
    if (cold) memSnapshot = cold;
  }

  if (memSnapshot) {
    const ageMs = Date.now() - Date.parse(memSnapshot.dataAsOf || 0);
    if (Number.isFinite(ageMs) && ageMs <= CACHE_TTL_MS) {
      return memSnapshot;
    }
    if (Number.isFinite(ageMs) && ageMs <= MAX_STALE_MS) {
      // Stale-while-revalidate: serve immediately (<50ms) and refresh in background
      triggerBackgroundRefresh();
      return memSnapshot;
    }
  }

  return await triggerBackgroundRefresh();
}

export function getCachedMeta() {
  if (!memSnapshot) {
    return { cached: false, dataAsOf: null, ageMs: null };
  }
  const ageMs = Date.now() - Date.parse(memSnapshot.dataAsOf || 0);
  return {
    cached: true,
    dataAsOf: memSnapshot.dataAsOf,
    ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
  };
}
