// usage.js — 利用状況 tab: how many visitors open each family's memorial.
//
// Ported from rem-multi's usage.html, then re-centred on VISITS. The data is
// tenants/{tid}/access_logs, one document per memorial page view written
// anonymously by the kiosk (see kiosk/js/access-log.js). Each log carries a
// `visit` id — one use of the kiosk, from the welcome screen (or a direct
// QR / NFC open) until 参拝終了 — so a visitor who opens a family, two
// memorials and the slideshow counts once. Logs are attributed to a FAMILY
// record through its member list; a person who belongs to no family record
// counts as a row of their own. Everything is aggregated on the client — the
// whole log is read once (paged, newest first) and the filters slice it.
//
// Usage level is simpler than rem-multi's, because this system holds no fee
// or contact data: 高 = viewed within a year, 中 = last view older than a
// year, 低 = never viewed since recording began.

import {
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  collection,
  tenantDoc,
  personsCollection,
  familiesCollection,
  TENANT_ID,
} from "./firebase.js?v=16";
import { t } from "./i18n.js?v=60";

// Helpers handed in by admin.js so this module shares its escaper, toast and
// kiosk-link builder instead of growing its own.
let esc = (s) => String(s ?? "");
let setStatus = () => {};
let kioskUrl = () => "";

// ── State ───────────────────────────────────────────────────────────────────

let entities = {};    // key → { key, label, kind: "family"|"individual", firstMember, missing? }
let personKey = {};   // person id → entity key
let logs = [];        // every access log, newest first; each gets ._key and ._visit
let lastAllMap = {};  // entity key → latest view date (all time)
let tableRows = [];   // what the family table currently shows (for CSV)
let periodDays = 365;
let entryFilter = "all";
let riskFilter = "all";
let selectedKey = "";
let listMode = "";
let loaded = false;
let loading = null;

const PAGE = 5000;    // Firestore returns at most 10k per query; page below that
const MAX_PAGES = 10;
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const PALETTE = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed",
                 "#db2777", "#65a30d", "#0284c7", "#ea580c", "#9333ea", "#16a34a"];
const PAGES = ["family", "profile", "slideshow"];

const $ = (id) => document.getElementById(id);
const qa = (sel) => document.querySelectorAll(sel);

// ── Time helpers (everything is JST, like the kiosk's log fields) ───────────

function todayJst() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function daysAgoJst(n) { return new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10); }
function daysBetween(dateStr) {
  const a = new Date(dateStr + "T00:00:00Z"), b = new Date(todayJst() + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}
function fmtAt(iso) {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch (_) { return iso || ""; }
}
const keyOf = (l) => l._key;
const visitOf = (l) => l._visit;
const ymOf = (l) => l.ym || (l.date || "").slice(0, 7);
const pageLabel = (page) => t(page === "family" ? "us.pageFamily" : page === "slideshow" ? "us.pageSlideshow" : "us.pageProfile");
const entryLabel = (entry) => (entry === "link" ? `<span class="usage-link-entry">${esc(t("us.entryLinkShort"))}</span>` : esc(t("us.entrySearchShort")));

// ── Data ────────────────────────────────────────────────────────────────────

async function loadData() {
  const [pSnap, fSnap] = await Promise.all([getDocs(personsCollection()), getDocs(familiesCollection())]);
  const persons = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const families = fSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nameOf = (p) => `${p.last_name || ""} ${p.first_name || ""}`.trim();

  entities = {};
  personKey = {};
  for (const f of families) {
    const members = (f.member_ids || []).filter((id) => persons.some((p) => p.id === id));
    entities[f.id] = { key: f.id, label: f.name || "—", kind: "family", firstMember: members[0] || null };
    members.forEach((id) => { personKey[id] = f.id; });
  }
  for (const p of persons) {
    if (personKey[p.id]) continue;
    const key = "p:" + p.id;
    entities[key] = { key, label: nameOf(p) || "—", kind: "individual", firstMember: p.id };
    personKey[p.id] = key;
  }

  logs = [];
  try {
    const col = collection(tenantDoc(), "access_logs");
    let last = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = last
        ? query(col, orderBy("ts", "desc"), startAfter(last), limit(PAGE))
        : query(col, orderBy("ts", "desc"), limit(PAGE));
      const snap = await getDocs(q);
      snap.forEach((d) => logs.push(d.data()));
      if (snap.size < PAGE) break;
      last = snap.docs[snap.docs.length - 1];
    }
  } catch (err) {
    console.error("[usage] access_logs load failed:", err);
    setStatus(t("us.loadFailed", { msg: err.message || err }), "error");
  }
  logs.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  for (const l of logs) {
    l._key = personKey[l.person_id] || ("p:" + l.person_id);
    // Logs written before visits existed: treat each device-hour as a visit.
    l._visit = l.visit || `legacy:${l.dev}:${(l.at || "").slice(0, 13)}`;
    // A log for a profile that has since been deleted still counts — show it
    // under the name the kiosk recorded at the time.
    if (!entities[l._key]) {
      entities[l._key] = { key: l._key, label: l.name || "—", kind: "individual", firstMember: l.person_id, missing: true };
    }
  }

  const oldest = logs.length ? logs[logs.length - 1].date : "";
  $("usSince").textContent = oldest ? t("us.sinceLabel", { date: oldest }) : t("us.noLogs");
  loaded = true;
}

