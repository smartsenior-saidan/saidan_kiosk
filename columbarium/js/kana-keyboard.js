// kana-keyboard.js — on-screen hiragana keyboard + section keypad.
//
// The kana keyboard is a faithful port of the saidan kiosk's keyboard so both
// products share the exact same layout and typing behavior: full 6-row grid
// (incl. small kana), a special column (backspace, caret arrows, dakuten /
// handakuten, ー, ・), and a space bar. Styled for the columbarium theme.

const KB_ROWS = [
  ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"],
  ["い", "き", "し", "ち", "に", "ひ", "み", "ゆ", "り", "を"],
  ["う", "く", "す", "つ", "ぬ", "ふ", "む", "よ", "る", "ん"],
  ["え", "け", "せ", "て", "ね", "へ", "め", null, "れ", null],
  ["お", "こ", "そ", "と", "の", "ほ", "も", null, "ろ", null],
  ["ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゃ", "ゅ", "ょ", "っ", "ゎ"],
];

const KB_SPECIAL = [
  { type: "action", action: "bs", label: "⌫" },
  { type: "empty" },
  { type: "action", action: "left", label: "←" },
  { type: "action", action: "right", label: "→" },
  { type: "action", action: "dakuten", label: "゛" },
  { type: "action", action: "handakuten", label: "゜" },
  { type: "char", char: "ー", label: "ー" },
  { type: "char", char: "・", label: "・" },
];

const DAKUTEN_MAP = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
  う: "ゔ",
};
const HANDAKUTEN_MAP = { は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ" };

/**
 * Build the kana keyboard inside `root` and wire it to `input`.
 * @param {object} opts
 * @param {HTMLElement} opts.root   container (JS fills it with main + special + space)
 * @param {HTMLInputElement} opts.input  the search field to type into
 */
export function mountKanaKeyboard({ root, input }) {
  root.innerHTML = "";
  root.classList.add("kb");

  const rows = document.createElement("div");
  rows.className = "kb-rows";

  // Main character grid (6 rows × 10 cols).
  const main = document.createElement("div");
  main.className = "kb-main";
  main.style.gridTemplateColumns = `repeat(${KB_ROWS[0].length}, 1fr)`;
  main.style.gridTemplateRows = `repeat(${KB_ROWS.length}, 1fr)`;
  KB_ROWS.forEach((row) =>
    row.forEach((ch) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = ch ? "kb-key" : "kb-key kb-empty";
      if (ch) {
        b.textContent = ch;
        b.dataset.char = ch;
      } else {
        b.disabled = true;
      }
      main.appendChild(b);
    })
  );

  // Special column (backspace, caret arrows, dakuten/handakuten, ー, ・).
  const special = document.createElement("div");
  special.className = "kb-special";
  KB_SPECIAL.forEach((spec) => {
    const b = document.createElement("button");
    b.type = "button";
    if (spec.type === "empty") {
      b.className = "kb-key kb-empty";
      b.disabled = true;
    } else if (spec.type === "action") {
      b.className = "kb-key kb-action";
      b.textContent = spec.label;
      b.dataset.action = spec.action;
    } else {
      b.className = "kb-key";
      b.textContent = spec.label;
      b.dataset.char = spec.char;
    }
    special.appendChild(b);
  });

  rows.appendChild(main);
  rows.appendChild(special);

  const space = document.createElement("button");
  space.type = "button";
  space.className = "kb-space";
  space.textContent = "スペース";

  root.appendChild(rows);
  root.appendChild(space);

  // ── Input handling (caret-aware) ──────────────────────────────────────────
  const caret = () =>
    typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const setCaret = (p) => { try { input.setSelectionRange(p, p); } catch (_) {} };
  const fire = () => input.dispatchEvent(new Event("input", { bubbles: true }));

  function handle(e) {
    const btn = e.target.closest("[data-char],[data-action]");
    if (!btn) return;
    const ch = btn.dataset.char;
    const action = btn.dataset.action;
    const val = input.value;
    const pos = caret();

    if (ch) {
      input.value = val.slice(0, pos) + ch + val.slice(pos);
      setCaret(pos + 1);
    } else if (action === "dakuten" || action === "handakuten") {
      const map = action === "dakuten" ? DAKUTEN_MAP : HANDAKUTEN_MAP;
      if (pos > 0 && map[val[pos - 1]]) {
        input.value = val.slice(0, pos - 1) + map[val[pos - 1]] + val.slice(pos);
        setCaret(pos);
      } else {
        return; // previous char can't take the mark — no-op
      }
    } else if (action === "bs") {
      if (pos > 0) {
        input.value = val.slice(0, pos - 1) + val.slice(pos);
        setCaret(pos - 1);
      }
    } else if (action === "left") {
      setCaret(Math.max(0, pos - 1));
    } else if (action === "right") {
      setCaret(Math.min(val.length, pos + 1));
    }
    fire();
  }

  main.addEventListener("click", handle);
  special.addEventListener("click", handle);
  space.addEventListener("click", () => {
    const pos = caret();
    const val = input.value;
    input.value = val.slice(0, pos) + "　" + val.slice(pos); // full-width space
    setCaret(pos + 1);
    fire();
  });
}

/**
 * Build a numeric/alphanumeric keypad for section-ID (区画番号) entry.
 * @param {object} opts
 * @param {HTMLElement} opts.mainEl  grid container
 * @param {HTMLInputElement} opts.input  the section field to type into
 */
export function mountSectionKeypad({ mainEl, input }) {
  mainEl.innerHTML = "";
  const keys = [
    "1", "2", "3", "A", "B",
    "4", "5", "6", "C", "D",
    "7", "8", "9", "E", "F",
    "-", "0", "G", "H", "bs",
  ];
  keys.forEach((k) => {
    const btn = document.createElement("button");
    btn.type = "button";
    if (k === "bs") {
      btn.className = "kp-key kp-action";
      btn.textContent = "⌫";
      btn.dataset.action = "bs";
    } else {
      btn.className = "kp-key";
      btn.textContent = k;
      btn.dataset.char = k;
    }
    mainEl.appendChild(btn);
  });

  mainEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-char],[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "bs") {
      input.value = input.value.slice(0, -1);
    } else {
      input.value += btn.dataset.char;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
