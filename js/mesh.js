/* mesh.js — a tiny solid modeller and hidden-line renderer for the drafting table.
 *
 * Objects are built from triangles (for occlusion and shading) plus drawn lines
 * (edges and decorations). Every frame an object is turned, projected, and
 * rasterised into a small depth buffer; edges are then sampled against that
 * buffer to split them into visible and hidden runs, and the lit-buffer feeds
 * the hatching / scan-line fills. The camera never moves: objects turn.
 */
(function () {
  "use strict";

  // ---------- 3x4 matrices (row-major) ----------
  const M = {
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    t: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
    s: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0],
    rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
    ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
    rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
    mul(A, B) {
      const r = new Array(12);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        let s = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
        if (j === 3) s += A[i * 4 + 3];
        r[i * 4 + j] = s;
      }
      return r;
    },
    // chain(A, B, C) = A·B·C, i.e. C is applied first
    chain(...ms) { return ms.reduce((a, b) => M.mul(a, b)); },
    apply(m, x, y, z) {
      return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
    },
  };

  // ---------- shapes ----------
  class Shape {
    constructor() { this.v = []; this.t = []; this.l = []; this.glass = false; this.crease = 34; }
    vert(x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; }
    tri(a, b, c) { this.t.push(a, b, c); }
    quad(a, b, c, d) { this.t.push(a, b, c, a, c, d); }
    // a drawn line: pts is [[x,y,z],...]; o.accent, o.closed, o.w (weight multiplier)
    line(pts, o = {}) {
      const p = [];
      for (const q of pts) p.push(q[0], q[1], q[2]);
      this.l.push({ p, a: !!o.accent, c: !!o.closed, w: o.w || 1, nohide: !!o.nohide });
      return this;
    }
    add(o, m) {
      const off = this.v.length / 3;
      for (let i = 0; i < o.v.length; i += 3) {
        const q = m ? M.apply(m, o.v[i], o.v[i + 1], o.v[i + 2]) : [o.v[i], o.v[i + 1], o.v[i + 2]];
        this.v.push(q[0], q[1], q[2]);
      }
      for (const i of o.t) this.t.push(i + off);
      for (const L of o.l) {
        const p = [];
        for (let i = 0; i < L.p.length; i += 3) {
          const q = m ? M.apply(m, L.p[i], L.p[i + 1], L.p[i + 2]) : [L.p[i], L.p[i + 1], L.p[i + 2]];
          p.push(q[0], q[1], q[2]);
        }
        this.l.push(Object.assign({}, L, { p }));
      }
      return this;
    }
    xf(m) { const s = new Shape(); s.crease = this.crease; s.glass = this.glass; return s.add(this, m); }
    accentLines() { for (const L of this.l) L.a = true; return this; }

    // weld vertices, drop degenerate triangles, find edges
    build() {
      const key = (x, y, z) => Math.round(x * 2e4) + "," + Math.round(y * 2e4) + "," + Math.round(z * 2e4);
      const map = new Map(), V = [], remap = [];
      for (let i = 0; i < this.v.length; i += 3) {
        const k = key(this.v[i], this.v[i + 1], this.v[i + 2]);
        let j = map.get(k);
        if (j === undefined) { j = V.length / 3; map.set(k, j); V.push(this.v[i], this.v[i + 1], this.v[i + 2]); }
        remap.push(j);
      }
      const T = [], N = [];
      for (let i = 0; i < this.t.length; i += 3) {
        const a = remap[this.t[i]], b = remap[this.t[i + 1]], c = remap[this.t[i + 2]];
        if (a === b || b === c || a === c) continue;
        const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
        const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-10) continue;
        T.push(a, b, c); N.push(nx / len, ny / len, nz / len);
      }
      const em = new Map();
      const nt = T.length / 3;
      for (let f = 0; f < nt; f++) for (let e = 0; e < 3; e++) {
        const a = T[f * 3 + e], b = T[f * 3 + (e + 1) % 3];
        const k = a < b ? a * 1e6 + b : b * 1e6 + a;
        let r = em.get(k);
        if (!r) { r = [Math.min(a, b), Math.max(a, b)]; em.set(k, r); }
        r.push(f);
      }
      const cosC = Math.cos(this.crease * Math.PI / 180);
      const edges = []; // [a, b, f1, f2, kind]  kind 1 = always drawn, 0 = silhouette candidate
      for (const r of em.values()) {
        const [a, b] = r, fs = r.slice(2);
        if (fs.length === 2) {
          const f1 = fs[0], f2 = fs[1];
          const d = N[f1 * 3] * N[f2 * 3] + N[f1 * 3 + 1] * N[f2 * 3 + 1] + N[f1 * 3 + 2] * N[f2 * 3 + 2];
          edges.push(a, b, f1, f2, d < cosC ? 1 : 0);
        } else {
          edges.push(a, b, fs[0], fs.length > 1 ? fs[1] : -1, 1);
        }
      }
      return { v: new Float32Array(V), t: new Uint32Array(T), e: new Int32Array(edges), l: this.l, glass: this.glass, nv: V.length / 3, nt };
    }
  }

  // ---------- primitives ----------
  function box(w, h, d, m) {
    const s = new Shape(), x = w / 2, y = h / 2, z = d / 2;
    for (let i = 0; i < 8; i++) s.vert(i & 1 ? x : -x, i & 2 ? y : -y, i & 4 ? z : -z);
    s.quad(4, 5, 7, 6); s.quad(1, 0, 2, 3); s.quad(5, 1, 3, 7);
    s.quad(0, 4, 6, 2); s.quad(6, 7, 3, 2); s.quad(0, 1, 5, 4);
    return m ? s.xf(m) : s;
  }

  // parametric grid surface; f(u,v) in [0,1]^2
  function surface(nu, nv, f, o = {}) {
    const s = new Shape(), cols = o.wrapU ? nu : nu + 1;
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const p = f(i / nu, j / nv); s.vert(p[0], p[1], p[2]); }
    const id = (i, j) => j * cols + (o.wrapU ? i % nu : i);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (o.flip) s.quad(id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
      else s.quad(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
    return s;
  }

  // lathe around the y axis; profile = [[r, y], ...] bottom to top (outer side)
  function lathe(profile, seg, o = {}) {
    const n = profile.length - 1, a0 = o.a0 || 0;
    const s = surface(seg, n, (u, v) => {
      const k = Math.round(v * n), r = profile[k][0], y = profile[k][1], a = a0 + u * Math.PI * 2;
      return [r * Math.cos(a), y, -r * Math.sin(a)];
    }, { wrapU: true });
    if (o.crease) s.crease = o.crease;
    return s;
  }

  function sphere(r, seg = 20, rings = 12) {
    const p = [];
    for (let i = 0; i <= rings; i++) { const a = (i / rings) * Math.PI; p.push([r * Math.sin(a), -r * Math.cos(a)]); }
    return lathe(p, seg);
  }

  function cylinder(r, h, seg = 20, r2) {
    return lathe([[0, -h / 2], [r, -h / 2], [r2 === undefined ? r : r2, h / 2], [0, h / 2]], seg);
  }

  function torus(R, r, nu = 28, nv = 10) {
    const p = [];
    for (let i = 0; i <= nv; i++) { const a = -Math.PI + (i / nv) * Math.PI * 2; p.push([R + r * Math.cos(a), r * Math.sin(a)]); }
    return lathe(p, nu);
  }

  // ear-clipping triangulation of a simple CCW polygon [[x,y],...]
  function earcut(poly) {
    const idx = poly.map((_, i) => i), out = [];
    const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 5000) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = poly[ia], b = poly[ib], c = poly[ic];
        if (area(a, b, c) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) {
          if (j === ia || j === ib || j === ic) continue;
          if (inside(poly[j], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  }

  function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }

  // extrude a 2D polygon (x,y) along z from -d/2 to d/2
  function extrude(poly, d) {
    if (polyArea(poly) < 0) poly = poly.slice().reverse();
    const s = new Shape(), n = poly.length, z = d / 2;
    const F = poly.map((p) => s.vert(p[0], p[1], z));
    const B = poly.map((p) => s.vert(p[0], p[1], -z));
    for (const [a, b, c] of earcut(poly)) { s.tri(F[a], F[b], F[c]); s.tri(B[c], B[b], B[a]); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; s.quad(F[i], B[i], B[j], F[j]); }
    return s;
  }

  // a flat, two-sided polygon in the xy plane (for leaves, sails, cards)
  function flat(poly) {
    const s = new Shape();
    const V = poly.map((p) => s.vert(p[0], p[1], 0));
    for (const [a, b, c] of earcut(polyArea(poly) < 0 ? poly.slice().reverse() : poly)) s.tri(V[a], V[b], V[c]);
    return s;
  }

  function circle(cx, cy, cz, r, n = 32, plane = "xz") {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
      p.push(plane === "xz" ? [cx + c, cy, cz + s] : plane === "xy" ? [cx + c, cy + s, cz] : [cx, cy + c, cz + s]);
    }
    return p;
  }

  // ---------- normalisation: fit an object's parts into the unit sphere ----------
  function normalise(parts, pad = 1) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of parts) {
      const m = typeof p.m === "function" ? p.m(0) : p.m || M.id();
      const pts = [];
      for (let i = 0; i < p.shape.v.length; i += 3) pts.push(M.apply(m, p.shape.v[i], p.shape.v[i + 1], p.shape.v[i + 2]));
      for (const L of p.shape.l) for (let i = 0; i < L.p.length; i += 3) pts.push(M.apply(m, L.p[i], L.p[i + 1], L.p[i + 2]));
      for (const q of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
    }
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    let r = 0;
    for (const p of parts) {
      const m = typeof p.m === "function" ? p.m(0) : p.m || M.id();
      for (let i = 0; i < p.shape.v.length; i += 3) {
        const q = M.apply(m, p.shape.v[i], p.shape.v[i + 1], p.shape.v[i + 2]);
        r = Math.max(r, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
      }
      for (const L of p.shape.l) for (let i = 0; i < L.p.length; i += 3) {
        const q = M.apply(m, L.p[i], L.p[i + 1], L.p[i + 2]);
        r = Math.max(r, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
      }
    }
    return M.mul(M.s(pad / r), M.t(-c[0], -c[1], -c[2]));
  }

  // ---------- the renderer ----------
  const D = 7.5; // eye distance, in object radii: a mild perspective
  const LIGHT = (() => { const l = [-0.55, 0.72, 0.62], n = Math.hypot(...l); return l.map((x) => x / n); })();

  const pool = { depth: null, lit: null, size: 0 };
  function buffers(n) {
    if (pool.size < n) { pool.depth = new Float32Array(n); pool.lit = new Uint8Array(n); pool.size = n; }
    return pool;
  }

  /* render(obj, o) -> { lines: [{p:[x,y,...], hid, acc, w}], buf }
   * obj: { parts: [{shape: built, m: matrix | (t)=>matrix, glass}], norm: matrix }
   * o: { cx, cy, s (radius in px), yaw, pitch, roll, t, bs (buffer px size) } */
  function render(obj, o) {
    const s = o.s, bs = o.bs || Math.max(1.25, Math.min(2.2, s / 110));
    const half = s * 1.32;
    const W = Math.ceil((half * 2) / bs), H = W, x0 = o.cx - half, y0 = o.cy - half;
    const { depth, lit } = buffers(W * H);
    depth.fill(-1e9, 0, W * H); lit.fill(0, 0, W * H);
    const pose = M.chain(M.rz(o.roll || 0), M.rx(o.pitch || 0), M.ry(o.yaw || 0), obj.norm);

    const P = []; // per part: { sx, sy, sz (view z), part, front }
    for (const part of obj.parts) {
      const sh = part.shape;
      const pm = typeof part.m === "function" ? part.m(o.t || 0) : part.m || M.id();
      const m = M.mul(pose, pm);
      const n = sh.nv, vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n);
      const sx = new Float32Array(n), sy = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = sh.v[i * 3], y = sh.v[i * 3 + 1], z = sh.v[i * 3 + 2];
        const X = m[0] * x + m[1] * y + m[2] * z + m[3], Y = m[4] * x + m[5] * y + m[6] * z + m[7], Z = m[8] * x + m[9] * y + m[10] * z + m[11];
        vx[i] = X; vy[i] = Y; vz[i] = Z;
        const k = D / (D - Z);
        sx[i] = o.cx + X * k * s; sy[i] = o.cy - Y * k * s;
      }
      // facing + flat light per triangle
      const front = new Uint8Array(sh.nt), shade = new Float32Array(sh.nt);
      for (let f = 0; f < sh.nt; f++) {
        const a = sh.t[f * 3], b = sh.t[f * 3 + 1], c = sh.t[f * 3 + 2];
        const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
        const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
        const toEye = -vx[a] * nx - vy[a] * ny + (D - vz[a]) * nz;
        front[f] = toEye > 0 ? 1 : 0;
        if (toEye < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
        shade[f] = 0.2 + 0.8 * Math.max(0, d);
      }
      P.push({ sh, vx, vy, vz, sx, sy, front, shade, m, glass: part.glass || sh.glass, part });
    }

    // rasterise solids into the depth / light buffers
    for (const q of P) {
      if (q.glass) continue;
      const { sh, sx, sy, vz, shade } = q;
      for (let f = 0; f < sh.nt; f++) {
        const a = sh.t[f * 3], b = sh.t[f * 3 + 1], c = sh.t[f * 3 + 2];
        const ax = (sx[a] - x0) / bs, ay = (sy[a] - y0) / bs, bx = (sx[b] - x0) / bs, by = (sy[b] - y0) / bs, cx = (sx[c] - x0) / bs, cy = (sy[c] - y0) / bs;
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(area) < 1e-6) continue;
        const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        const za = vz[a], zb = vz[b], zc = vz[c], L = Math.round(shade[f] * 255), inv = 1 / area;
        for (let y = miny; y <= maxy; y++) {
          const py = y + 0.5;
          for (let x = minx; x <= maxx; x++) {
            const px = x + 0.5;
            const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
            const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
            const z = w0 * za + w1 * zb + w2 * zc, i = y * W + x;
            if (z > depth[i]) { depth[i] = z; lit[i] = L; }
          }
        }
      }
    }

    const EPS = 0.045;
    const vis = (x, y, z) => {
      const ix = ((x - x0) / bs) | 0, iy = ((y - y0) / bs) | 0;
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return true;
      return z >= depth[iy * W + ix] - EPS;
    };

    const lines = [];
    // sample a projected 3D polyline, split into visible / hidden runs
    function trace(pts, closed, acc, w, forceHidden, nohide) {
      // pts: array of [sx, sy, vz]
      const n = pts.length, segs = closed ? n : n - 1;
      let cur = null, state = null, pend = 0;
      const push = (x, y, st) => {
        if (st !== state) {
          if (cur && cur.p.length >= 4) { cur.p.push(x, y); lines.push(cur); }
          cur = { p: [x, y], hid: !st, acc, w }; state = st;
        } else cur.p.push(x, y);
      };
      for (let i = 0; i < segs; i++) {
        const A = pts[i], B = pts[(i + 1) % n];
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const k = Math.max(1, Math.ceil(len / (bs * 1.2)));
        for (let j = i === 0 ? 0 : 1; j <= k; j++) {
          const u = j / k, x = A[0] + (B[0] - A[0]) * u, y = A[1] + (B[1] - A[1]) * u, z = A[2] + (B[2] - A[2]) * u;
          let st = forceHidden === 1 ? false : forceHidden === 2 ? true : nohide ? true : vis(x, y, z);
          // a little hysteresis so runs don't flicker at a silhouette
          if (state !== null && st !== state) { if (++pend < 2) st = state; else pend = 0; } else pend = 0;
          push(x, y, st);
        }
      }
      if (cur && cur.p.length >= 4) lines.push(cur);
    }

    for (const q of P) {
      const { sh, sx, sy, vz, front, glass } = q, e = sh.e;
      for (let i = 0; i < e.length; i += 5) {
        const a = e[i], b = e[i + 1], f1 = e[i + 2], f2 = e[i + 3], kind = e[i + 4];
        let draw = kind === 1;
        if (!draw && f2 >= 0 && front[f1] !== front[f2]) draw = true;
        if (!draw) continue;
        let force = 0;
        if (glass) force = (front[f1] || (f2 >= 0 && front[f2])) ? 2 : 1;
        trace([[sx[a], sy[a], vz[a]], [sx[b], sy[b], vz[b]]], false, !!q.part.acc, q.part.w || 1, force);
      }
      // decorations
      const m = q.m;
      for (const L of sh.l) {
        const pts = [];
        for (let i = 0; i < L.p.length; i += 3) {
          const x = L.p[i], y = L.p[i + 1], z = L.p[i + 2];
          const X = m[0] * x + m[1] * y + m[2] * z + m[3], Y = m[4] * x + m[5] * y + m[6] * z + m[7], Z = m[8] * x + m[9] * y + m[10] * z + m[11];
          const k = D / (D - Z);
          pts.push([o.cx + X * k * s, o.cy - Y * k * s, Z]);
        }
        trace(pts, L.c, L.a, L.w, 0, L.nohide);
      }
    }
    // merge edge fragments that share endpoints into longer strokes (nicer pencil)
    return { lines: chain(lines), buf: { x0, y0, bs, W, H, depth, lit } };
  }

  // join two-point edges end to end so strokes flow
  function chain(lines) {
    const out = [], ends = new Map();
    const k = (x, y) => Math.round(x * 2) + ":" + Math.round(y * 2);
    for (const L of lines) {
      const n = L.p.length;
      if (n < 4) continue;
      const sk = k(L.p[0], L.p[1]);
      const prev = ends.get(sk);
      if (prev && prev.hid === L.hid && prev.acc === L.acc && prev.w === L.w && prev.p.length < 600) {
        ends.delete(sk);
        for (let i = 2; i < n; i++) prev.p.push(L.p[i]);
        ends.set(k(L.p[n - 2], L.p[n - 1]), prev);
      } else {
        const c = { p: L.p.slice(), hid: L.hid, acc: L.acc, w: L.w };
        out.push(c);
        ends.set(k(L.p[n - 2], L.p[n - 1]), c);
      }
    }
    return out;
  }

  /* hatch(buf, o) -> [[x0,y0,x1,y1, k], ...] in stage coords
   * Diagonal hatching from the lit buffer: line k at angle o.angle, pitch o.pitch,
   * drawn where darkness (1 - lit) exceeds o.thr. Lines are aligned to the page. */
  function hatch(buf, o) {
    const { x0, y0, bs, W, H, depth, lit } = buf;
    const a = o.angle, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const cs = [[x0, y0], [x0 + W * bs, y0], [x0, y0 + H * bs], [x0 + W * bs, y0 + H * bs]];
    let nmin = 1e9, nmax = -1e9, tmin = 1e9, tmax = -1e9;
    for (const [x, y] of cs) { const n = x * nx + y * ny, t = x * dx + y * dy; nmin = Math.min(nmin, n); nmax = Math.max(nmax, n); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    const out = [], step = bs * 0.9, off = o.offset || 0;
    for (let k = Math.ceil((nmin - off) / o.pitch); k * o.pitch + off <= nmax; k++) {
      const c = k * o.pitch + off;
      const thr = typeof o.thr === "function" ? o.thr(k) : o.thr;
      let start = null, last = null;
      for (let t = tmin; t <= tmax; t += step) {
        const x = nx * c + dx * t, y = ny * c + dy * t;
        const ix = ((x - x0) / bs) | 0, iy = ((y - y0) / bs) | 0;
        let on = false;
        if (ix >= 0 && iy >= 0 && ix < W && iy < H) {
          const i = iy * W + ix;
          on = depth[i] > -1e8 && 1 - lit[i] / 255 > thr;
        }
        if (on) { if (!start) start = [x, y]; last = [x, y]; }
        else if (start) { if (Math.hypot(last[0] - start[0], last[1] - start[1]) > 3) out.push([start[0], start[1], last[0], last[1], k]); start = null; }
      }
      if (start && Math.hypot(last[0] - start[0], last[1] - start[1]) > 3) out.push([start[0], start[1], last[0], last[1], k]);
    }
    return out;
  }

  /* scan(buf, o) -> [{y, xs:[...], th:[...]}] horizontal scan lines on a fixed pitch
   * whose thickness follows how lit the surface is (the hologram fill). */
  function scan(buf, o) {
    const { x0, y0, bs, W, H, depth, lit } = buf, pitch = o.pitch, out = [];
    const step = Math.max(1.5, bs);
    for (let k = Math.ceil(y0 / pitch); k * pitch < y0 + H * bs; k++) {
      const y = k * pitch, iy = ((y - y0) / bs) | 0;
      if (iy < 0 || iy >= H) continue;
      let run = null;
      for (let x = x0; x < x0 + W * bs; x += step) {
        const ix = ((x - x0) / bs) | 0, i = iy * W + ix;
        if (depth[i] > -1e8) {
          const l = lit[i] / 255;
          if (!run) run = { y, k, xs: [], th: [] };
          run.xs.push(x); run.th.push(o.min + (o.max - o.min) * l * l);
        } else if (run) { if (run.xs.length > 1) out.push(run); run = null; }
      }
      if (run && run.xs.length > 1) out.push(run);
    }
    return out;
  }

  window.Mesh = { M, Shape, box, surface, lathe, sphere, cylinder, torus, extrude, flat, circle, earcut, normalise, render, hatch, scan };
})();
