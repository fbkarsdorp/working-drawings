/* app.js — Working drawings: a deck on a drafting table, in pencil.
 *
 * The camera never moves. Each sheet draws its own lines and declares where the objects
 * stand; between sheets the objects travel across the table (an object on both sheets
 * moves from one place to the other; plates pass along like a conveyor). Explorations are
 * loose graphite sketches. */
(function () {
  "use strict";
  const D = window.DECK;
  const SW = 1920, SH = 1080, L = 150, R = 1770, T = 90, B = 990;

  let lang = "en";
  try { lang = localStorage.getItem("redrawn-lang") || "en"; } catch (e) { /* private mode */ }
  const tr = (o) => (o && typeof o === "object" && !Array.isArray(o) && "en" in o ? o[lang] : o);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString(lang === "nl" ? "nl-NL" : "en-GB") : n);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const pad2 = (n) => String(n).padStart(2, "0");
  const px = (n) => n + "px";
  const ROMAN = ["I", "II", "III", "IV", "V"];

  // ---------- view ----------
  const canvas = document.getElementById("c"), ctx = canvas.getContext("2d");
  const inkCanvas = document.createElement("canvas"), ictx = inkCanvas.getContext("2d");
  const stage = document.getElementById("stage");
  const view = { W: 0, H: 0, dpr: 1, scale: 1, ox: 0, oy: 0 };

  function resize() {
    view.W = innerWidth; view.H = innerHeight;
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.scale = Math.min(view.W / SW, view.H / SH);
    view.ox = (view.W - SW * view.scale) / 2; view.oy = (view.H - SH * view.scale) / 2;
    for (const c of [canvas, inkCanvas]) { c.width = Math.round(view.W * view.dpr); c.height = Math.round(view.H * view.dpr); }
    canvas.style.width = view.W + "px"; canvas.style.height = view.H + "px";
    stage.style.transform = `translate(${view.ox}px, ${view.oy}px) scale(${view.scale})`;
    Ink.makeBackgrounds(view);
  }
  const stageXf = (c) => c.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
  const fullClip = () => [0, 0, canvas.width, canvas.height];
  const toWindow = (r) => ({ left: view.ox + r.x * view.scale, top: view.oy + r.y * view.scale, width: r.w * view.scale, height: r.h * view.scale });

  // ---------- the cast ----------
  const APP = {};
  D.apps.forEach((a) => (APP[a.id] = a));
  const OBJ = { emblem: "box" }, PHASE = { emblem: 0.3 }, SEED = { emblem: 7000 };
  D.apps.forEach((a, i) => { OBJ[a.id] = a.obj; PHASE[a.id] = i * 0.7; SEED[a.id] = (i + 1) * 300; });
  const appIndex = (a) => D.apps.indexOf(a) + 1;
  const place = (key, cx, cy, s, o = {}) => ({ key, cx, cy, s, scale: o.scale || 1, delay: o.delay || 0 });

  // ---------- prints: the screenshots, printed in graphite ----------
  const imgs = {};
  for (const a of D.apps) { const im = new Image(); im.src = a.shot; imgs[a.id] = im; }
  const PR = { x: 1110, y: 630, w: 660, h: 360 };
  const prints = {};
  function printOf(a) {
    if (prints[a.id]) return prints[a.id];
    const im = imgs[a.id];
    if (!im.complete || !im.naturalWidth) return null;
    const k = 2, W = PR.w * k, H = PR.h * k;
    const sw = im.naturalWidth, sh = Math.min(im.naturalHeight, (sw * PR.h) / PR.w);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    // dark screens are lifted so they print as graphite, not as black
    x.filter = `grayscale(1) ${a.light ? "contrast(1.08)" : "brightness(1.55) contrast(0.9)"}`;
    x.drawImage(im, 0, 0, sw, sh, 0, 0, W, H);
    return (prints[a.id] = c);
  }

  // the walk-through clip, looping silently in the print frame
  function loopVideo(src) {
    const v = document.createElement("video");
    v.src = src; v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    return v;
  }
  const vcan = document.createElement("canvas"), vctx = vcan.getContext("2d");
  vcan.width = PR.w * 2; vcan.height = PR.h * 2;
  function videoPrint(v) {
    const sw = v.videoWidth, sh = Math.min(v.videoHeight, (sw * PR.h) / PR.w);
    vctx.filter = "grayscale(1) brightness(1.55) contrast(0.9)";
    vctx.drawImage(v, 0, 0, sw, sh, 0, 0, vcan.width, vcan.height);
    vctx.filter = "none";
    return vcan;
  }

  // ---------- drawing helpers ----------
  function h(tag, cls, html, style) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (style) Object.assign(e.style, style);
    return e;
  }
  function titleBlock(lines, top, maxW, maxSize, lead = 0.94, x = L) {
    const size = Math.min(maxSize, Type.fit(lines, maxW, maxSize));
    const cap = Type.shape(lines[0], size).cap;
    const base = top + cap, lh = size * lead;
    return { lines, size, base, lh, x, bottom: base + (lines.length - 1) * lh };
  }
  function drawTitle(pen, tb, f, seed) {
    tb.lines.forEach((ln, i) => Type.draw(pen, ln, tb.size, tb.x, tb.base + i * tb.lh, { f: clamp(f * (1 + tb.lines.length * 0.25) - i * 0.25), seed: seed + i * 100 }));
  }
  function rule(pen, x0, y0, x1, y1, f, seed, o = {}) {
    if (f <= 0) return;
    pen.line([x0, y0, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f], Object.assign({ kind: "rule", seed }, o));
  }
  function dashed(pen, x0, y0, x1, y1, f, seed, o = {}) {
    const L_ = Math.hypot(x1 - x0, y1 - y0) * f, dx = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0), dy = (y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0, k = 0; d < L_; d += 24, k++) { const e = Math.min(L_, d + 11); pen.line([x0 + dx * d, y0 + dy * d, x0 + dx * e, y0 + dy * e], Object.assign({ kind: "rule", seed: seed + k * 0.3 }, o)); }
  }
  function curve(pen, P, f, seed, o = {}) {
    // cubic Bézier through four points, drawn up to f
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, u = 1 - t;
      pts.push(u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]);
    }
    if (f > 0) pen.line(pts, Object.assign({ kind: "rule", seed, f }, o));
  }
  function frame(pen, x, y, w, hgt, f, seed) {
    const k = 16, g = 12, X0 = x - g, Y0 = y - g, X1 = x + w + g, Y1 = y + hgt + g, ff = (i) => clamp(f * 4 - i);
    rule(pen, X0 - k, Y0, X1 + k, Y0, ff(0), seed);
    rule(pen, X1, Y0 - k, X1, Y1 + k, ff(1), seed + 1);
    rule(pen, X1 + k, Y1, X0 - k, Y1, ff(2), seed + 2);
    rule(pen, X0, Y1 + k, X0, Y0 - k, ff(3), seed + 3);
  }
  // a hatched pencil bar: outline plus 45° hatching, cut to the rectangle
  function bar(pen, x, y, w, hgt, f, seed, acc) {
    if (f <= 0 || w <= 0) return;
    const ww = w * f, o = { acc, wob: acc ? 0.45 : 1 };
    pen.line([x, y, x + ww, y, x + ww, y + hgt, x, y + hgt], Object.assign({ kind: "rule", closed: true, seed, w: 1.1 }, o));
    for (let K = x + y + 8; K < x + ww + y + hgt; K += 8) {
      const xa = Math.max(x, K - (y + hgt)), xb = Math.min(x + ww, K - y);
      if (xb - xa > 1) pen.line([xa, K - xa, xb, K - xb], Object.assign({ kind: "hatch", seed: seed + K * 0.01 }, o));
    }
  }
  // the sheet index: one tick per sheet of the main sequence, in the label row
  const TX = 760;
  let MAIN = 11;
  function ticks(pen, f, active) {
    if (f <= 0 || active === null) return;
    for (let i = 0; i < MAIN; i++) {
      const x = TX + i * 18, on = i === active, u = clamp(f * 3 - i * 0.08);
      if (u > 0) pen.line([x, on ? 86 : 94, x, on ? 86 + 32 * u : 94 + 18 * u], { kind: "rule", w: on ? 2 : i < active ? 1.1 : 0.6, acc: on, seed: 900 + i });
    }
  }
  const labelRow = (el, left, right) => {
    el.append(h("div", "lbl a1", left, { left: px(L), top: px(T) }));
    if (right) el.append(h("div", "lbl a1 r", right, { right: px(SW - R), top: px(T) }));
  };

  // ---------- sheets ----------
  let slides = [];

  // 1 · cover
  // the take-away card: a slip of paper taped onto the sheet, with the deck's address as a
  // QR code drawn in graphite. Dark modules are filled solid (with a little wobble and grain)
  // so phones still read it from across the room.
  function qrCanvas(rows, size, seed) {
    const n = rows.length, k = 2, cv = document.createElement("canvas");
    cv.width = cv.height = size * k; cv.style.width = cv.style.height = px(size);
    const x = cv.getContext("2d"), m = (size * k) / n;
    let r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    x.fillStyle = "#26231f";
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; ) {
        if (rows[i][j] !== "1") { j++; continue; }
        let e = j; while (e < n && rows[i][e] === "1") e++;
        const j0 = (rnd() - 0.5) * 0.12, j1 = (rnd() - 0.5) * 0.12, t0 = (rnd() - 0.5) * 0.1, t1 = (rnd() - 0.5) * 0.1;
        x.globalAlpha = 0.86 + rnd() * 0.1;
        x.beginPath();
        x.moveTo((j + j0) * m, (i + t0) * m); x.lineTo((e + j1) * m, (i + t1) * m);
        x.lineTo((e + j1) * m, (i + 1 + t0) * m); x.lineTo((j + j0) * m, (i + 1 + t1) * m);
        x.closePath(); x.fill();
        j = e;
      }
    }
    // pencil grain: short light strokes across the graphite
    x.globalAlpha = 0.16; x.strokeStyle = "#f3eee2"; x.lineWidth = 1;
    for (let q = 0; q < n * n * 1.4; q++) {
      const px0 = rnd() * size * k, py0 = rnd() * size * k, l = 3 + rnd() * 5;
      x.beginPath(); x.moveTo(px0, py0); x.lineTo(px0 + l, py0 - l); x.stroke();
    }
    x.globalAlpha = 1;
    return cv;
  }
  function takeaway(x, y, w, rot, cls) {
    const c = D.share, card = h("div", "takeaway " + cls, undefined, { left: px(x), top: px(y), width: px(w) });
    card.style.setProperty("--rot", rot + "deg");
    card.append(h("span", "lbl", esc(tr(c.label))), qrCanvas(c.qr, w - 84, Math.round(x + y)), h("span", "url", `${esc(c.show)}<small>${esc(tr(c.hint))}</small>`));
    return card;
  }
  // the card is laid on the sheet last, once the pencil drawing is (nearly) done
  const reveal = (card, f, from) => card.style.setProperty("--rev", ease(clamp((f - from) / (1 - from))).toFixed(3));

  function coverSlide() {
    const c = D.cover;
    const tb = titleBlock(tr(c.big), 200, R - L, 300);
    const el = h("section", "layer ink-paper cover");
    labelRow(el, esc(tr(c.kicker)), esc(tr(c.place)));
    const col = h("div", "col", undefined, { left: px(L), top: px(tb.bottom + 64), width: px(1300) });
    col.append(h("div", "cover-title a2", esc(tr(c.title))), h("div", "cover-by a3", esc(tr(c.by))));
    const card = takeaway(1466, 340, 304, -2.2, "");
    el.append(col, card);
    const n = D.apps.length, cw = (R - L) / n;
    D.apps.forEach((a, i) => el.append(h("div", "lbl tiny a4", pad2(i + 1), { left: px(L + cw * i), width: px(cw), top: px(950), textAlign: "center" })));
    return {
      kind: "cover", el, dur: 2.6,
      objs: D.apps.map((a, i) => place(a.id, L + cw * (i + 0.5), 846, 60, { scale: 0.72, delay: 0.35 + i * 0.05 })),
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.25), 11);
        rule(pen, L, 722, R, 722, clamp(f * 2 - 0.6), 3);
        reveal(card, f, 0.82);
      },
    };
  }

  // 2 · two conversations
  function originSlide() {
    const c = D.origin;
    const tb = titleBlock(tr(c.big), 154, R - L, 180);
    const el = h("section", "layer ink-paper origin");
    labelRow(el, esc(tr(c.label)));
    const J = [1300, 640];
    const A = [[L, 520], [700, 520], [1000, 640], J], Bc = [[L, 760], [700, 760], [1000, 640], J];
    const note = (o, x, y, w, cls) => h("div", "note " + cls, `<span class="lbl">${esc(tr(o.who))}</span><span class="what">${esc(tr(o.what))}</span>`, { left: px(x), top: px(y), width: px(w) });
    el.append(note(c.a, L, 410, 1000, "a2"), note(c.b, L, 792, 1000, "a3"), note(c.meet, 1330, 760, 440, "a4"));
    return {
      kind: "origin", el, dur: 3.0,
      objs: [place("museum", 1560, 600, 118, { delay: 0.95 })],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 211);
        curve(pen, A, clamp(f * 2 - 0.35), 212);
        curve(pen, Bc, clamp(f * 2 - 0.55), 213);
        rule(pen, J[0], J[1], 1420, J[1], clamp(f * 3 - 2.0), 214, { acc: true, w: 1.4 });
        ticks(pen, f, this.sheet);
      },
    };
  }

  // the first prompt, replayed as a Claude Code session on a slip taped to the sheet: the prompt
  // is typed into the input box, sent, and Claude's real first steps scroll by while the timer
  // runs fast to the 85 minutes the turn took. Everything is driven by the time since the sheet
  // was entered, so coming back replays it.
  function promptSlide() {
    const c = D.prompt, text = c.text;
    const tb = titleBlock(tr(c.big), 154, R - L, 150);
    const el = h("section", "layer ink-paper promptsheet");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    const top = tb.bottom + 46;
    const card = h("div", "cc a2", undefined, { left: px(L), top: px(top), width: px(R - L), height: px(B - top) });
    const sc = h("div", "cc-scroll");
    const line = (cls, html) => { const d = h("div", cls, html); sc.append(d); return d; };
    line("cc-welcome", `<span class="cc-or">✻</span> Welcome to <b>Claude Code</b>!<br><span class="cc-dim">cwd: ${esc(c.cwd)}</span>`);
    const user = line("cc-user", `<span class="cc-dim">&gt;</span> ${esc(text)}`);
    const steps = c.steps.map((st) => line("cc-step", st.msg ? `<span class="cc-dot">⏺</span><span>${esc(st.msg)}</span>`
      : st.tool ? `<span class="cc-dot cc-ok">⏺</span><span class="cc-tool"><b>${esc(st.tool)}</b>(${esc(st.arg)})</span>` : `<span></span><span class="cc-dim">${esc(st.more)}</span>`));
    const spin = line("cc-spin", "");
    const input = line("cc-input", `<span class="cc-dim">&gt;</span><span class="cc-in"><span class="typed"></span><span class="cursor"></span></span>`);
    line("cc-hint cc-dim", "? for shortcuts");
    const typed = input.querySelector(".typed");
    card.append(sc);
    el.append(card);

    // typing rhythm: about 35 characters a second, uneven, with pauses after , and .
    const at = [];
    let tt = 1.0, r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < text.length; i++) {
      tt += 0.019 + rnd() * 0.016;
      const prev = text[i - 1];
      if (prev === "." || prev === "?") tt += 0.28; else if (prev === ",") tt += 0.12;
      at.push(tt);
    }
    const SENT = tt + 0.7, GO = SENT + 0.4;
    // when each step appears (seconds after GO), and the simulated clock at that moment
    const show = [0.8, 1.6, 2.6, 3.6, 4.6, 7.4];
    const simAt = (u) => {
      if (u <= 0) return 0;
      for (let i = 0; i < show.length; i++) {
        const t0 = i ? show[i - 1] : 0, s0 = i ? c.steps[i - 1].at : 0;
        if (u <= show[i]) return s0 + (c.steps[i].at - s0) * ((u - t0) / (show[i] - t0));
      }
      return c.worked;
    };
    const dur = (s) => { s = Math.floor(s); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return hh ? `${hh}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`; };
    const GLYPH = "·✢✳✶✻✽✻✶✳✢", VERB = ["Researching", "Harvesting", "Scaffolding", "Crafting", "Building"];
    let last = "";
    return {
      kind: "prompt", el, dur: 2.2, objs: [],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 301);
        ticks(pen, f, this.sheet);
        const e = now - this.enterT;
        let n = 0;
        while (n < text.length && at[n] <= e) n++;
        const sent = e >= SENT, u = e - GO, done = u >= show[show.length - 1];
        const shownSteps = sent ? show.filter((x) => u >= x).length : 0;
        const sim = simAt(u);
        const spinTxt = !sent || u < 0 ? "" : done ? `<span class="cc-or">✻</span> <span class="cc-dim">Worked for ${dur(c.worked)}</span>`
          : `<span class="cc-or">${GLYPH[Math.floor(e * 8) % GLYPH.length]} ${VERB[Math.min(VERB.length - 1, Math.floor(u / 1.6))]}…</span> <span class="cc-dim">(${dur(sim)} · esc to interrupt)</span>`;
        const sig = [n, sent, shownSteps, spinTxt].join("|");
        if (sig === last) return;
        last = sig;
        typed.textContent = sent ? "" : text.slice(0, n);
        input.classList.toggle("typing", n > 0 && !sent);
        user.classList.toggle("on", sent);
        steps.forEach((d, i) => d.classList.toggle("on", i < shownSteps));
        spin.innerHTML = spinTxt;
        spin.classList.toggle("on", !!spinTxt);
        sc.scrollTop = sc.scrollHeight; // like a terminal: fill from the top, then scroll
      },
    };
  }

  // a plate: one app, or a sheet built around one app
  function plateSlide(a, o = {}) {
    const n = appIndex(a);
    const big = o.big || a.big, tagline = o.tagline || a.tagline;
    const tb = titleBlock(tr(big), 154, 900, 168, 0.92);
    const el = h("section", "layer ink-paper plate");
    const where = h("div", "lbl a1 r where", `<i class="dot"></i>${esc(a.where)}`, { right: px(SW - R), top: px(T) });
    where.dataset.app = a.id;
    el.append(h("div", "lbl a1", o.label || `${esc(tr(D.ui.appendix))} &nbsp;·&nbsp; ${pad2(n)} / ${pad2(D.apps.length)}`, { left: px(L), top: px(T) }), where);
    const col = h("div", "col", undefined, { left: px(L), top: px(tb.bottom + 40), width: px(880) });
    col.append(h("div", "tagline a2", esc(tr(tagline))));
    if (o.body) col.append(h("div", "body a3", esc(tr(o.body))));
    if (!o.body) {
      const hrs = a.hours ? `${fmt(a.hours)} ${esc(tr(D.ui.hours))} · ${a.prompts} ${esc(tr(D.ui.prompts))}` : esc(tr(D.ui.nolog));
      col.append(h("div", "meta a3", `<div><span class="lbl">${esc(tr(D.ui.data))}</span><span>${esc(tr(a.route))}</span></div><div><span class="lbl">${esc(tr(D.ui.built))}</span><span>${hrs}</span></div>`));
    }
    el.append(col);
    el.append(h("div", "lbl source a4", `<em>${esc(tr(D.ui.source))}</em> &nbsp; ${esc(tr(a.source))}`, { left: px(L), bottom: px(SH - 792), width: px(900) }));
    const facts = h("div", "facts a4", undefined, { left: px(L), top: px(832), width: px(900) });
    for (const [num, lab] of o.facts || a.facts) { const v = String(fmt(num)); facts.append(h("div", "fact" + (v.length >= 8 ? " long" : ""), `<b>${esc(v)}</b><span>${esc(tr(lab))}</span>`)); }
    el.append(facts);
    el.append(h("div", "caption a3", `<span class="lbl">${esc(tr(D.ui.fig))} ${pad2(n)}</span><span class="cap">${esc(tr(o.fig || a.fig))}</span>`, { left: px(PR.x), top: px(550), width: px(PR.w) }));
    const hit = h("button", "printhit", "", { left: px(PR.x), top: px(PR.y), width: px(PR.w), height: px(PR.h) });
    const tag = h("button", "opentag lbl a4", esc(tr(o.clip ? D.ui.watch : D.ui.open)), { left: px(PR.x), top: px(PR.y) });
    hit.title = a.url;
    tag.dataset.app = a.id; if (o.clip) tag.dataset.walk = "1";
    hit.onclick = tag.onclick = () => present(a, PR, S);
    const S = {
      kind: "plate", el, dur: o.main ? 2.2 : 1.4, app: a, print: PR, hover: 0, hovering: false, clip: o.clip, video: o.clip ? loopVideo(o.clip) : null,
      objs: [place(a.id, 1440, 312, 180, { delay: 0.05 })],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), n * 37);
        ticks(pen, f, this.sheet);
        rule(pen, PR.x - 28, 532, R + 28, 532, clamp(f * 2 - 0.3), n * 3);
        frame(pen, PR.x, PR.y, PR.w, PR.h, clamp(f * 1.6 - 0.35), n * 11);
        rule(pen, L, 812, 1050, 812, clamp(f * 2 - 0.7), n * 5);
        for (let i = 1; i < 3; i++) rule(pen, L + i * 300 - 22, 834, L + i * 300 - 22, 980, clamp(f * 2 - 0.9), n * 5 + i);
      },
    };
    hit.onmouseenter = () => (S.hovering = true);
    hit.onmouseleave = () => (S.hovering = false);
    el.append(hit, tag);
    return S;
  }

  // 4 · the explorations, as a contact sheet
  function explorationsSlide() {
    const c = D.explorations, apps = D.apps.filter((a) => a.role === "exploration");
    const tb = titleBlock(tr(c.big), 154, R - L, 170);
    const el = h("section", "layer ink-paper contact");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    el.append(h("div", "sheet-text a2", esc(tr(c.text)), { left: px(L), top: px(tb.bottom + 30), width: px(1500) }));
    const top = 420, cols = 5, gx = (R - L) / cols, gy = (B - top) / 2;
    const objs = [];
    apps.forEach((a, i) => {
      const x = L + (i % cols) * gx, y = top + Math.floor(i / cols) * gy;
      objs.push(place(a.id, x + gx / 2, y + 54, 46, { scale: 0.64, delay: 0.3 + i * 0.06 }));
      const b = h("button", "ccell a3", `<span class="lbl">${esc(tr(a.kind))}</span><span class="ccell-name">${esc(a.short)}</span><span class="ccell-q">${esc(tr(a.shows))}</span>`, { left: px(x), top: px(y), width: px(gx), height: px(gy) });
      b.onclick = () => present(a, { x: x + 20, y: y + 20, w: gx - 40, h: gy - 40 });
      b.title = a.url;
      el.append(b);
    });
    return {
      kind: "contact", el, dur: 2.4, objs,
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 401);
        ticks(pen, f, this.sheet);
        for (let r = 0; r <= 2; r++) rule(pen, L, top + r * gy, R, top + r * gy, clamp(f * 2 - 0.3 - r * 0.1), 410 + r, { w: 0.6 });
        for (let k = 1; k < cols; k++) rule(pen, L + k * gx, top, L + k * gx, B, clamp(f * 2 - 0.5), 420 + k, { w: 0.6 });
      },
    };
  }

  // 7 · hours, not years
  function hoursSlide() {
    const c = D.hours;
    const tb = titleBlock(tr(c.big), 154, R - L, 170);
    const el = h("section", "layer ink-paper hours");
    labelRow(el, esc(tr(c.label)));
    const head = h("div", "col", undefined, { left: px(L), top: px(tb.bottom + 30), width: px(1500) });
    head.append(h("div", "sheet-text a2", esc(tr(c.sub))), h("div", "sheet-note a2", `${esc(tr(c.text))} ${esc(tr(c.note))}`, { marginTop: "14px", width: px(1400) }));
    el.append(head);
    const rows = D.apps.filter((a) => a.hours).sort((a, b) => a.hours - b.hours);
    const top = 490, rh = (B - top) / rows.length, X0 = 560, perH = 31;
    rows.forEach((a, i) => {
      const y = top + i * rh;
      el.append(h("div", "hname a3", esc(a.name), { left: px(L), top: px(y + rh / 2 - 17), width: px(X0 - L - 30) }));
      el.append(h("div", "hval a4", `${fmt(a.hours)} ${esc(tr(c.unit))}${a.hoursNote ? `<span class="lbl hnote">${esc(tr(a.hoursNote))}</span>` : ""}`, { left: px(X0 + a.hours * perH + 18), top: px(y + rh / 2 - 16) }));
      el.append(h("div", "lbl hprompts a4", `${a.prompts} ${esc(tr(c.prompts))}`, { right: px(SW - R), top: px(y + rh / 2 - 12) }));
    });
    return {
      kind: "hours", el, dur: 2.6, objs: [],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 501);
        ticks(pen, f, this.sheet);
        rule(pen, X0, top - 6, X0, B, clamp(f * 2 - 0.4), 502);
        rows.forEach((a, i) => {
          const y = top + i * rh + rh / 2 - 13;
          bar(pen, X0, y, a.hours * perH, 26, clamp(f * 1.8 - 0.5 - i * 0.07), 510 + i * 20);
        });
      },
    };
  }

  // 8 · what is scarce: from problem solving to problem setting
  function scarceSlide() {
    const c = D.scarce;
    const tb = titleBlock(tr(c.big), 154, R - L, 170);
    const el = h("section", "layer ink-paper scarce");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    const ov = c.outside;
    el.append(h("div", "outside a2", `${ov.quotes.map((q) => `<q>${esc(q)}</q>`).join(" ")}<span class="lbl">${esc(tr(ov.src))}</span>`, { left: px(L), top: px(tb.bottom + 26), width: px(R - L) }));
    el.append(h("div", "shift a3", esc(tr(c.shift)), { left: px(L), top: px(tb.bottom + 122), width: px(R - L) }));
    const top = 540, cw = (R - L) / 3;
    c.cols.forEach((col, i) => {
      const x = L + i * cw + (i ? 40 : 0);
      el.append(h("div", "scol a" + (i + 3), `<span class="lbl">${esc(col.apps)}</span><b>${esc(tr(col.head))}</b><span class="stext">${esc(tr(col.text))}</span>`, { left: px(x), top: px(top + 100), width: px(cw - 80) }));
    });
    el.append(h("div", "sfinding a5", esc(tr(c.finding)), { left: px(L), top: px(B - 50), width: px(R - L) }));
    const keyOf = (obj) => D.apps.find((a) => a.obj === obj).id;
    return {
      kind: "scarce", el, dur: 2.6,
      objs: c.cols.map((col, i) => place(keyOf(col.obj), L + i * cw + (i ? 40 : 0) + 56, top + 46, 52, { scale: 0.72, delay: 0.3 + i * 0.12 })),
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 601);
        ticks(pen, f, this.sheet);
        rule(pen, L, top - 14, R, top - 14, clamp(f * 2 - 0.4), 602);
        rule(pen, L, B - 72, R, B - 72, clamp(f * 2 - 0.8), 603);
        for (let k = 1; k < 3; k++) rule(pen, L + k * cw, top, L + k * cw, B - 88, clamp(f * 2 - 0.6), 604 + k);
      },
    };
  }

  // 9 · data is the interface
  function dataSlide() {
    const c = D.data;
    const tb = titleBlock(tr(c.big), 154, 760, 140);
    const el = h("section", "layer ink-paper data");
    labelRow(el, esc(tr(c.label)));
    const col = h("div", "col", undefined, { left: px(L), top: px(tb.bottom + 40), width: px(720) });
    col.append(h("div", "dtext a2", esc(tr(c.text))), h("div", "dfinding a3", esc(tr(c.finding))), h("div", "dalso a4", esc(tr(c.example))), h("div", "dalso a4", esc(tr(c.also))));
    el.append(col);
    el.append(h("div", "lbl legend a4", `<div>${esc(tr(c.solid))}</div><div>${esc(tr(c.dashed))}</div>`, { left: px(L), top: px(904) }));
    const C = [1345, 575], RAD = 290;
    const objs = [place("emblem", C[0], C[1], 92, { delay: 0.2 })];
    const pos = {};
    D.apps.forEach((a, i) => {
      const ang = -Math.PI / 2 + (i / D.apps.length) * Math.PI * 2, x = C[0] + Math.cos(ang) * RAD, y = C[1] + Math.sin(ang) * RAD;
      pos[a.id] = [x, y, ang];
      objs.push(place(a.id, x, y, 46, { scale: 0.62, delay: 0.4 + i * 0.04 }));
      el.append(h("div", "rname a4", esc(a.short), { left: px(x - 130), top: px(y + 50), width: px(260) }));
    });
    return {
      kind: "data", el, dur: 2.8, objs,
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 701);
        ticks(pen, f, this.sheet);
        D.apps.forEach((a, i) => {
          const [x, y, ang] = pos[a.id], dx = Math.cos(ang), dy = Math.sin(ang);
          const x0 = C[0] + dx * 105, y0 = C[1] + dy * 105, x1 = x - dx * 62, y1 = y - dy * 62;
          const fi = clamp(f * 2 - 0.7 - i * 0.04);
          if (a.solid) rule(pen, x0, y0, x1, y1, fi, 710 + i, { w: 1.2 });
          else dashed(pen, x0, y0, x1, y1, fi, 710 + i, { w: 1.2 });
        });
        rule(pen, L, 921, L + 64, 921, clamp(f * 2 - 1), 790, { w: 1.2 });
        dashed(pen, L, 961, L + 64, 961, clamp(f * 2 - 1), 791, { w: 1.2 });
      },
    };
  }

  // 10 · for the plan
  function planSlide() {
    const c = D.plan;
    const tb = titleBlock(tr(c.big), 154, 1340, 200);
    const el = h("section", "layer ink-paper plan");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    el.append(h("div", "sheet-text a2", esc(tr(c.text)), { left: px(L), top: px(tb.bottom + 30), width: px(1500) }));
    const items = tr(c.items), top = Math.max(430, tb.bottom + 120), gy = (B - top) / items.length;
    items.forEach((q, i) => el.append(h("div", "question a" + Math.min(5, i + 2), `<span class="lbl">${ROMAN[i]}</span><span>${esc(q)}</span>`, { left: px(L), top: px(top + i * gy), width: px(R - L), height: px(gy) })));
    return {
      kind: "plan", el, dur: 2.4,
      objs: [place("emblem", 1640, 250, 110, { delay: 0.2 })],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 801);
        ticks(pen, f, this.sheet);
        for (let i = 0; i <= items.length; i++) rule(pen, L, top + i * gy, R, top + i * gy, clamp(f * 2 - 0.4 - i * 0.12), 810 + i, { w: 0.6 });
      },
    };
  }

  // the deck itself: a twelfth working drawing
  function metaSlide() {
    const c = D.meta;
    const tb = titleBlock(tr(c.big), 154, 820, 170);
    const el = h("section", "layer ink-paper metasheet");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    const col = h("div", "col", undefined, { left: px(L), top: px(tb.bottom + 36), width: px(780) });
    col.append(h("div", "tagline a2", esc(tr(c.text))));
    el.append(col);
    const facts = h("div", "facts a4", undefined, { left: px(L), top: px(832), width: px(900) });
    for (const [num, lab] of c.facts) facts.append(h("div", "fact", `<b>${esc(String(fmt(num)))}</b><span>${esc(tr(lab))}</span>`));
    el.append(facts);
    const snap = h("div", "snap a3", `<img src="${esc(c.shot)}" alt="">`, { left: px(1010), top: px(300), width: px(760) });
    el.append(snap);
    return {
      kind: "meta", el, dur: 2.2, objs: [],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 1201);
        ticks(pen, f, this.sheet);
        rule(pen, L, 812, 900, 812, clamp(f * 2 - 0.7), 1202);
        for (let i = 1; i < 3; i++) rule(pen, L + i * 300 - 22, 834, L + i * 300 - 22, 980, clamp(f * 2 - 0.9), 1203 + i);
      },
    };
  }

  // 11 · thank you, for discussion
  function endSlide() {
    const c = D.end;
    const tb = titleBlock(tr(c.big), 160, 1180, 260);
    const el = h("section", "layer ink-paper end");
    labelRow(el, esc(tr(c.label)), esc(tr(c.contact)));
    const card = takeaway(1466, 156, 304, 1.8, "");
    el.append(card);
    const qs = tr(c.questions), top = 560, gy = (B - top) / qs.length;
    qs.forEach((q, i) => el.append(h("div", "question a" + (i + 2), `<span class="lbl">${ROMAN[i]}</span><span>${esc(q)}</span>`, { left: px(L), top: px(top + i * gy), width: px(R - L), height: px(gy) })));
    return {
      kind: "end", el, dur: 2.2,
      objs: [],
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 977);
        reveal(card, f, 0.8);
        ticks(pen, f, this.sheet);
        for (let i = 0; i <= qs.length; i++) rule(pen, L, top + i * gy, R, top + i * gy, clamp(f * 2 - 0.4 - i * 0.15), 60 + i, { w: 0.6 });
      },
    };
  }

  // appendix · all eleven
  const IX = { top: 390, cols: 4, rows: 3 };
  function indexSlide() {
    const c = D.index;
    const tb = titleBlock(tr(c.big), 154, 900, 170);
    const el = h("section", "layer ink-paper index");
    labelRow(el, esc(tr(c.label)), esc(tr(c.right)));
    const gx = (R - L) / IX.cols, gy = (B - IX.top) / IX.rows;
    const objs = [];
    D.apps.forEach((a, i) => {
      const x = L + (i % IX.cols) * gx, y = IX.top + Math.floor(i / IX.cols) * gy;
      objs.push(place(a.id, x + 82, y + gy / 2 + 2, 60, { scale: 0.7, delay: 0.3 + i * 0.04 }));
      const b = h("button", "icell a3", `<span class="lbl">${pad2(i + 1)}</span><span class="icell-name">${esc(a.name)}</span>`, { left: px(x), top: px(y), width: px(gx), height: px(gy) });
      b.onclick = () => go(slides.findIndex((s) => s.kind === "plate" && s.app === a && !s.main));
      b.title = a.url;
      el.append(b);
    });
    const last = h("button", "icell more a3", `<span class="lbl">←</span><span class="icell-name">${esc(tr(D.end.label))}</span>`, { left: px(L + 3 * gx), top: px(IX.top + 2 * gy), width: px(gx), height: px(gy) });
    last.onclick = () => go(slides.findIndex((s) => s.kind === "end"));
    el.append(last);
    return {
      kind: "index", el, dur: 2.0, objs,
      draw(pen, t, f) {
        drawTitle(pen, tb, clamp(f * 1.3), 901);
        for (let r = 0; r <= IX.rows; r++) rule(pen, L, IX.top + r * gy, R, IX.top + r * gy, clamp(f * 2 - 0.3 - r * 0.1), 40 + r, { w: 0.5 });
        for (let k = 1; k < IX.cols; k++) rule(pen, L + k * gx, IX.top, L + k * gx, B, clamp(f * 2 - 0.5), 50 + k, { w: 0.5 });
      },
    };
  }

  function build() {
    stage.querySelectorAll(".layer").forEach((e) => e.remove());
    const cab = D.cabinet;
    const main = [
      coverSlide(),
      originSlide(),
      promptSlide(),
      Object.assign(plateSlide(APP[cab.app], { main: true, clip: cab.clip, big: cab.big, tagline: cab.tagline, body: cab.body, facts: cab.facts, fig: cab.fig, label: esc(tr(cab.label)) }), { main: true }),
      explorationsSlide(),
      hoursSlide(),
      scarceSlide(),
      dataSlide(),
      planSlide(),
      endSlide(),
      metaSlide(),
    ];
    MAIN = main.length;
    main.forEach((s, i) => (s.sheet = i === 0 ? null : i));
    const appendix = [indexSlide(), ...D.apps.map((a) => plateSlide(a))];
    appendix.forEach((s) => (s.sheet = null));
    slides = [...main, ...appendix];
    slides.forEach((s, i) => { s.i = i; s.enterT = -1e9; s.full = new Set(); stage.append(s.el); });
    document.documentElement.lang = lang;
    paintKeys();
    paintStatus();
  }

  // ---------- rendering ----------
  let now = 0, cur = 0, trans = null, paused = false;
  const fOf = (s) => clamp((now - s.enterT) / s.dur);
  const objF = (S, p) => (S.full.has(p.key) ? 1 : clamp(fOf(S) * 1.4 - p.delay));

  function drawPrint(c, s, f) {
    if (!s.print) return;
    const p = s.print, u = clamp((f - 0.25) / 0.55);
    if (u <= 0) return;
    const v = s.video && s.video.readyState >= 2 ? s.video : null;
    const pr = v ? videoPrint(v) : printOf(s.app), im = v || imgs[s.app.id];
    if (!pr) return;
    c.save();
    c.beginPath(); c.rect(p.x, p.y, p.w, p.h * ease(u)); c.clip();
    c.globalCompositeOperation = "multiply";
    c.drawImage(pr, p.x, p.y, p.w, p.h);
    if (s.hover > 0.01) {
      // the drawing turns into the thing
      c.globalCompositeOperation = "source-over"; c.globalAlpha = s.hover;
      const sw = v ? v.videoWidth : im.naturalWidth, sh = Math.min(v ? v.videoHeight : im.naturalHeight, (sw * p.h) / p.w);
      c.drawImage(im, 0, 0, sw, sh, p.x, p.y, p.w, p.h);
    }
    c.restore();
  }

  function paint(slidesF, objs) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(Ink.bg().paper, 0, 0);
    const pen = new Ink.Pen("paper", Math.floor(now * 8), now);
    stageXf(ctx);
    for (const [s, f] of slidesF) if (f > 0) { s.draw(pen, now, f); if (!(box && box.S === s && !box.closing)) drawPrint(ctx, s, f); }
    for (const { p, f } of objs) {
      if (f <= 0) continue;
      Ink.drawObject(pen, OBJ[p.key], { cx: p.cx, cy: p.cy, s: p.s, t: now, phase: PHASE[p.key], f, scale: p.scale, seed: SEED[p.key] });
    }
    flushPaper(pen);
    ctx.restore();
  }

  // pencil onto paper: strokes on their own layer, tooth knocked out, multiplied down
  function flushPaper(pen) {
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    stageXf(ictx);
    pen.flush(ictx);
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.globalCompositeOperation = "destination-out";
    ictx.drawImage(Ink.tooth(), 0, 0);
    ictx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(inkCanvas, 0, 0);
    ctx.restore();
  }

  // ---------- the box: a clip or a live app, laid on the page as a large print ----------
  const BIG = { x: 330, y: 110, w: 1260, h: 787.5 };   // the walk (16:10)
  const LIVE = { x: 150, y: 104, w: 1620, h: 806 };    // a live app: the whole sheet
  let box = null;
  const boxui = h("div", "clipui");
  const cliphit = h("button", "cliphit", "", { left: px(BIG.x), top: px(BIG.y), width: px(BIG.w), height: px(BIG.h) });
  stage.append(cliphit, boxui);
  boxui.hidden = cliphit.hidden = true;
  // the live app sits outside the scaled stage, in real pixels, over the box
  const livewrap = h("div", "livewrap");
  livewrap.innerHTML = `<div class="minibar"><button class="shrink"></button><span class="mname"></span></div>`;
  document.body.append(livewrap);
  livewrap.hidden = true;
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const lerpR = (a, b, e) => ({ x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e) });

  function placeBox() {
    if (!box) return;
    const r = box.kind === "clip" ? BIG : LIVE;
    Object.assign(boxui.style, { left: px(r.x), top: px(r.y + r.h + (box.kind === "clip" ? 52 : 34)), width: px(r.w) });
    const w = toWindow(LIVE);
    Object.assign(livewrap.style, { left: px(w.left), top: px(w.top), width: px(w.width), height: px(w.height) });
  }
  function boxLabels() {
    const a = box.app, n = appIndex(a), clip = box.kind === "clip";
    const left = `<div class="cl"><span class="lbl">${esc(tr(D.ui.fig))} ${pad2(n)}${clip ? "a" : ""}</span><span class="cap">${esc(clip ? tr(box.cap) : a.name)}</span><span class="lbl time">${clip ? "" : esc(a.where)}</span></div>`;
    const right = clip
      ? `<div class="cr">${box.local ? "" : `<button class="lbl live">${esc(tr(D.ui.live))}</button>`}<button class="lbl back">${esc(tr(D.ui.backclip))}</button></div>${box.local ? `<div class="lbl localnote">${esc(tr(D.ui.local))}</div>` : ""}`
      : `<div class="cr"><button class="lbl full">${esc(tr(D.ui.full))}</button><button class="lbl tab">${esc(tr(D.ui.tab))}</button><button class="lbl back">${esc(tr(D.ui.backbox))}</button></div>`;
    boxui.innerHTML = left + right;
    boxui.querySelector(".back").onclick = closeBox;
    if (clip) { const lv = boxui.querySelector(".live"); if (lv) lv.onclick = boxToLive; }
    else {
      boxui.querySelector(".full").onclick = () => toggleFull(true);
      boxui.querySelector(".tab").onclick = () => window.open(a.url, "_blank");
    }
    livewrap.querySelector(".shrink").textContent = tr(D.ui.shrink);
    livewrap.querySelector(".mname").textContent = a.name;
  }
  function startLive() {
    const a = box.app, f = document.createElement("iframe");
    f.src = a.url;
    f.allow = "autoplay; fullscreen; clipboard-read; clipboard-write; gamepad; xr-spatial-tracking; accelerometer; gyroscope";
    f.setAttribute("allowfullscreen", "");
    livewrap.querySelectorAll("iframe").forEach((x) => x.remove());
    livewrap.append(f);
    livewrap.hidden = false;
    box.frame = f; box.loaded = false;
    const ready = () => { if (box && box.frame === f) box.loaded = true; };
    f.onload = () => setTimeout(ready, 350);
    setTimeout(ready, 4500);
  }
  // open an app from the page: the walk if the plate has one, the app itself if it answers,
  // and otherwise its recorded demo
  const demos = {};
  async function present(a, from, S) {
    if (box || openA) return;
    if (S && S.clip) return openBox(a, from, "clip", S);
    if (a.demo) {
      if (status[a.id] === undefined) await checkStatus(a);
      if (status[a.id] === false) {
        const v = demos[a.id] || (demos[a.id] = loopVideo(a.demo));
        return openBox(a, from, "clip", S, { video: v, cap: a.demoCap, local: true });
      }
    }
    openBox(a, from, "live", S);
  }
  function openBox(a, from, kind, S, o = {}) {
    if (box || openA) return;
    S = S || slides[cur];
    box = { app: a, S, from, kind, t0: now, closing: false, morph: null, video: o.video || S.video, cap: o.cap || D.cabinet.walk, local: !!o.local };
    if (kind === "clip") {
      const v = box.video;
      v.loop = false; v.currentTime = 0; v.play().catch(() => {});
      v.onended = () => boxui.classList.add("ended");
      cliphit.hidden = false;
    } else startLive();
    boxLabels(); placeBox();
    boxui.hidden = false; boxui.classList.remove("ended");
    requestAnimationFrame(() => boxui.classList.add("on"));
    slides[cur].el.classList.add("dim");
    slides[cur].el.classList.toggle("clear", box.local); // a recorded app: no sheet text over it
  }
  // the walk becomes the room itself, in the same place on the page
  function boxToLive() {
    if (!box || box.kind !== "clip") return;
    if (box.local) return;
    box.video.pause();
    box.kind = "live"; box.morph = now;
    cliphit.hidden = true;
    boxLabels(); placeBox(); startLive();
  }
  function toggleFull(on) {
    if (!box || box.kind !== "live") return;
    const full = on === undefined ? !livewrap.classList.contains("full") : on;
    livewrap.classList.toggle("full", full);
    paused = full;
    if (!full) placeBox();
    setTimeout(() => { try { box && box.frame.focus(); } catch (e) { /* cross-origin */ } }, 500);
  }
  livewrap.querySelector(".shrink").onclick = () => toggleFull(false);
  function closeBox() {
    if (!box || box.closing) return;
    toggleFull(false);
    box.closing = true; box.t0 = now;
    boxui.classList.remove("on");
    if (box.frame) { const f = box.frame; f.classList.remove("on"); setTimeout(() => f.remove(), 260); }
    slides[cur].el.classList.remove("dim", "clear");
    window.focus();
  }
  function finishBox() {
    if (box.video) { const v = box.video; v.onended = null; if (box.video === box.S.video) { v.loop = true; v.play().catch(() => {}); } else v.pause(); }
    if (box.frame) box.frame.remove();
    livewrap.classList.remove("full");
    paused = false;
    box = null;
    boxui.hidden = cliphit.hidden = livewrap.hidden = true;
  }
  // where the box stands now: travelling out of its print, or settled
  function boxRect(u) {
    const target = box.kind === "clip" ? BIG : LIVE;
    if (box.morph !== null) return lerpR(BIG, LIVE, ease(clamp((now - box.morph) / 0.55)));
    return lerpR(box.from, target, u);
  }
  function boxSettled() {
    return box && !box.closing && now - box.t0 > 0.7 && (box.morph === null || now - box.morph > 0.6);
  }

  function drawBox() {
    if (!box) return;
    const k = clamp((now - box.t0) / 0.65), u = box.closing ? 1 - ease(k) : ease(k);
    if (box.closing && k >= 1) { finishBox(); return; }
    const a = box.app, r = boxRect(u);
    const v = box.kind === "clip" && box.video && box.video.readyState >= 2 ? box.video : null;
    const src = v || imgs[a.id];
    ctx.save();
    // a fresh sheet laid over the page: what was drawn shows faintly through
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.9 * u;
    ctx.drawImage(Ink.bg().paper, 0, 0);
    ctx.globalAlpha = 1;
    stageXf(ctx);
    const sw = v ? v.videoWidth : src.naturalWidth, shh = v ? v.videoHeight : src.naturalHeight;
    if (sw) {
      const sh = Math.min(shh, (sw * r.h) / r.w);
      // printed onto the paper: graphite while it travels, colour once it is laid out
      ctx.globalCompositeOperation = "multiply";
      ctx.filter = u < 0.999 ? `grayscale(${1 - u}) brightness(${1 + 0.55 * (1 - u)})` : "none";
      ctx.drawImage(src, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      ctx.filter = "none";
      // a recorded app (light screens) settles into a plain, opaque picture, so the sheet
      // underneath does not show through and pale details stay readable
      if (box.local && u > 0.6) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = ease(clamp((u - 0.6) / 0.4));
        ctx.drawImage(src, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    const pen = new Ink.Pen("paper", Math.floor(now * 8), now);
    frame(pen, r.x, r.y, r.w, r.h, clamp(u * 1.5), 4100);
    if (box.kind === "clip" && u > 0.4 && v && v.duration) {
      // the timeline, drawn as a dimension line
      const fu = clamp((u - 0.4) / 0.6), ty = BIG.y + BIG.h + 30, x1 = BIG.x + BIG.w * fu;
      const at = BIG.x + BIG.w * clamp(v.currentTime / v.duration);
      rule(pen, BIG.x, ty, x1, ty, 1, 4200, { w: 0.8 });
      rule(pen, BIG.x, ty - 9, BIG.x, ty + 9, fu, 4201, { w: 0.8 });
      if (fu >= 1) rule(pen, BIG.x + BIG.w, ty - 9, BIG.x + BIG.w, ty + 9, 1, 4202, { w: 0.8 });
      if (at > BIG.x + 2) pen.line([BIG.x, ty, Math.min(at, x1), ty], { kind: "rule", acc: true, w: 1.6, seed: 4203 });
      pen.line([Math.min(at, x1), ty - 13, Math.min(at, x1), ty + 13], { kind: "rule", acc: true, w: 2.2, seed: 4204 });
      const tl = boxui.querySelector(".time");
      if (tl) tl.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration)}`;
    }
    flushPaper(pen);
    // the live app shows once it has loaded and the box has come to rest
    if (box.frame && box.loaded && boxSettled() && !box.frame.classList.contains("on")) {
      box.frame.classList.add("on");
      setTimeout(() => { try { box && box.frame.focus(); } catch (e) { /* cross-origin */ } }, 300);
    }
  }
  const lerp = (a, b, e) => a + (b - a) * e;
  const lerpP = (a, b, e) => Object.assign({}, b, { cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e), s: lerp(a.s, b.s, e), scale: lerp(a.scale, b.scale, e) });
  const shift = (p, dx) => Object.assign({}, p, { cx: p.cx + dx });

  // where every object stands at this moment of the transition
  function travel(A, S, u) {
    const e = ease(clamp(u * 1.1)), conv = trans.conveyor, dir = trans.dir;
    const inA = new Map(A.objs.map((p) => [p.key, p])), inS = new Map(S.objs.map((p) => [p.key, p]));
    const out = [];
    for (const p of A.objs) {
      if (inS.has(p.key)) out.push({ p: lerpP(p, inS.get(p.key), e), f: 1 });
      else if (conv) out.push({ p: shift(p, -dir * 1750 * e), f: 1 });
      else out.push({ p, f: clamp(1 - u * 2.2) });
    }
    for (const p of S.objs) {
      if (inA.has(p.key)) continue;
      if (conv) out.push({ p: shift(p, dir * 760 * (1 - e)), f: 1 });
      else out.push({ p, f: objF(S, p) });
    }
    return out;
  }

  const TDUR = 0.95;
  function frameLoop(ms) {
    requestAnimationFrame(frameLoop);
    now = ms / 1000;
    legend.classList.toggle("off", !!(box || openA));
    if (paused) return;
    // with a live app on the page, redraw only when the pencil moves (8 times a second)
    const tick = Math.floor(now * 8);
    if (box && box.kind === "live" && boxSettled() && !trans && tick === frameLoop.tick) return;
    frameLoop.tick = tick;
    const t0 = performance.now();
    const S = slides[cur];
    for (const s of slides) if (s.print) s.hover += ((s.hovering && s === S ? 1 : 0) - s.hover) * 0.12;
    if (!trans) paint([[S, fOf(S)]], S.objs.map((p) => ({ p, f: objF(S, p) })));
    else {
      const A = slides[trans.from], u = clamp((now - trans.t0) / TDUR);
      paint([[A, clamp(1 - u * 2.2)], [S, fOf(S)]], travel(A, S, u));
      if (u >= 1) endTrans();
    }
    drawBox();
    frameLoop.ms = (frameLoop.ms || 0) * 0.95 + 0.05 * (performance.now() - t0);
  }

  function endTrans() {
    if (!trans) return;
    slides[trans.from].el.classList.remove("on", "out");
    trans = null;
  }

  function go(i, instant) {
    i = clamp(i, 0, slides.length - 1);
    if (i === cur && !instant) return;
    if (trans) endTrans();
    if (box) { slides[cur].el.classList.remove("dim", "clear"); boxui.classList.remove("on"); finishBox(); }
    const A = slides[cur], S = slides[i], from = cur;
    cur = i;
    try { history.replaceState(null, "", "#" + i); } catch (e) { /* file:// */ }
    S.full = new Set();
    for (const s of slides) if (s.video && s !== S) s.video.pause();
    if (S.video) S.video.play().catch(() => {});
    if (instant) {
      slides.forEach((s) => s.el.classList.remove("on", "out"));
      S.el.classList.add("on"); S.enterT = now - (instant === "drawn" ? S.dur : 0);
      return;
    }
    const dir = i > from ? 1 : -1;
    const conveyor = A.kind === "plate" && S.kind === "plate";
    const keysA = new Set(A.objs.map((p) => p.key));
    for (const p of S.objs) if (conveyor || keysA.has(p.key)) S.full.add(p.key);
    trans = { from, t0: now, dir, conveyor };
    legend.classList.remove("keep");
    S.enterT = now + 0.3;
    A.el.classList.add("out"); A.el.classList.remove("on");
    setTimeout(() => { if (slides[cur] === S) S.el.classList.add("on"); }, 260);
    checkStatus(S.app);
  }

  // ---------- the viewer: a clip, or the app itself ----------
  const viewer = document.getElementById("viewer");
  let openA = null, openFrom = null, frameEl = null, ghost = null, mode = null;
  function liveFrame(a) {
    const f = document.createElement("iframe");
    f.src = a.url;
    f.allow = "autoplay; fullscreen; clipboard-read; clipboard-write; gamepad; xr-spatial-tracking; accelerometer; gyroscope";
    f.setAttribute("allowfullscreen", "");
    let shown = false;
    const show = () => {
      if (shown || openA !== a || frameEl !== f) return;
      shown = true; f.classList.add("on");
      viewer.querySelectorAll("video.clip").forEach((v) => setTimeout(() => v.remove(), 400));
      setTimeout(() => { if (openA === a) paused = true; }, 400);
    };
    f.onload = () => setTimeout(show, 350);
    setTimeout(show, 4500);
    setTimeout(() => { try { f.focus(); } catch (e) { /* cross-origin */ } }, 800);
    return f;
  }
  function openApp(a, srect, clip) {
    if (openA) return;
    openA = a; openFrom = srect || { x: 660, y: 340, w: 600, h: 400 };
    mode = clip ? "clip" : "live";
    const from = toWindow(openFrom);
    viewer.hidden = false;
    viewer.className = "ink-paper" + (clip ? " clipmode" : "");
    viewer.querySelector(".vname").textContent = a.name;
    viewer.querySelector(".vtab").href = a.url;
    viewer.querySelector(".vlive").textContent = tr(D.ui.live);
    ghost = h("div", "ghost", "", { left: px(from.left), top: px(from.top), width: px(from.width), height: px(from.height), backgroundImage: `url("${a.shot}")` });
    viewer.append(ghost);
    ghost.getBoundingClientRect();
    requestAnimationFrame(() => Object.assign(ghost.style, { left: "0px", top: "0px", width: view.W + "px", height: view.H + "px" }));
    if (clip) {
      const v = document.createElement("video");
      v.className = "clip"; v.src = clip; v.muted = true; v.playsInline = true;
      v.onplaying = () => { v.classList.add("on"); setTimeout(() => { if (openA === a && mode === "clip") paused = true; }, 400); };
      v.onended = () => viewer.classList.add("ended");
      frameEl = v;
      viewer.append(v);
      setTimeout(() => v.play().catch(() => {}), 450);
    } else {
      frameEl = liveFrame(a);
      viewer.append(frameEl);
    }
    viewer.classList.add("open");
  }
  // from the clip into the real thing
  function goLive() {
    if (!openA || mode !== "clip") return;
    mode = "live";
    viewer.classList.remove("clipmode", "ended");
    const f = liveFrame(openA);
    frameEl = f;
    viewer.append(f);
  }
  function closeApp() {
    if (!openA) return;
    const S = slides[cur], back = S.print && S.app === openA;
    const to = toWindow(openFrom);
    openA = null; paused = false; mode = null;
    viewer.querySelectorAll("iframe, video.clip").forEach((f) => { f.classList.remove("on"); if (f.pause) f.pause(); setTimeout(() => f.remove(), 260); });
    frameEl = null;
    viewer.classList.remove("open", "clipmode", "ended");
    if (back) S.hover = 1; // land in colour, then fade back into graphite
    if (ghost) {
      const g = ghost; ghost = null;
      setTimeout(() => Object.assign(g.style, { left: px(to.left), top: px(to.top), width: px(to.width), height: px(to.height), opacity: back ? 1 : 0 }), 120);
      setTimeout(() => { g.remove(); if (!openA) viewer.hidden = true; }, 760);
    }
    window.focus();
  }
  viewer.querySelector(".vback").onclick = closeApp;
  viewer.querySelector(".vlive").onclick = goLive;

  // ---------- are the apps running? ----------
  const status = {};
  // Served from a public address (not this laptop, and no ?live), apps on localhost count as
  // down without probing them: that avoids the browser's local-network permission prompt, and
  // their recorded demos play instead.
  const isLocal = (host) => host === "localhost" || host === "127.0.0.1" || host === "";
  const probeLocal = isLocal(location.hostname) || new URLSearchParams(location.search).has("live");
  async function checkStatus(a) {
    if (!a) return;
    if (!probeLocal && isLocal(new URL(a.url).hostname)) { status[a.id] = false; paintStatus(); return; }
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 3000);
    try { await fetch(a.url, { mode: "no-cors", cache: "no-store", signal: ctl.signal }); status[a.id] = true; }
    catch (e) { status[a.id] = false; }
    clearTimeout(to);
    paintStatus();
  }
  function paintStatus() {
    document.querySelectorAll(".where").forEach((e) => {
      const s = status[e.dataset.app];
      e.classList.toggle("ok", s === true); e.classList.toggle("down", s === false);
      e.title = s === false ? tr(D.ui.offline) : "";
    });
    document.querySelectorAll(".opentag").forEach((e) => {
      if (e.dataset.walk) return;
      const a = APP[e.dataset.app];
      e.textContent = tr(a && a.demo && status[a.id] === false ? D.ui.demo : D.ui.open);
    });
    const list = document.getElementById("statuslist");
    if (list) list.innerHTML = D.apps.map((a) => `<li class="${status[a.id] === true ? "ok" : status[a.id] === false ? "down" : ""}"><i class="dot"></i><b>${esc(a.name)}</b><span>${esc(a.url)}</span></li>`).join("");
  }
  const checkAll = () => D.apps.forEach(checkStatus);

  // ---------- keys ----------
  const help = document.getElementById("help");
  // the key legend (bottom right, clickable) and the key card, in the current language.
  // Visitors keep the legend in view until they turn the first sheet; when presenting it
  // shows only while the mouse moves.
  const legend = document.createElement("div");
  legend.className = "keybar" + (probeLocal ? "" : " keep");
  stage.append(legend);
  legend.onclick = (e) => { const b = e.target.closest("button"); if (b) dispatchEvent(new KeyboardEvent("keydown", { key: b.dataset.k })); };
  help.onclick = (e) => { if (e.target === help || e.target.closest(".close")) toggleHelp(false); };
  function paintKeys() {
    const K = D.keys, G = K.legend;
    legend.innerHTML = `<button data-k="ArrowLeft" class="arr" aria-label="previous">←</button><button data-k="ArrowRight" class="arr" aria-label="next">→</button><span>${esc(tr(G.sheets))}</span>`
      + `<button data-k="l"><b>L</b>${esc(tr(G.lang))}</button><button data-k="a"><b>A</b>${esc(tr(G.all))}</button><button data-k="h"><b>H</b>${esc(tr(G.help))}</button>`;
    help.querySelector(".card").innerHTML = `<div class="lbl">${esc(tr(K.title))}</div><dl>${K.rows.map(([k, d]) => `<dt>${esc(k)}</dt><dd>${esc(tr(d))}</dd>`).join("")}</dl>`
      + (probeLocal ? `<div class="lbl">${esc(tr(K.status))}</div><ul id="statuslist"></ul>` : `<p class="note">${esc(tr(K.note))}</p>`)
      + `<button class="close">${esc(tr(K.close))}</button>`;
  }
  function toggleHelp(force) {
    const on = force !== undefined ? force : help.hidden;
    help.hidden = !on;
    if (on) checkAll();
  }
  let beforeIndex = null;
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; // so Shift+A works like A (also L, H, F, I)
    if (openA) {
      if (k === "Escape") closeApp();
      else if (mode === "clip" && k === "Enter") goLive();
      else if (mode === "clip" && k === " ") { e.preventDefault(); const v = viewer.querySelector("video.clip"); if (v) v.paused ? v.play() : v.pause(); }
      return;
    }
    if (!help.hidden && (k === "Escape" || k === "h" || k === "?")) { toggleHelp(false); return; }
    if (box && !box.closing) {
      e.preventDefault();
      const full = livewrap.classList.contains("full");
      if (k === "Enter") { if (box.kind === "clip") boxToLive(); else toggleFull(); }
      else if (k === " " && box.kind === "clip") { const v = box.video; v.paused ? v.play() : v.pause(); }
      else if (k === "f" && box.kind === "live") toggleFull();
      else if (["Escape", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(k)) { if (full) toggleFull(false); else closeBox(); }
      return;
    }
    if (["ArrowRight", "PageDown", " ", "n", "ArrowDown"].includes(k)) { e.preventDefault(); go(cur + 1); }
    else if (["ArrowLeft", "PageUp", "Backspace", "ArrowUp"].includes(k)) { e.preventDefault(); go(cur - 1); }
    else if (k === "Home") go(0);
    else if (k === "End") go(slides.findIndex((s) => s.kind === "end"));
    else if (k === "Enter") { const S = slides[cur]; if (S.app) { if (e.shiftKey) window.open(S.app.url, "_blank"); else present(S.app, PR, S); } else go(cur + 1); }
    else if (k === "i" || k === "a" || k === "Tab") {
      e.preventDefault();
      const ix = slides.findIndex((s) => s.kind === "index");
      if (cur === ix && beforeIndex !== null) { go(beforeIndex); beforeIndex = null; }
      else { beforeIndex = cur; go(ix); }
    }
    else if (k === "l") { lang = lang === "en" ? "nl" : "en"; try { localStorage.setItem("redrawn-lang", lang); } catch (_) { /* */ } const c = cur; build(); go(c, "drawn"); }
    else if (k === "f") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
    else if (k === "h" || k === "?") toggleHelp();
    else if (/^[0-9]$/.test(k)) {
      const n = +k;
      if (n === 0) go(0);
      else { const a = D.apps[n - 1]; if (a) go(slides.findIndex((s) => s.kind === "plate" && s.app === a && !s.main)); }
    }
  });

  let idle;
  addEventListener("mousemove", () => { document.body.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add("idle"), 2200); });
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { resize(); placeBox(); }, 120); });

  // ---------- on a phone: point people to their laptop ----------
  function phoneNote() {
    if (Math.min(innerWidth, innerHeight) >= 560 && innerWidth >= 760) return;
    try { if (sessionStorage.getItem("wd-anyway")) return; } catch (e) { /* */ }
    let pl = lang;
    try { if (!localStorage.getItem("redrawn-lang")) pl = /^nl/i.test(navigator.language || "") ? "nl" : "en"; } catch (e) { /* */ }
    const S = D.share, P = S.phone, t = (o) => o[pl];
    const box = document.getElementById("small");
    box.innerHTML = `<div class="note"><span class="lbl">Working Drawings</span><h1>${esc(t(P.title))}</h1><p>${esc(t(P.text))}</p>`
      + `<button class="send">${esc(t(P.send))}</button><b class="url">${esc(S.show)}</b></div><button class="anyway">${esc(t(P.anyway))}</button>`;
    box.querySelector(".send").onclick = () => {
      if (navigator.share) navigator.share({ title: "Working Drawings", url: S.url }).catch(() => {});
      else location.href = `mailto:?subject=${encodeURIComponent("Working Drawings")}&body=${encodeURIComponent(S.url)}`;
    };
    box.querySelector(".anyway").onclick = () => { box.hidden = true; try { sessionStorage.setItem("wd-anyway", "1"); } catch (e) { /* */ } };
    box.hidden = false;
  }

  // ---------- start ----------
  Type.init();
  resize();
  build();
  cur = clamp(parseInt((location.hash || "#0").slice(1), 10) || 0, 0, slides.length - 1);
  requestAnimationFrame((ms) => { now = ms / 1000; go(cur, true); requestAnimationFrame(frameLoop); });
  checkAll();
  phoneNote();
  // presenting: let the legend fade after a few seconds unless the mouse moves
  if (probeLocal) idle = setTimeout(() => document.body.classList.add("idle"), 4000);
  window.__deck = { ms: () => frameLoop.ms, go, slides: () => slides, view, cur: () => cur, hover: (v) => { slides[cur].hovering = v; } };
})();