// ── Visits ──────────────────────────────────────────────────────────────────

/** Group logs (newest first) into visits. Each visit keeps its first log —
 *  the moment the visitor started — which is what the charts count. */
function visitsOf(ls) {
  const map = new Map();
  for (const l of ls) {
    let v = map.get(visitOf(l));
    if (!v) { v = { id: visitOf(l), logs: [], keys: new Set(), entry: l.entry, dev: l.dev, first: l, last: l }; map.set(v.id, v); }
    v.logs.push(l);
    v.keys.add(keyOf(l));
    if ((l.at || "") < (v.first.at || "")) v.first = l;
    if ((l.at || "") > (v.last.at || "")) v.last = l;
  }
  return [...map.values()];
}

// ── Usage level / last-view status ──────────────────────────────────────────

function riskOf(e) {
  const last = lastAllMap[e.key] || "";
  let level = 0;
  const reasons = [];
  if (!last) { level = 2; reasons.push(t("us.reasonNone")); }
  else if (daysBetween(last) > 365) { level = 1; reasons.push(t("us.reasonOld")); }
  return { level, icon: ["🟢", "🟡", "🔴"][level], text: [t("us.hi"), t("us.mid"), t("us.lo")][level], reasons };
}

function statusOf(lastDate) {
  if (!lastDate) return { icon: "⚪", text: t("us.noRecord"), order: 3 };
  const d = daysBetween(lastDate);
  const text = t("us.daysAgo", { n: d });
  if (d <= 90) return { icon: "🟢", text, order: 0 };
  if (d <= 365) return { icon: "🟡", text, order: 1 };
  return { icon: "🔴", text, order: 2 };
}

// ── Aggregation / drawing ───────────────────────────────────────────────────

function filteredLogs() {
  const from = periodDays ? daysAgoJst(periodDays - 1) : "";
  return logs.filter((l) => (!from || (l.date || "") >= from) && (entryFilter === "all" || l.entry === entryFilter));
}

function bars(container, values, labelsEl, labels) {
  const max = Math.max(1, ...values);
  container.innerHTML = values.map((v, i) =>
    `<div class="usage-bar" style="height:${Math.round((v / max) * 100)}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(labels ? labels[i] + ": " : "")}${v}"></div>`
  ).join("");
  if (labelsEl && labels) labelsEl.innerHTML = labels.map((l) => `<span>${esc(l)}</span>`).join("");
}

function heatColor(v, max) {
  if (!v) return "#fff";
  const tt = v / max;                      // 0..1
  const hue = Math.round(55 - 55 * tt);    // yellow (55) → red (0)
  const light = Math.round(88 - 40 * tt);  // light → dark
  return `hsl(${hue}, 90%, ${light}%)`;
}

