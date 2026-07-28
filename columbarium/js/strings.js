// strings.js — all UI text (Japanese), loaded at startup.
//
// SRS §3 / §5: wording must be changeable by non-engineers without a rebuild.
// The defaults below are overridden at runtime by /assets/strings.json when
// present, so client staff edit that JSON file (via remote desktop) and the
// text updates on next app restart — no code change.

export const DEFAULT_STRINGS = {
  // Welcome (STATE 1)
  welcomeTitle: "東京霊園 納骨堂",
  welcomeLead: "ご案内システム",
  welcomeGuide: "画面にふれてはじめてください",
  welcomeSub: "お名前または区画番号から、ご遺骨の場所をご案内します",

  // Search (STATE 2)
  searchHeading: "検索",
  tabSection: "区画番号でさがす",
  tabName: "お名前でさがす",
  sectionPlaceholder: "区画番号を入力",
  namePlaceholder: "お名前（ふりがな）を入力",
  searchBtn: "検索",
  clearBtn: "全消去",
  backToWelcome: "最初にもどる",
  resultsCount: "{n}件が見つかりました",
  noResults: "該当する方が見つかりませんでした。<br>別の入力でお試しください。",
  searchUnavailable: "現在検索を利用できません。",

  // Result card
  labelSection: "区画",
  labelReading: "ふりがな",
  showLocation: "場所を表示",

  // Map (STATE 3 / 4)
  mapZoomHint: "拡大するか、光っている区画にふれてください",
  mapBack: "◀ 地図にもどる",
  endBtn: "終了",

  // Status
  offlineBadge: "オフライン",
};

/** Fetch /assets/strings.json and merge over the defaults. Falls back cleanly. */
export async function loadStrings() {
  try {
    const res = await fetch("./assets/strings.json", { cache: "no-store" });
    if (!res.ok) return { ...DEFAULT_STRINGS };
    const override = await res.json();
    return { ...DEFAULT_STRINGS, ...override };
  } catch (_) {
    return { ...DEFAULT_STRINGS };
  }
}
