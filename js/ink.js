/* ink.js — three inks for one geometry.
 *
 * PAPER      cream paper, blue 60 px grid, graphite pencil (accent: blue pencil).
 *            Lines are resampled and pushed off true by slow sine waves whose phase
 *            changes 8 times a second, stroked twice (full width at 90 %, half width
 *            at 40 % with more wobble), paper tooth knocked out, multiplied on paper.
 * BLUEPRINT  flat blue, white grid, clean white lines, hidden edges dashed and thinner,
 *            fine clean hatching (accent: cyan).
 * HOLOGRAM   black, cyan grid, cyan lines with a white core 30 % of the width, fills of
 *            horizontal scan lines on an 8 px pitch, thickness by light (accent: white).
 */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  const C = { paper: "#EDE6D5", red: "#C8223F", redDark: "#9C1A31", blue: "#1B3ED2", cyan: "#45F0DD", black: "#07080A", graphite: "#16161A", white: "#FFFFFF" };
  const INKS = {
    paper: { bg: C.paper, grid: (window.GRID === "blue" ? C.blue : C.red), line: C.graphite, accent: C.red },
    blueprint: { bg: C.blue, grid: C.white, line: C.white, accent: C.cyan },
    holo: { bg: C.black, grid: C.cyan, line: C.cyan, accent: C.white },
  };
  const ORDER = ["paper", "blueprint", "holo"];

  const hash = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  // ---------- polyline helpers ----------
  function length(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }

  // cut a polyline to the first fraction f of its length
  function cut(p, f) {
    if (f >= 1) return p;
    if (f <= 0) return null;
    const L = length(p) * f;
    const out = [p[0], p[1]];
    let acc = 0;
    for (let i = 2; i < p.length; i += 2) {
      const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if (acc + d >= L) { const u = (L - acc) / (d || 1); out.push(p[i - 2] + (p[i] - p[i - 2]) * u, p[i - 1] + (p[i + 1] - p[i - 1]) * u); return out; }
      acc += d; out.push(p[i], p[i + 1]);
    }
    return out;
  }

  // the pencil: resample and push off true by two slow sines
  function wobble(p, closed, amp, seed, tick, over) {
    const n = p.length / 2;
    if (n < 2) return p;
    const q = closed ? p.concat([p[0], p[1]]) : p;
    const L = length(q);
    if (L < 0.5) return p;
    const step = Math.max(3, Math.min(7, L / 6));
    const ph1 = hash(seed * 7.13 + tick * 1.618) * TAU, ph2 = hash(seed * 3.71 + tick * 2.414 + 9.1) * TAU;
    const drift = (hash(seed * 1.3 + tick * 0.77) - 0.5) * amp * 0.6;
    const out = [];
    let i = 0, acc = 0;
    const segs = q.length / 2 - 1;
    const total = Math.max(2, Math.ceil(L / step));
    for (let s = 0; s <= total; s++) {
      const d = (s / total) * L;
      while (i < segs - 1 && acc + Math.hypot(q[i * 2 + 2] - q[i * 2], q[i * 2 + 3] - q[i * 2 + 1]) < d) { acc += Math.hypot(q[i * 2 + 2] - q[i * 2], q[i * 2 + 3] - q[i * 2 + 1]); i++; }
      const ax = q[i * 2], ay = q[i * 2 + 1], bx = q[i * 2 + 2], by = q[i * 2 + 3];
      const sl = Math.hypot(bx - ax, by - ay) || 1, u = Math.min(1, (d - acc) / sl);
      const tx = (bx - ax) / sl, ty = (by - ay) / sl;
      const off = amp * (0.72 * Math.sin((d / 170) * TAU + ph1) + 0.28 * Math.sin((d / 47) * TAU + ph2)) + drift;
      let x = ax + (bx - ax) * u - ty * off, y = ay + (by - ay) * u + tx * off;
      if (!closed && over) {
        if (s === 0) { x -= tx * over; y -= ty * over; }
        if (s === total) { x += tx * over; y += ty * over; }
      }
      out.push(x, y);
    }
    return out;
  }

  function addPoly(path, p, closed) {
    path.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
    if (closed) path.closePath();
  }

  // ---------- the pen: collects a frame's strokes, batched by style ----------
  class Pen {
    constructor(ink, tick, t) { this.ink = ink; this.tick = tick; this.t = t; this.b = new Map(); this.fills = new Map(); this.seed = 1; this.k = 1; }
    batch(color, w, alpha, dash) {
      const key = color + "|" + w.toFixed(2) + "|" + alpha + "|" + (dash || "");
      let e = this.b.get(key);
      if (!e) { e = { color, w, alpha, dash, path: new Path2D() }; this.b.set(key, e); }
      return e.path;
    }
    fill(color, alpha) {
      const key = color + "|" + alpha;
      let e = this.fills.get(key);
      if (!e) { e = { color, alpha, path: new Path2D() }; this.fills.set(key, e); }
      return e.path;
    }
    /* a stroke in stage coordinates
     * o: { w: weight, acc, hid, kind: 'edge'|'hatch'|'type'|'rule', closed, seed, f: reveal fraction } */
    line(p, o = {}) {
      if (!p || p.length < 4) return;
      if (o.f !== undefined && o.f < 1) { p = cut(p, o.f); if (!p || p.length < 4) return; o = Object.assign({}, o, { closed: false }); }
      const ink = INKS[this.ink], kind = o.kind || "edge", k = this.k * (o.scale || 1);
      const color = o.acc ? ink.accent : ink.line;
      const seed = o.seed !== undefined ? o.seed : this.seed++;
      const w = o.w || 1;
      if (this.ink === "paper") {
        if (o.hid) return;
        const base = kind === "hatch" ? 1.15 : kind === "type" ? 2.5 : kind === "rule" ? 1.6 : 2.4;
        const lw = Math.max(0.7, base * w * k);
        const amp = (kind === "rule" ? 0.9 : kind === "hatch" ? 0.7 : 0.85) * (o.wob === undefined ? 1 : o.wob);
        const over = kind === "hatch" ? 0 : o.closed ? 0 : Math.min(4, 1.5 + lw);
        addPoly(this.batch(color, lw, 0.9), wobble(p, o.closed, amp, seed, this.tick, over), o.closed);
        addPoly(this.batch(color, lw / 2, 0.4), wobble(p, o.closed, amp * 2.3, seed + 77.7, this.tick, over * 1.5), o.closed);
      } else if (this.ink === "blueprint") {
        if (o.hid) { addPoly(this.batch(color, Math.max(1, 1.5 * Math.min(1.2, w) * k), 0.85, "9,7"), p, o.closed); return; }
        const base = kind === "hatch" ? 1.0 : kind === "type" ? 3.2 : kind === "rule" ? 1.5 : 3.3;
        const lw = Math.max(kind === "hatch" ? 0.8 : 1.1, base * Math.min(w, 1.3) * k);
        addPoly(this.batch(color, lw, kind === "hatch" ? 0.55 : 1), p, o.closed);
      } else {
        if (o.hid) { addPoly(this.batch(color, Math.max(0.8, 1.1 * k), 0.4), p, o.closed); return; }
        const base = kind === "type" ? 3.2 : kind === "rule" ? 1.6 : 2.8;
        const lw = Math.max(1, base * Math.min(w, 1.3) * k);
        if (o.acc) { addPoly(this.batch(C.white, lw * 0.8, 1), p, o.closed); return; }
        addPoly(this.batch(C.cyan, lw, 1), p, o.closed);
        addPoly(this.batch(C.white, lw * 0.3, 1), p, o.closed);
      }
    }
    // a scan-line run with varying thickness (hologram fills)
    scanRun(r, color = C.cyan) {
      const path = this.fill(color, 1), xs = r.xs, th = r.th, y = r.y;
      path.moveTo(xs[0], y - th[0] / 2);
      for (let i = 1; i < xs.length; i++) path.lineTo(xs[i], y - th[i] / 2);
      for (let i = xs.length - 1; i >= 0; i--) path.lineTo(xs[i], y + th[i] / 2);
      path.closePath();
    }
    rect(x, y, w, h, color, alpha = 1) { this.fill(color, alpha).rect(x, y, w, h); }
    flush(ctx) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const e of this.fills.values()) { ctx.globalAlpha = e.alpha; ctx.fillStyle = e.color; ctx.fill(e.path); }
      for (const e of this.b.values()) {
        ctx.globalAlpha = e.alpha; ctx.strokeStyle = e.color; ctx.lineWidth = e.w;
        ctx.setLineDash(e.dash ? e.dash.split(",").map(Number) : []);
        ctx.stroke(e.path);
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // ---------- an object, drawn in the pen's ink ----------
  /* o: { cx, cy, s, t, phase, f (reveal 0..1), scale (line weight), fill: true } */
  function drawObject(pen, key, o) {
    const obj = Objects.get(key);
    const ps = Objects.pose(obj, o.t, o.phase || 0);
    const r = Mesh.render(obj, Object.assign({}, o, ps, { s: o.s * (obj.motion.zoom || 1) }));
    const f = o.f === undefined ? 1 : o.f;
    const lf = Math.min(1, f * 1.5), hf = Math.max(0, Math.min(1, (f - 0.25) / 0.75));
    let seed = (o.seed || 0) + 1000;
    for (const L of r.lines) {
      pen.line(L.p, { w: L.w * (o.firm ? 1.12 : 1), acc: L.acc, hid: L.hid, f: lf, seed: seed++, scale: o.scale, wob: o.firm ? 0.4 : 1 });
    }
    if (o.fill === false || hf <= 0) return r;
    if (pen.ink === "paper") {
      const pitch = o.s < 90 ? 6 : 7.5;
      const a = Mesh.hatch(r.buf, { angle: -Math.PI / 4, pitch, thr: (k) => 0.36 + ((k % 3 + 3) % 3) * 0.07 });
      const b = Mesh.hatch(r.buf, { angle: Math.PI / 4, pitch: pitch * 1.1, thr: 0.68 });
      const all = a.concat(b);
      const n = Math.floor(all.length * hf);
      for (let i = 0; i < n; i++) { const h = all[i]; pen.line([h[0], h[1], h[2], h[3]], { kind: "hatch", seed: seed++, scale: o.scale, wob: o.firm ? 0.4 : 1 }); }
    } else if (pen.ink === "blueprint") {
      const a = Mesh.hatch(r.buf, { angle: -Math.PI / 4, pitch: 6, thr: 0.48 });
      const b = Mesh.hatch(r.buf, { angle: Math.PI / 4, pitch: 6, thr: 0.74 });
      const all = a.concat(b), n = Math.floor(all.length * hf);
      for (let i = 0; i < n; i++) { const h = all[i]; pen.line([h[0], h[1], h[2], h[3]], { kind: "hatch", scale: o.scale }); }
    } else {
      const runs = Mesh.scan(r.buf, { pitch: 8, min: 0.4, max: Math.max(2.2, 3.6 * (o.scale || 1)) });
      const n = Math.floor(runs.length * hf);
      for (let i = 0; i < n; i++) pen.scanRun(runs[i]);
    }
    return r;
  }

  // ---------- backgrounds ----------
  const bg = {};
  let tooth = null;
  function noiseCanvas(w, h, fn) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"), id = x.createImageData(w, h);
    fn(id.data, w, h);
    x.putImageData(id, 0, 0);
    return c;
  }
  function gridOn(x, view, color) {
    const { W, H, dpr, scale, ox, oy } = view;
    const step = 60 * scale * dpr, X0 = (ox + 150 * scale) * dpr, Y0 = (oy + 90 * scale) * dpr;
    const lw = Math.max(1, Math.round(dpr * Math.max(0.75, scale)));
    x.fillStyle = color;
    const k0 = Math.floor(-X0 / step) - 1, k1 = Math.ceil((W * dpr - X0) / step) + 1;
    for (let k = k0; k <= k1; k++) { x.globalAlpha = ((k % 5) + 5) % 5 === 0 ? 0.26 : 0.13; x.fillRect(Math.round(X0 + k * step - lw / 2), 0, lw, H * dpr); }
    const j0 = Math.floor(-Y0 / step) - 1, j1 = Math.ceil((H * dpr - Y0) / step) + 1;
    for (let j = j0; j <= j1; j++) {
      x.globalAlpha = ((j % 5) + 5) % 5 === 0 ? 0.26 : 0.13;
      // leave the crossings single-weight so the grid reads as printed, not doubled
      x.fillRect(0, Math.round(Y0 + j * step - lw / 2), W * dpr, lw);
    }
    x.globalAlpha = 1;
  }
  function makeBackgrounds(view) {
    const w = Math.round(view.W * view.dpr), h = Math.round(view.H * view.dpr);
    // paper grain: fine speckle and a few drawn fibres
    const grain = noiseCanvas(w, h, (d, W, H) => {
      for (let i = 0; i < W * H; i++) {
        const r = Math.random(), v = 255 - Math.pow(r, 6) * 46 - Math.random() * 7;
        d[i * 4] = v; d[i * 4 + 1] = v * 0.995; d[i * 4 + 2] = v * 0.985; d[i * 4 + 3] = 255;
      }
    });
    const gx = grain.getContext("2d");
    gx.lineCap = "round";
    const fibres = Math.round((w * h) / 5000);
    for (let i = 0; i < fibres; i++) {
      const x = Math.random() * w, y = Math.random() * h, a = Math.random() * TAU, L = (6 + Math.random() * 22) * view.dpr;
      gx.strokeStyle = Math.random() < 0.6 ? "rgba(120,100,70,0.07)" : "rgba(255,255,255,0.25)";
      gx.lineWidth = 0.6 * view.dpr;
      gx.beginPath(); gx.moveTo(x, y); gx.quadraticCurveTo(x + Math.cos(a + 0.5) * L * 0.5, y + Math.sin(a + 0.5) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); gx.stroke();
    }
    for (const name of ORDER) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = INKS[name].bg; x.fillRect(0, 0, w, h);
      if (name === "paper") {
        // a soft, uneven tone across the sheet
        const g = x.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
        g.addColorStop(0, "rgba(255,252,240,0.35)"); g.addColorStop(1, "rgba(180,160,120,0.12)");
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        gridOn(x, view, INKS[name].grid);
        x.globalCompositeOperation = "multiply"; x.drawImage(grain, 0, 0); x.globalCompositeOperation = "source-over";
      } else gridOn(x, view, INKS[name].grid);
      bg[name] = c;
    }
    // paper tooth: where the paper's grain stands up the pencil skips
    tooth = noiseCanvas(w, h, (d, W, H) => {
      const cw = Math.ceil(W / 3) + 2, coarse = new Float32Array(cw * (Math.ceil(H / 3) + 2));
      for (let i = 0; i < coarse.length; i++) coarse[i] = Math.random();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, c = coarse[((y / 3) | 0) * cw + ((x / 3) | 0)], f = Math.random();
        const v = 0.55 * c + 0.45 * f;
        const a = Math.max(0, Math.min(1, (v - 0.5) * 2.4));
        d[i * 4 + 3] = a * a * 235;
      }
    });
  }

  window.Ink = { C, INKS, ORDER, Pen, drawObject, makeBackgrounds, bg: () => bg, tooth: () => tooth, wobble, cut, length };
})();
