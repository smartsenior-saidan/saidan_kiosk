// search.js — read-only search over the tenant's records.
//
// Two modes (SRS §5-2):
//   • Mode A — by section ID (区画番号): matches the `plot` field.
//   • Mode B — by name (氏名): fuzzy kana match on the reading fields.
//
// Firestore has no fuzzy/full-text search, so we fetch the tenant-scoped list
// once and rank client-side. The list is cached to localStorage so search
// still works offline (SRS §3 offline behavior / AC-8).

import { getDocs, tenantQuery, COLLECTIONS, TENANT_ID } from "./firebase.js";

// --- Kana / fuzzy matching (ported from saidan) ----------------------------

function isJapanese(str) {
  return /[぀-ヿ一-鿿豈-﫿]/.test(str);
}

const KANA_FOLD = {
  が: "か", ぎ: "き", ぐ: "く", げ: "け", ご: "こ",
  ざ: "さ", じ: "し", ず: "す", ぜ: "せ", ぞ: "そ",
  だ: "た", ぢ: "ち", づ: "つ", で: "て", ど: "と",
  ば: "は", び: "ひ", ぶ: "ふ", べ: "へ", ぼ: "ほ",
  ぱ: "は", ぴ: "ひ", ぷ: "ふ", ぺ: "へ", ぽ: "ほ",
  ゔ: "う",
  ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お",
  っ: "つ", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ",
};

function foldKana(str) {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const c = code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
    out += KANA_FOLD[c] || c;
  }
  return out;
}

function normalize(str) {
  const s = (str || "").toString().trim();
  if (isJapanese(s)) {
    return foldKana(s.replace(/[　\s]+/g, " ").trim());
  }
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function scorePerson(person, qTokens, qFull) {
  const first = normalize(person.first_name);
  const last = normalize(person.last_name);
  const firstKana = normalize(person.first_name_kana || "");
  const lastKana = normalize(person.last_name_kana || "");
  const legacyKana = normalize(person.name_kana || person.reading || "");
  const full = `${last} ${first}`.trim();
  const fullKana = `${lastKana} ${firstKana}`.trim();
  const haystack = [first, last, firstKana, lastKana, legacyKana].filter(Boolean);

  const jp = isJapanese(qFull);
  let score = 0;

  if (jp) {
    const targets = [
      ...haystack, full, normalize(`${first} ${last}`),
      fullKana, normalize(`${firstKana} ${lastKana}`),
    ].filter(Boolean);
    for (const t of targets) {
      if (t === qFull) score = Math.max(score, 10);
      else if (t.startsWith(qFull)) score = Math.max(score, 7);
    }
    if (!qFull.includes(" ")) {
      const qCompact = qFull.replace(/\s+/g, "");
      for (const t of targets) {
        const tCompact = t.replace(/\s+/g, "");
        if (!tCompact || tCompact === t) continue;
        if (tCompact === qCompact) score = Math.max(score, 10);
        else if (tCompact.startsWith(qCompact)) score = Math.max(score, 7);
      }
    }
    if (qTokens.length > 1) {
      let tokenScore = 0;
      let allMatched = true;
      for (const qt of qTokens) {
        let best = 0;
        for (const ht of haystack) {
          if (ht === qt) best = Math.max(best, 4);
          else if (ht.startsWith(qt)) best = Math.max(best, 2);
        }
        if (best === 0) { allMatched = false; break; }
        tokenScore += best;
      }
      if (allMatched) score = Math.max(score, tokenScore);
    } else {
      for (const qt of qTokens) {
        for (const ht of haystack) {
          if (ht === qt) score += 4;
          else if (ht.startsWith(qt)) score += 2;
        }
      }
    }
  } else {
    if (full) {
      if (full.includes(qFull)) score += 6;
      score += similarity(full, qFull) * 4;
    }
    for (const qt of qTokens) {
      let best = 0;
      for (const ht of haystack) {
        if (ht === qt) best = Math.max(best, 5);
        else if (ht.startsWith(qt)) best = Math.max(best, 3.5);
        else if (ht.includes(qt)) best = Math.max(best, 2.5);
        else {
          const sim = similarity(ht, qt);
          if (sim >= 0.6) best = Math.max(best, sim * 3);
        }
      }
      score += best;
    }
  }
  return score;
}

function readingKey(p) {
  const last = foldKana((p.last_name_kana || p.last_name || "").trim());
  const first = foldKana((p.first_name_kana || p.first_name || "").trim());
  return `${last}　${first}`;
}

// --- Data loading (in-memory + offline localStorage cache) -----------------

let _personCache = null;
let _offline = false;

const CACHE_KEY = `columbarium_persons_${TENANT_ID}`;

/** True if the last load fell back to the offline cache. */
export function isOffline() {
  return _offline;
}

/** Fetch the tenant's records once. Falls back to localStorage when offline. */
export async function loadPersons(forceRefresh = false) {
  if (_personCache && !forceRefresh) return _personCache;
  try {
    const snap = await getDocs(tenantQuery(COLLECTIONS.persons));
    _personCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    _offline = false;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(_personCache)); } catch (_) {}
    return _personCache;
  } catch (err) {
    console.warn("[search] live fetch failed, trying offline cache:", err);
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && cached.length) {
        _personCache = cached;
        _offline = true;
        return _personCache;
      }
    } catch (_) {}
    throw err;
  }
}

// --- Public search API ------------------------------------------------------

/** Mode B — fuzzy search by name / reading. */
export async function searchByName(queryText, { maxResults = 12 } = {}) {
  const qFull = normalize(queryText);
  if (!qFull) return [];
  const qTokens = qFull.split(" ").filter(Boolean);
  const persons = await loadPersons();

  const matches = persons
    .map((p) => ({ ...p, _score: scorePerson(p, qTokens, qFull) }))
    .filter((p) => p._score > 1.2)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults);

  matches.sort((a, b) => readingKey(a).localeCompare(readingKey(b), "ja"));
  return matches;
}

/** Normalize section codes: full-width A-Z / 0-9 → half-width, uppercase, no spaces. */
function normSection(s) {
  return (s || "")
    .toString()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Mode A — search by section ID (区画番号), matched against `plot`. */
export async function searchBySection(code, { maxResults = 30 } = {}) {
  const q = normSection(code);
  if (!q) return [];
  const persons = await loadPersons();
  return persons
    .filter((p) => {
      const plot = normSection(p.plot);
      return plot && plot.startsWith(q);
    })
    .sort((a, b) =>
      (a.plot || "").localeCompare(b.plot || "", "ja", { numeric: true })
    )
    .slice(0, maxResults);
}