/** Heatmap of visit STARTS by weekday × hour. */
function heatmap(table, visits) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  visits.forEach((v) => { const l = v.first; if (l.w >= 0 && l.w < 7 && l.h >= 0 && l.h < 24) grid[l.w][l.h]++; });
  const gmax = Math.max(1, ...grid.flat());
  let html = '<tr><td class="hdr"></td>' + Array.from({ length: 24 }, (_, h) => `<td class="hdr">${h}</td>`).join("") + "</tr>";
  for (let w = 0; w < 7; w++) {
    html += `<tr><td class="wd">${WD[w]}</td>` + grid[w].map((v, h) =>
      `<td style="background:${heatColor(v, gmax)};color:${v / gmax > 0.6 ? "#fff" : "#374151"}" title="${WD[w]} ${h}:00 — ${v}">${v || ""}</td>`
    ).join("") + "</tr>";
  }
  table.innerHTML = html;
}

function lastMonths(n) {
  const out = [];
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

function monthAxis() {
  let n = periodDays === 0 ? 12 : Math.max(1, Math.ceil(periodDays / 30));
  if (periodDays === 0 && logs.length) {
    const oldest = ymOf(logs[logs.length - 1]);
    const [oy, om] = oldest.split("-").map(Number);
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    n = Math.min(36, Math.max(1, (now.getUTCFullYear() - oy) * 12 + (now.getUTCMonth() + 1 - om) + 1));
  }
  return lastMonths(n);
}

/** Monthly bars of visit starts, plus the heatmap, into the given elements. */
function drawCharts(visits, barsEl, labelsEl, heatEl) {
  const months = monthAxis();
  bars(barsEl, months.map((m) => visits.filter((v) => ymOf(v.first) === m).length), labelsEl, months.map((m) => m.slice(2).replace("-", "/")));
  heatmap(heatEl, visits);
}

/** "家系図 3・墓誌 5・全員スライド 1" for a set of logs. */
function screensText(ls) {
  const counts = {};
  ls.forEach((l) => { counts[l.page] = (counts[l.page] || 0) + 1; });
  return PAGES.filter((p) => counts[p]).map((p) => `${pageLabel(p)} ${counts[p]}`).join("・") || "—";
}

function renderAll() {
  const ls = filteredLogs();
  const visits = visitsOf(ls);
  lastAllMap = {};
  logs.forEach((l) => { const k = keyOf(l); if (!lastAllMap[k] || (l.date || "") > lastAllMap[k]) lastAllMap[k] = l.date || ""; });

  $("usTileTotal").textContent = visits.length.toLocaleString();
  const famSet = new Set(ls.map(keyOf));
  const registered = Object.values(entities).filter((e) => !e.missing).length;
  $("usTileFams").textContent = famSet.size.toLocaleString();
  $("usTileFamsSub").textContent = t("us.tileFamsSub", { n: registered });
  const devVisits = {};
  visits.forEach((v) => { devVisits[v.dev] = (devVisits[v.dev] || 0) + 1; });
  $("usTileRepeat").textContent = Object.values(devVisits).filter((c) => c >= 2).length.toLocaleString();
  const allRows = buildRows(ls, true);
  $("usTileRisk").textContent = allRows.filter((r) => r.risk.level === 2).length.toLocaleString();
  $("usTileRiskSub").textContent = t("us.tileRiskSub", {
    mid: allRows.filter((r) => r.risk.level === 1).length,
    high: allRows.filter((r) => r.risk.level === 0).length,
  });

  drawCharts(visits, $("usChartMonth"), $("usChartMonthLbl"), $("usHeatmap"));

  renderTable(ls);
  if (selectedKey) renderDetail(selectedKey);
  if (listMode) renderList(listMode);
}

function buildRows(ls, ignoreFilters) {
  // Per family: distinct visits (split by entry), devices, and which screens.
  const agg = {};
  ls.forEach((l) => {
    const k = keyOf(l);
    const a = agg[k] || (agg[k] = { visits: new Set(), search: new Set(), link: new Set(), devs: new Set(), logs: [] });
    a.visits.add(visitOf(l));
    (l.entry === "link" ? a.link : a.search).add(visitOf(l));
    a.devs.add(l.dev);
    a.logs.push(l);
  });
  const q = ($("usFamFilter").value || "").replace(/[\s　]+/g, "").toLowerCase();
  const onlyViewed = $("usOnlyViewed").checked;
  return Object.values(entities)
    .filter((e) => !e.missing || agg[e.key])
    .map((e) => {
      const a = agg[e.key] || { visits: new Set(), search: new Set(), link: new Set(), devs: new Set(), logs: [] };
      return {
        key: e.key, label: e.label, kind: e.kind,
        count: a.visits.size, search: a.search.size, link: a.link.size, devs: a.devs.size,
        screens: screensText(a.logs),
        last: lastAllMap[e.key] || "", st: statusOf(lastAllMap[e.key] || ""), risk: riskOf(e),
      };
    })
    .filter((r) => ignoreFilters || !q || r.label.replace(/[\s　]+/g, "").toLowerCase().includes(q))
    .filter((r) => ignoreFilters || !onlyViewed || r.count > 0)
    .filter((r) => ignoreFilters || riskFilter === "all" || r.risk.level === Number(riskFilter))
    .sort((a, b) => b.count - a.count || b.risk.level - a.risk.level || a.label.localeCompare(b.label, "ja"));
}

function renderTable(ls) {
  tableRows = buildRows(ls, false);
  $("usFamRows").innerHTML = tableRows.map((r) => `
    <tr class="row-hit${r.key === selectedKey ? " row-sel" : ""}" data-key="${esc(r.key)}">
      <td><span class="${r.kind === "family" ? "usage-fam" : ""}">${esc(r.label)}</span>${r.kind === "individual" ? `<span class="usage-muted">${esc(t("us.individual"))}</span>` : ""}</td>
      <td class="num"><strong>${r.count}</strong></td>
      <td class="num">${r.search} / ${r.link}</td>
      <td class="num">${r.devs}</td>
      <td class="usage-muted nowrap">${esc(r.screens)}</td>
      <td title="${esc(r.st.text)}">${r.st.icon} <span class="usage-muted">${esc(r.last || "—")}</span></td>
      <td>${r.risk.icon} ${esc(r.risk.text)}</td>
      <td class="usage-muted">${esc(r.risk.reasons.join("・")) || "—"}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty-state">${esc(t("us.noFamilies"))}</td></tr>`;
}

// ── Tile detail lists ───────────────────────────────────────────────────────

function renderList(mode) {
  listMode = mode;
  const ls = filteredLogs();
  const visits = visitsOf(ls);
  qa(".us-tile").forEach((tl) => tl.classList.toggle("on", tl.dataset.list === mode));
  $("usListPanel").classList.remove("hidden");
  const th = (cols) => "<tr>" + cols.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>";
  const famLink = (k, label) => `<span class="usage-link" data-fam="${esc(k)}">${esc(label)}</span>`;
  const labelOf = (k) => entities[k]?.label || k;
  let rows = "";

  if (mode === "total") {
    // One row per visitor: when they started, how they came in, what they saw.
    const list = visits.sort((a, b) => (b.first.at || "").localeCompare(a.first.at || ""));
    $("usLpTitle").textContent = t("us.lpTotal", { n: list.length });
    $("usLpHead").innerHTML = th([t("us.colStart"), t("us.colEntry"), t("us.colFamsSeen"), t("us.colScreens"), t("us.colDev")]);
    rows = list.slice(0, 500).map((v) => `<tr>
      <td class="nowrap">${esc(fmtAt(v.first.at))}</td>
      <td>${entryLabel(v.entry)}</td>
      <td>${[...v.keys].map((k) => famLink(k, labelOf(k))).join("、")}</td>
      <td class="usage-muted nowrap">${esc(screensText(v.logs))}</td>
      <td class="usage-mono">${esc(String(v.dev || "").slice(0, 6))}</td></tr>`).join("");
  } else if (mode === "fams") {
    const agg = {};
    ls.forEach((l) => {
      const k = keyOf(l);
      const a = agg[k] || (agg[k] = { visits: new Set(), link: new Set(), last: "", devs: new Set(), logs: [] });
      a.visits.add(visitOf(l)); if (l.entry === "link") a.link.add(visitOf(l));
      if ((l.at || "") > a.last) a.last = l.at; a.devs.add(l.dev); a.logs.push(l);
    });
    const list = Object.entries(agg).sort((a, b) => b[1].visits.size - a[1].visits.size);
    $("usLpTitle").textContent = t("us.lpFams", { n: list.length });
    $("usLpHead").innerHTML = th([t("us.colFamily"), t("us.colViews"), t("us.colLinkViews"), t("us.colDevs"), t("us.colScreens"), t("us.colLast"), t("us.colFreq")]);
    rows = list.map(([k, a]) => `<tr>
      <td>${famLink(k, labelOf(k))}</td><td class="num">${a.visits.size}</td><td class="num">${a.link.size}</td><td class="num">${a.devs.size}</td>
      <td class="usage-muted nowrap">${esc(screensText(a.logs))}</td>
      <td class="nowrap">${esc(fmtAt(a.last))}</td><td>${entities[k] ? riskOf(entities[k]).icon + " " + esc(riskOf(entities[k]).text) : ""}</td></tr>`).join("");
  } else if (mode === "repeat") {
    const dv = {};
    visits.forEach((v) => {
      const d = dv[v.dev] || (dv[v.dev] = { n: 0, fams: new Set(), first: v.first.at, last: v.last.at });
      d.n++; v.keys.forEach((k) => d.fams.add(k));
      if ((v.first.at || "") < d.first) d.first = v.first.at;
      if ((v.last.at || "") > d.last) d.last = v.last.at;
    });
    const list = Object.entries(dv).filter(([, d]) => d.n >= 2).sort((a, b) => b[1].n - a[1].n);
    $("usLpTitle").textContent = t("us.lpRepeat", { n: list.length });
    $("usLpHead").innerHTML = th([t("us.colDev"), t("us.colViews"), t("us.colFamsSeen"), t("us.colFirst"), t("us.colLastShort")]);
    rows = list.map(([dev, d]) => `<tr>
      <td class="usage-mono">${esc(String(dev).slice(0, 6))}</td><td class="num">${d.n}</td>
      <td>${[...d.fams].map((k) => famLink(k, labelOf(k))).join("、")}</td>
      <td class="nowrap">${esc(fmtAt(d.first))}</td><td class="nowrap">${esc(fmtAt(d.last))}</td></tr>`).join("");
  } else if (mode === "risk") {
    const list = buildRows(ls, true).filter((r) => r.risk.level === 2);
    $("usLpTitle").textContent = t("us.lpRisk", { n: list.length });
    $("usLpHead").innerHTML = th([t("us.colFamily"), t("us.colReason"), t("us.colLast"), t("us.colViewsInPeriod")]);
    rows = list.map((r) => `<tr>
      <td>${famLink(r.key, r.label)}</td><td class="usage-danger">${esc(r.risk.reasons.join("・"))}</td>
      <td>${r.st.icon} ${esc(r.last || t("us.noRecord"))}</td><td class="num">${r.count}</td></tr>`).join("");
  }
  $("usLpRows").innerHTML = rows || `<tr><td colspan="7" class="empty-state">${esc(t("us.none"))}</td></tr>`;
  $("usListPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeList() {
  listMode = "";
  $("usListPanel").classList.add("hidden");
  qa(".us-tile").forEach((tl) => tl.classList.remove("on"));
}

// ── One family's detail ─────────────────────────────────────────────────────

function renderDetail(key) {
  const e = entities[key];
  if (!e) return;
  selectedKey = key;
  const ls = filteredLogs().filter((l) => keyOf(l) === key);
  const all = logs.filter((l) => keyOf(l) === key);
  const visits = visitsOf(ls);
  $("usDetail").classList.remove("hidden");
  $("usDTitle").textContent = e.label;
  $("usDSub").textContent = t("us.inPeriod", { n: visits.length, all: visitsOf(all).length })
    + (all.length ? "　" + t("us.lastViewed", { at: fmtAt(all[0].at) }) : "");
  const r = riskOf(e);
  $("usDRisk").innerHTML = `${esc(t("us.freqLabel"))} <strong>${r.icon} ${esc(r.text)}</strong>`
    + (r.reasons.length ? `　<span class="usage-danger">${esc(r.reasons.join("・"))}</span>` : `　<span class="usage-muted">${esc(t("us.noReason"))}</span>`);
  drawCharts(visits, $("usDMonth"), $("usDMonthLbl"), $("usDHeat"));
  $("usDRows").innerHTML = ls.slice(0, 100).map((l) => `
    <tr>
      <td class="nowrap">${esc(fmtAt(l.at))}</td>
      <td>${esc(pageLabel(l.page))} <span class="usage-muted">${esc(l.name || "")}</span></td>
      <td>${entryLabel(l.entry)}</td>
      <td class="usage-mono">${esc(String(l.dev || "").slice(0, 6))}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty-state">${esc(t("us.noViews"))}</td></tr>`;
  $("usCopyLink").disabled = !e.firstMember;
  qa("#usFamRows tr").forEach((tr) => tr.classList.toggle("row-sel", tr.dataset.key === key));
  $("usDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeDetail() {
  selectedKey = "";
  $("usDetail").classList.add("hidden");
  qa("#usFamRows tr").forEach((tr) => tr.classList.remove("row-sel"));
}

async function copyLink() {
  const e = entities[selectedKey];
  if (!e || !e.firstMember) return;
  const url = kioskUrl(e.kind === "family" ? "family.html" : "profile.html", e.firstMember);
  const btn = $("usCopyLink");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = t("us.copied");
    setTimeout(() => { btn.textContent = t("us.copyLink"); }, 1500);
  } catch (_) {
    window.prompt(t("us.copyPrompt"), url);
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function downloadCsv() {
  const head = [t("us.colFamily"), t("us.colKind"), t("us.colViews"), t("us.entrySearch"), t("us.entryLink"),
                t("us.colDevs"), t("us.colScreens"), t("us.colLast"), t("us.colFreq"), t("us.colReason")];
  const rows = tableRows.map((r) => [
    r.label, r.kind === "family" ? t("us.kindFamily") : t("us.individual"), r.count, r.search, r.link, r.devs,
    r.screens, r.last || t("us.noRecord"), r.risk.text, r.risk.reasons.join("・"),
  ]);
  const csv = "﻿" + [head, ...rows].map((cols) => cols.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `${t("us.csvName")}_${TENANT_ID}_${todayJst()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Public API ──────────────────────────────────────────────────────────────

export function initUsagePanel(deps) {
  esc = deps.esc;
  setStatus = deps.setStatus;
  kioskUrl = deps.kioskUrl;

  const pillGroup = (sel, onPick) => qa(sel).forEach((b) => b.addEventListener("click", () => {
    qa(sel).forEach((x) => x.classList.toggle("on", x === b));
    onPick(b);
  }));
  pillGroup(".us-pill[data-days]", (b) => { periodDays = Number(b.dataset.days); renderAll(); });
  pillGroup(".us-pill[data-entry]", (b) => { entryFilter = b.dataset.entry; renderAll(); });
  pillGroup(".us-pill[data-risk]", (b) => { riskFilter = b.dataset.risk; renderTable(filteredLogs()); });

  qa(".us-tile").forEach((tl) => tl.addEventListener("click", () => {
    if (listMode === tl.dataset.list) { closeList(); return; }
    renderList(tl.dataset.list);
  }));
  $("usCloseList")?.addEventListener("click", closeList);
  $("usLpRows")?.addEventListener("click", (e) => { const s = e.target.closest("[data-fam]"); if (s) renderDetail(s.dataset.fam); });
  $("usFamFilter")?.addEventListener("input", () => renderTable(filteredLogs()));
  $("usOnlyViewed")?.addEventListener("change", () => renderTable(filteredLogs()));
  $("usFamRows")?.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr) renderDetail(tr.dataset.key); });
  $("usCloseDetail")?.addEventListener("click", closeDetail);
  $("usCopyLink")?.addEventListener("click", copyLink);
  $("usCsv")?.addEventListener("click", downloadCsv);
  $("usReload")?.addEventListener("click", async () => {
    const btn = $("usReload");
    btn.disabled = true;
    try { await loadData(); renderAll(); } finally { btn.disabled = false; }
  });
}

/** Called each time the tab is opened: loads once, renders every time. */
export async function openUsagePanel() {
  if (!loaded) {
    if (!loading) loading = loadData().finally(() => { loading = null; });
    await loading;
  }
  renderAll();
}
