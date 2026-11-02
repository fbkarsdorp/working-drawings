/* type.js — big words in Geist 900, as geometry.
 * Glyph outlines are flattened into contours; fills are hatching cut to the letter
 * shapes (computed analytically, nonzero winding) and the outline is doubled. */
(function () {
  "use strict";
  let font = null;
  function init() {
    const bin = atob(window.GEIST_BLACK_B64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    font = opentype.parse(buf.buffer);
  }

  function flatten(cmds) {
    const contours = [];
    let cur = null, px = 0, py = 0;
    for (const c of cmds) {
      if (c.type === "M") { if (cur && cur.length > 4) contours.push(cur); cur = [c.x, c.y]; px = c.x; py = c.y; }
      else if (c.type === "L") { cur.push(c.x, c.y); px = c.x; py = c.y; }
      else if (c.type === "Q") {
        const n = 8;
        for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; cur.push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y); }
        px = c.x; py = c.y;
      } else if (c.type === "C") {
        const n = 10;
        for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; cur.push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y); }
        px = c.x; py = c.y;
      } else if (c.type === "Z") { if (cur && cur.length > 4) contours.push(cur); cur = null; }
    }
    if (cur && cur.length > 4) contours.push(cur);
    // drop a closing point equal to the first
    for (const p of contours) { const n = p.length; if (Math.abs(p[0] - p[n - 2]) < 0.01 && Math.abs(p[1] - p[n - 1]) < 0.01) p.length = n - 2; }
    return contours;
  }

  const cache = new Map();
  /* shape(text, size, tracking) -> { contours (baseline at y=0, x from 0), width, cap } */
  function shape(text, size, tracking = -0.012) {
    const key = text + "|" + size + "|" + tracking;
    if (cache.has(key)) return cache.get(key);
    const scale = size / font.unitsPerEm;
    const glyphs = font.stringToGlyphs(text);
    let x = 0;
    const contours = [];
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const p = g.getPath(x, 0, size);
      for (const c of flatten(p.commands)) contours.push(c);
      x += g.advanceWidth * scale;
      if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    }
    const cap = ((font.tables.os2 && font.tables.os2.sCapHeight) || 700) * scale;
    const r = { contours, width: x, cap, size };
    cache.set(key, r);
    return r;
  }

  function measure(text, size, tracking) { return shape(text, size, tracking).width; }

  // largest size <= max at which every line fits in maxW
  function fit(lines, maxW, maxSize, tracking) {
    let s = maxSize;
    for (const l of lines) { const w = measure(l, 100, tracking); s = Math.min(s, (maxW / w) * 100); }
    return Math.floor(s);
  }

  /* hatch lines cut to the contours: returns [[x0,y0,x1,y1], ...] in the contours' space
   * angle: radians; pitch: spacing; offset */
  function hatchContours(contours, angle, pitch, offset = 0) {
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    let nmin = 1e9, nmax = -1e9;
    const E = [];
    for (const p of contours) {
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[j * 2], y1 = p[j * 2 + 1];
        const n0 = x0 * nx + y0 * ny, n1 = x1 * nx + y1 * ny;
        E.push(n0, n1, x0 * dx + y0 * dy, x1 * dx + y1 * dy);
        nmin = Math.min(nmin, n0); nmax = Math.max(nmax, n0);
      }
    }
    const out = [];
    for (let k = Math.ceil((nmin - offset) / pitch); k * pitch + offset <= nmax; k++) {
      const c = k * pitch + offset + 1e-3, hits = [];
      for (let i = 0; i < E.length; i += 4) {
        const n0 = E[i], n1 = E[i + 1];
        if ((n0 <= c && n1 > c) || (n1 <= c && n0 > c)) {
          const u = (c - n0) / (n1 - n0);
          hits.push([E[i + 2] + (E[i + 3] - E[i + 2]) * u, n1 > n0 ? 1 : -1]);
        }
      }
      hits.sort((a, b) => a[0] - b[0]);
      let wind = 0, start = 0;
      for (const [t, d] of hits) {
        const was = wind !== 0;
        wind += d;
        if (!was && wind !== 0) start = t;
        else if (was && wind === 0 && t - start > 0.5) out.push([nx * c + dx * start, ny * c + dy * start, nx * c + dx * t, ny * c + dy * t, k]);
      }
    }
    return out;
  }

  const hcache = new Map();
  /* draw a word in the pen's ink at (x, baseline y)
   * o: { f: reveal 0..1, seed, scale } */
  function draw(pen, text, size, x, y, o = {}) {
    const sh = shape(text, size, o.tracking);
    const f = o.f === undefined ? 1 : o.f;
    const ink = pen.ink;
    const seed0 = o.seed || 500;
    // the fill
    const hf = Math.max(0, Math.min(1, (f - 0.1) / 0.9));
    if (ink === "holo") {
      const key = "scan|" + text + "|" + size + "|" + y;
      let runs = hcache.get(key);
      if (!runs) {
        // horizontal scan lines aligned to the page's 8 px pitch
        const raw = hatchContours(sh.contours, 0, 8, ((y % 8) + 8) % 8);
        runs = raw.map((h) => {
          const yy = h[1], depth = (yy + sh.cap) / sh.cap; // 0 at cap height, 1 at baseline
          const th = 0.8 + 2.8 * Math.max(0, 1 - depth * 0.85);
          return [h[0], yy, h[2], th];
        });
        hcache.set(key, runs);
      }
      const n = Math.floor(runs.length * hf);
      const order = runs;
      for (let i = 0; i < n; i++) { const r = order[i]; pen.rect(x + r[0], y + r[1] - r[3] / 2, r[2] - r[0], r[3], o.accentFill ? Ink.C.white : Ink.C.cyan, 1); }
    } else {
      const pitch = ink === "paper" ? Math.max(5.5, Math.min(9, size * 0.05)) : Math.max(5, Math.min(7, size * 0.04));
      const key = ink + "|" + text + "|" + size;
      let H = hcache.get(key);
      if (!H) {
        H = hatchContours(sh.contours, -Math.PI / 4, pitch);
        // drawn one line at a time, left to right
        H.sort((a, b) => a[4] - b[4]);
        hcache.set(key, H);
      }
      const n = Math.floor(H.length * hf);
      for (let i = 0; i < n; i++) {
        const h = H[i];
        pen.line([x + h[0], y + h[1], x + h[2], y + h[3]], { kind: "hatch", seed: seed0 + i * 1.37, scale: o.scale, acc: !!o.accentFill });
      }
    }
    // the doubled outline
    const of = Math.min(1, f * 1.4);
    const k = ink === "paper" ? 1.4 : ink === "blueprint" ? 5 : 5;
    let s = seed0 + 9000;
    for (const c of sh.contours) {
      const p = new Array(c.length);
      for (let i = 0; i < c.length; i += 2) { p[i] = c[i] + x; p[i + 1] = c[i + 1] + y; }
      pen.line(p, { kind: "type", closed: true, f: of, seed: s++, scale: o.scale, acc: !!o.accent });
      const q = new Array(c.length);
      for (let i = 0; i < c.length; i += 2) { q[i] = p[i] + k; q[i + 1] = p[i + 1] + k * 0.7; }
      if (ink === "paper") pen.line(q, { kind: "type", closed: true, f: of, seed: s++ + 0.5, scale: (o.scale || 1) * 0.55, acc: !!o.accent });
      else pen.line(q, { kind: "rule", closed: true, f: of, w: 0.6, scale: o.scale, acc: true });
    }
    return sh;
  }

  window.Type = { init, shape, measure, fit, draw, hatchContours };
})();
