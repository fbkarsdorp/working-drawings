/* objects.js — one drawn object per app. Each is built once from solids and lines,
 * normalised into the unit sphere, and given a way of turning. */
(function () {
  "use strict";
  const { M, Shape, box, lathe, sphere, cylinder, torus, extrude, flat, circle, normalise } = Mesh;
  const PI = Math.PI, TAU = PI * 2;

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // convex polyhedron with outward faces
  function hull(verts, faces) {
    const s = new Shape();
    const c = verts.reduce((a, v) => [a[0] + v[0] / verts.length, a[1] + v[1] / verts.length, a[2] + v[2] / verts.length], [0, 0, 0]);
    const ids = verts.map((v) => s.vert(v[0], v[1], v[2]));
    for (let f of faces) {
      const [a, b, d] = [verts[f[0]], verts[f[1]], verts[f[2]]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (n[0] * (a[0] - c[0]) + n[1] * (a[1] - c[1]) + n[2] * (a[2] - c[2]) < 0) f = f.slice().reverse();
      for (let i = 1; i < f.length - 1; i++) s.tri(ids[f[0]], ids[f[i]], ids[f[i + 1]]);
    }
    return s;
  }

  function make(parts, motion) {
    const built = parts.map((p) => Object.assign({}, p, { shape: p.shape.build() }));
    const norm = normalise(built, motion.pad || 1);
    return { parts: built, norm, motion };
  }

  // pose at time t (seconds)
  function pose(obj, t, phase = 0) {
    const m = obj.motion;
    let yaw;
    if (m.mode === "sway") yaw = (m.yaw0 || 0) + Math.sin(t * (m.speed || 0.3) + phase) * (m.amp || 0.5);
    else yaw = (m.yaw0 || 0) + (t + phase * 7) * (m.speed || 0.25);
    // positive pitch tips the top towards the viewer: we look down on the table
    return { yaw, pitch: -(m.pitch || -0.35), roll: m.roll || 0 };
  }

  const B = {};

  // 1 · Liederenbank: an open songbook with staves
  B.songbook = () => {
    const W = 1.0, Dz = 0.7;
    const top = (x) => 0.05 + 0.2 * Math.pow(Math.min(1, x / W), 0.45) * (1 - 0.3 * (x / W));
    const prof = [];
    for (let i = 0; i <= 20; i++) prof.push([(i / 20) * W, top((i / 20) * W)]);
    prof.push([W, 0.025], [0, 0.025]);
    const right = extrude(prof, Dz * 2);
    // page edges: fine lines on the fore-edge of the block
    for (let k = 1; k < 5; k++) {
      const y = 0.025 + (top(W) - 0.025) * (k / 5);
      right.line([[W + 0.002, y, -Dz], [W + 0.002, y, Dz]], { w: 0.6 });
    }
    // staves + notes (accent) and lines of text
    const R = rng(7);
    const on = (x, z, lift = 0.006) => [x, top(x) + lift, z];
    const staff = (sh, z0, x0, x1, notes, red) => {
      for (let i = 0; i < 5; i++) {
        const z = z0 + i * 0.03, pts = [];
        for (let k = 0; k <= 16; k++) pts.push(on(x0 + (x1 - x0) * (k / 16), z));
        sh.line(pts, { w: 0.55 });
      }
      for (let n = 0; n < notes; n++) {
        const x = x0 + 0.08 + (n / notes) * (x1 - x0 - 0.12), z = z0 + Math.floor(R() * 9) * 0.015, pts = [];
        for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; pts.push(on(x + Math.cos(a) * 0.022, z + Math.sin(a) * 0.014, 0.008)); }
        sh.line(pts, { accent: !!red, closed: true, w: 0.9 });
        sh.line([on(x + 0.021, z, 0.008), on(x + 0.021, z - 0.13, 0.008)], { accent: !!red, w: 0.8 });
      }
    };
    const text = (sh, z0, rows, x0, x1) => {
      for (let r = 0; r < rows; r++) {
        let x = x0;
        const z = z0 + r * 0.06, end = r === rows - 1 ? x0 + (x1 - x0) * 0.55 : x1;
        while (x < end - 0.05) {
          const wl = 0.04 + R() * 0.12, xe = Math.min(end, x + wl), pts = [];
          for (let k = 0; k <= 3; k++) pts.push(on(x + (xe - x) * (k / 3), z));
          sh.line(pts, { w: 0.7 });
          x = xe + 0.03;
        }
      }
    };
    staff(right, -0.6, 0.14, 0.9, 7, true);
    text(right, -0.36, 3, 0.14, 0.9);
    staff(right, -0.08, 0.14, 0.9, 6);
    text(right, 0.18, 4, 0.14, 0.9);
    const left = new Shape();
    const lp = extrude(prof, Dz * 2);
    for (let k = 1; k < 5; k++) { const y = 0.025 + (top(W) - 0.025) * (k / 5); lp.line([[W + 0.002, y, -Dz], [W + 0.002, y, Dz]], { w: 0.6 }); }
    staff(lp, -0.6, 0.12, 0.88, 6);
    text(lp, -0.36, 3, 0.12, 0.88);
    staff(lp, -0.08, 0.12, 0.88, 7);
    text(lp, 0.18, 4, 0.12, 0.88);
    left.add(lp, M.s(-1, 1, 1));
    const cover = box(W * 2 + 0.14, 0.045, Dz * 2 + 0.1, M.t(0, 0, 0));
    return make([{ shape: right }, { shape: left }, { shape: cover }], { mode: "sway", pitch: -0.82, speed: 0.32, amp: 0.55, yaw0: 0.1, zoom: 1.18 });
  };

  // 2 · Dwaallicht: the Low Countries at night, columns of light over the villages
  B.wisp = () => {
    const LL = [[2.55, 51.09], [3.0, 51.25], [3.37, 51.37], [3.45, 51.53], [3.7, 51.6], [3.9, 51.73], [4.05, 51.85], [4.15, 52.0], [4.4, 52.2], [4.55, 52.45], [4.65, 52.75], [4.75, 52.96], [5.0, 53.1], [5.4, 53.2], [5.9, 53.38], [6.4, 53.45], [6.9, 53.35], [7.2, 53.25], [7.05, 52.85], [7.05, 52.6], [6.7, 52.5], [6.9, 52.25], [6.75, 52.05], [6.15, 51.9], [5.95, 51.8], [6.1, 51.6], [6.2, 51.35], [6.05, 51.1], [5.9, 50.8], [5.7, 50.75], [5.2, 50.75], [4.5, 50.75], [3.8, 50.75], [3.2, 50.7], [2.9, 50.75]];
    const P = ([lon, lat]) => [(lon - 4.85) * 0.42, -(lat - 52.05) * 0.68];
    const pts = LL.map(P);
    const slab = box(2.3, 0.08, 2.0, M.t(0, -0.04, 0));
    slab.line(pts.map(([x, z]) => [x, 0.002, z]), { closed: true, w: 1.1 });
    const inside = (x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    const R = rng(11), cols = new Shape();
    const centres = [[5.8, 53.1, 0.9], [6.6, 52.4, 0.7], [5.3, 51.6, 0.8], [3.7, 51.05, 0.8], [4.6, 52.3, 0.5], [5.9, 51.0, 0.6]];
    let n = 0, guard = 0;
    while (n < 34 && guard++ < 2000) {
      const c = centres[Math.floor(R() * centres.length)];
      const lon = c[0] + (R() - 0.5) * 0.9, lat = c[1] + (R() - 0.5) * 0.6;
      const [x, z] = P([lon, lat]);
      if (!inside(x, z)) continue;
      const h = 0.06 + Math.pow(R(), 2.2) * 1.15 * c[2];
      cols.add(box(0.034, h, 0.034), M.t(x, h / 2, z));
      n++;
    }
    // wisps hanging in the sky
    const sky = new Shape();
    for (let i = 0; i < 9; i++) {
      const x = (R() - 0.5) * 1.8, y = 0.9 + R() * 0.45, z = (R() - 0.5) * 1.4, r = 0.025 + R() * 0.02;
      sky.line(circle(x, y, z, r, 10, "xy"), { closed: true, accent: true, nohide: false });
    }
    return make([{ shape: slab }, { shape: cols, w: 0.55 }, { shape: sky }], { mode: "spin", pitch: -0.55, speed: 0.22, zoom: 1.1 });
  };

  // 3 · Spindle: a drop spindle with its cop of yarn
  B.spindle = () => {
    const shaft = cylinder(0.026, 2.0, 12);
    const whorl = lathe([[0, -0.8], [0.34, -0.8], [0.4, -0.76], [0.4, -0.7], [0.3, -0.64], [0, -0.62]], 28);
    const r = (y) => 0.03 + 0.2 * Math.pow(Math.max(0, Math.sin((PI * (y + 0.58)) / 1.04)), 0.8);
    const prof = [];
    for (let i = 0; i <= 14; i++) { const y = -0.58 + (1.04 * i) / 14; prof.push([r(y), y]); }
    prof[0][0] = 0.03; prof[14][0] = 0.03;
    const cop = lathe(prof, 22);
    // thread: helix around the cop, then off to the fibre
    const th = [];
    for (let i = 0; i <= 220; i++) { const y = -0.5 + (0.92 * i) / 220, a = y * 46; th.push([Math.cos(a) * (r(y) + 0.006), y, -Math.sin(a) * (r(y) + 0.006)]); }
    cop.line(th, { w: 0.6 });
    const hook = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * PI * 1.4; hook.push([0.05 * Math.sin(a), 1.0 + 0.05 * (1 - Math.cos(a)), 0]); }
    shaft.line(hook, { w: 1.1 });
    const lead = [];
    const last = th[th.length - 1];
    for (let i = 0; i <= 20; i++) { const u = i / 20; lead.push([last[0] * (1 - u) + 0.0 * u, last[1] + u * 0.55, last[2] * (1 - u)]); }
    for (let i = 1; i <= 20; i++) { const u = i / 20; lead.push([0.04 * Math.sin(u * 3), 1.06 + u * 0.32, 0.02 * u]); }
    shaft.line(lead, { accent: true, w: 0.9 });
    return make([{ shape: shaft }, { shape: whorl }, { shape: cop }], { mode: "spin", pitch: -0.3, roll: 0.16, speed: 0.45 });
  };

  // 4 · Kattenstaart & Pispot: a dandelion clock
  B.dandelion = () => {
    const stalk = cylinder(0.022, 1.3, 10, 0.018);
    const sx = new Shape().add(stalk, M.t(0, -0.33, 0));
    const head = sphere(0.075, 14, 8).xf(M.t(0, 0.34, 0));
    const seeds = new Shape();
    const N = 110, ga = PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), a = i * ga;
      const d = [Math.cos(a) * rr, y, Math.sin(a) * rr];
      if (d[1] < -0.62) continue;
      const c = [0, 0.34, 0], p0 = [c[0] + d[0] * 0.075, c[1] + d[1] * 0.075, c[2] + d[2] * 0.075];
      const L = 0.4, p1 = [c[0] + d[0] * L, c[1] + d[1] * L, c[2] + d[2] * L];
      seeds.line([p0, p1], { w: 0.55 });
      // pappus: a little umbrella of hairs
      let u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let e1 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const l1 = Math.hypot(...e1); e1 = e1.map((x) => x / l1);
      const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
      for (let k = 0; k < 6; k++) {
        const b = (k / 6) * TAU + i, q = [];
        const dir = [d[0] * 0.55 + (e1[0] * Math.cos(b) + e2[0] * Math.sin(b)) * 0.85, d[1] * 0.55 + (e1[1] * Math.cos(b) + e2[1] * Math.sin(b)) * 0.85, d[2] * 0.55 + (e1[2] * Math.cos(b) + e2[2] * Math.sin(b)) * 0.85];
        q.push(p1, [p1[0] + dir[0] * 0.085, p1[1] + dir[1] * 0.085, p1[2] + dir[2] * 0.085]);
        seeds.line(q, { accent: i % 9 === 4, w: 0.5 });
      }
    }
    // toothed leaves
    const leafPoly = [];
    const Ln = 0.78;
    for (let i = 0; i <= 12; i++) { const x = (i / 12) * Ln, w = 0.12 * Math.pow(Math.sin((PI * x) / Ln), 0.8); leafPoly.push([x, w * (i % 2 ? 1.0 : 0.55)]); }
    for (let i = 12; i >= 0; i--) { const x = (i / 12) * Ln, w = 0.12 * Math.pow(Math.sin((PI * x) / Ln), 0.8); leafPoly.push([x, -w * (i % 2 ? 0.55 : 1.0)]); }
    const leaves = new Shape();
    for (let k = 0; k < 5; k++) {
      const leaf = flat(leafPoly);
      leaf.line([[0, 0, 0], [Ln * 0.95, 0, 0.001]], { w: 0.7 });
      leaves.add(leaf, M.chain(M.t(0, -0.98, 0), M.ry((k / 5) * TAU + 0.4), M.rz(0.42 + (k % 2) * 0.18), M.rx(PI / 2)));
    }
    return make([{ shape: sx }, { shape: head }, { shape: seeds }, { shape: leaves }], { mode: "spin", pitch: -0.28, speed: 0.26 });
  };

  // 5 · Atlas van het Alledaagse: seven departments, seven solids, sized by collections
  B.atlas = () => {
    const parts = [];
    const sz = (n) => 0.08 + 0.2 * Math.sqrt(n / 254);
    const tetra = (r) => hull([[r, r, r], [-r, -r, r], [-r, r, -r], [r, -r, -r]].map((v) => v.map((x) => x * 0.62)), [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]);
    const octa = (r) => hull([[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]], [[0, 2, 4], [0, 2, 5], [0, 3, 4], [0, 3, 5], [1, 2, 4], [1, 2, 5], [1, 3, 4], [1, 3, 5]]);
    const plus = (r) => new Shape().add(box(r * 2, r * 0.6, r * 0.6)).add(box(r * 0.6, r * 2, r * 0.6)).add(box(r * 0.6, r * 0.6, r * 2));
    const ex = (r) => new Shape().add(box(r * 2.2, r * 0.45, r * 0.45, M.rz(PI / 4))).add(box(r * 2.2, r * 0.45, r * 0.45, M.rz(-PI / 4)));
    const depts = [
      ["everyday", 254, (r) => tetra(r * 1.25)],
      ["language", 206, (r) => sphere(r, 18, 10)],
      ["song", 102, (r) => box(r * 1.4, r * 1.4, r * 1.4)],
      ["names", 56, (r) => plus(r)],
      ["institute", 32, (r) => cylinder(r, r * 0.5, 22)],
      ["objects", 8, (r) => ex(r)],
      ["library", 4, (r) => octa(r)],
    ];
    const ring = new Shape();
    ring.line(circle(0, 0, 0, 0.92, 72), { closed: true, w: 0.6 });
    const centres = [];
    depts.forEach(([, n, f], i) => {
      const a = (i / depts.length) * TAU, x = Math.cos(a) * 0.92, z = Math.sin(a) * 0.92, y = Math.sin(a * 2) * 0.12;
      centres.push([x, y, z]);
      parts.push({ shape: f(sz(n)), m: M.chain(M.t(x, y, z), M.ry(a * 1.7), M.rx(0.4)) });
      ring.line([[x, 0, z], [x, y, z]], { w: 0.5 });
    });
    // threads between departments whose collections share words
    const th = new Shape();
    [[0, 2], [0, 3], [1, 3], [1, 4], [2, 5], [0, 6], [3, 5], [1, 6]].forEach(([a, b]) => {
      const A = centres[a], C = centres[b], pts = [];
      for (let k = 0; k <= 16; k++) { const u = k / 16, h = Math.sin(u * PI) * 0.35; pts.push([A[0] + (C[0] - A[0]) * u, A[1] + (C[1] - A[1]) * u + h, A[2] + (C[2] - A[2]) * u]); }
      th.line(pts, { accent: true, w: 0.6 });
    });
    parts.push({ shape: ring }, { shape: th });
    return make(parts, { mode: "spin", pitch: -0.42, speed: 0.2, zoom: 1.12 });
  };

  // 6 · Wat bewaart het Meertens: a magnifier over index cards
  B.magnifier = () => {
    const up = M.rx(PI / 2); // lathe/torus axes are vertical; stand them up to face the viewer
    const ring = torus(0.4, 0.05, 36, 8).xf(up);
    const lens = cylinder(0.4, 0.02, 36).xf(up);
    lens.glass = true;
    lens.line(Array.from({ length: 14 }, (_, i) => { const a = 1.9 + (i / 13) * 1.1; return [Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.012]; }), { accent: true, w: 1, nohide: true });
    const handle = new Shape()
      .add(cylinder(0.055, 0.14, 14), M.t(0, -0.5, 0))
      .add(lathe([[0, -1.2], [0.05, -1.2], [0.07, -1.1], [0.062, -0.57], [0, -0.57]], 14));
    const T = M.chain(M.t(0.18, 0.32, 0.12), M.rx(-0.55), M.rz(0.62));
    const cards = new Shape(), R = rng(5);
    for (let c = 0; c < 3; c++) {
      const card = box(1.15, 0.014, 0.74);
      if (c === 2) {
        card.line([[-0.5, 0.009, -0.29], [-0.08, 0.009, -0.29]], { w: 1.3 });
        for (let r = 0; r < 6; r++) {
          let x = -0.5; const z = -0.18 + r * 0.085;
          while (x < 0.45) { const w = 0.05 + R() * 0.16, xe = Math.min(0.5, x + w); card.line([[x, 0.009, z], [xe, 0.009, z]], { w: 0.7, accent: r === 2 && x > -0.25 && x < 0.2 }); x = xe + 0.035; }
        }
      }
      cards.add(card, M.chain(M.t(-0.12 + c * 0.05, -0.62 + c * 0.03, 0.05 - c * 0.04), M.ry(-0.3 + c * 0.17)));
    }
    return make([{ shape: ring, m: T }, { shape: lens, m: T, glass: true }, { shape: handle, m: T }, { shape: cards }], { mode: "sway", pitch: -0.32, speed: 0.3, amp: 0.6, yaw0: 0.15 });
  };

  // 7 · Museum Meertensianum: a vitrine with a globe — a digital twin on its plinth
  B.vitrine = () => {
    const plinth = box(0.82, 1.1, 0.82, M.t(0, -0.6, 0));
    // e-paper label + QR on the front
    plinth.line([[-0.26, -0.25, 0.412], [0.26, -0.25, 0.412], [0.26, -0.42, 0.412], [-0.26, -0.42, 0.412]], { closed: true, w: 0.8 });
    for (let i = 0; i < 3; i++) plinth.line([[-0.22, -0.29 - i * 0.04, 0.412], [0.05 - i * 0.06, -0.29 - i * 0.04, 0.412]], { w: 0.6 });
    plinth.line([[0.12, -0.29, 0.412], [0.22, -0.29, 0.412], [0.22, -0.39, 0.412], [0.12, -0.39, 0.412]], { closed: true, accent: true, w: 0.7 });
    const trim = box(0.9, 0.04, 0.9, M.t(0, -0.02, 0));
    const hood = box(0.8, 0.86, 0.8, M.t(0, 0.43, 0));
    const stand = new Shape().add(lathe([[0, 0], [0.13, 0], [0.12, 0.03], [0.03, 0.06], [0.025, 0.2], [0, 0.2]], 18));
    const globe = sphere(0.21, 22, 12);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * PI; globe.line(Array.from({ length: 33 }, (_, i) => { const b = (i / 32) * TAU; return [Math.cos(a) * Math.cos(b) * 0.212, Math.sin(b) * 0.212, Math.sin(a) * Math.cos(b) * 0.212]; }), { w: 0.5 }); }
    for (const y of [-0.12, 0, 0.12]) globe.line(circle(0, y, 0, Math.sqrt(0.212 ** 2 - y * y), 32), { closed: true, accent: y === 0, w: 0.6 });
    const meridian = new Shape().line(Array.from({ length: 25 }, (_, i) => { const b = -PI / 2 - 0.4 + (i / 24) * (PI + 0.8); return [Math.cos(b) * 0.25, Math.sin(b) * 0.25, 0]; }), { w: 1 });
    const g = new Shape().add(globe).add(meridian);
    return make([
      { shape: plinth }, { shape: trim }, { shape: hood, glass: true },
      { shape: stand, m: M.t(0, 0, 0) },
      { shape: g, m: (t) => M.chain(M.t(0, 0.43, 0), M.rz(0.4), M.ry(t * 0.6)) },
    ], { mode: "spin", pitch: -0.3, speed: 0.22, yaw0: 0.5 });
  };

  // 8 · Op 't Water: a row of gabled houses on the quay, water in front
  B.canal = () => {
    const houses = new Shape();
    const specs = [[0.34, 0.95, "step"], [0.3, 1.12, "neck"], [0.4, 0.88, "bell"], [0.3, 1.02, "spout"], [0.36, 1.08, "step"]];
    const total = specs.reduce((a, s) => a + s[0], 0);
    let x0 = -total / 2;
    const d = 0.8;
    for (const [w, h, type] of specs) {
      const p = [[0, 0], [w, 0], [w, h]];
      if (type === "step") { const st = 3, sw = w / 2 / (st + 0.6); for (let i = 0; i < st; i++) { p.push([w - i * sw, h + (i + 1) * 0.1]); p.push([w - (i + 1) * sw, h + (i + 1) * 0.1]); } p.push([w / 2 + sw * 0.3, h + 0.4], [w / 2 - sw * 0.3, h + 0.4]); for (let i = st - 1; i >= 0; i--) { p.push([i * sw + sw, h + (i + 1) * 0.1]); p.push([i * sw, h + (i + 1) * 0.1]); } }
      else if (type === "neck") { p.push([w * 0.8, h], [w * 0.8, h + 0.26], [w * 0.68, h + 0.32], [w * 0.62, h + 0.4], [w * 0.38, h + 0.4], [w * 0.32, h + 0.32], [w * 0.2, h + 0.26], [w * 0.2, h]); }
      else if (type === "bell") { for (let i = 0; i <= 10; i++) { const u = i / 10, xx = w - u * w * 0.3, yy = h + Math.sin(u * PI / 2) * 0.22; p.push([xx, yy]); } p.push([w * 0.62, h + 0.36], [w * 0.5, h + 0.42], [w * 0.38, h + 0.36]); for (let i = 10; i >= 0; i--) { const u = i / 10, xx = u * w * 0.3, yy = h + Math.sin(u * PI / 2) * 0.22; p.push([xx, yy]); } }
      else { p.push([w * 0.62, h + 0.3], [w * 0.62, h + 0.38], [w * 0.38, h + 0.38], [w * 0.38, h + 0.3]); }
      p.push([0, h]);
      const hs = extrude(p, d);
      // windows and door on the front face
      const z = d / 2 + 0.003, floors = Math.round(h / 0.27);
      for (let f = 0; f < floors; f++) {
        const yb = 0.08 + f * 0.25, ww = w > 0.33 ? 3 : 2, gap = w / (ww + 1);
        for (let k = 1; k <= ww; k++) {
          if (f === 0 && k === Math.ceil(ww / 2)) { hs.line([[k * gap - 0.035, 0, z], [k * gap - 0.035, 0.17, z], [k * gap + 0.035, 0.17, z], [k * gap + 0.035, 0, z]], { w: 0.8 }); continue; }
          const cx = k * gap; hs.line([[cx - 0.03, yb, z], [cx + 0.03, yb, z], [cx + 0.03, yb + 0.13, z], [cx - 0.03, yb + 0.13, z]], { closed: true, w: 0.7 });
          hs.line([[cx, yb, z], [cx, yb + 0.13, z]], { w: 0.4 });
        }
      }
      houses.add(hs, M.t(x0, 0, 0));
      x0 += w;
    }
    const quay = box(total + 0.3, 0.06, 1.25, M.t(0, -0.03, 0.2));
    const water = new Shape(), R = rng(3);
    for (let r = 0; r < 6; r++) {
      const z = 0.92 + r * 0.09, pts = [];
      for (let k = 0; k <= 30; k++) { const x = -total / 2 - 0.15 + ((total + 0.3) * k) / 30; pts.push([x, -0.1, z + Math.sin(k * 0.9 + r * 1.7) * 0.012]); }
      water.line(pts, { accent: r === 2, w: 0.7 });
    }
    // a little boat of song books on the water
    void R;
    return make([{ shape: houses }, { shape: quay }, { shape: water }], { mode: "sway", pitch: -0.36, speed: 0.28, amp: 0.55, yaw0: -0.25, zoom: 1.08 });
  };

  // 9 · Roodkapje: the tree of tellings, one telling's path picked out
  B.tree = () => {
    const tr = new Shape(), R = rng(21);
    const tips = [];
    const grow = (p, d, len, depth, mine) => {
      const q = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
      // a slightly bent branch
      const mid = [(p[0] + q[0]) / 2 + (R() - 0.5) * len * 0.12, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + (R() - 0.5) * len * 0.12];
      tr.line([p, mid, q], { w: 0.5 + depth * 0.32, accent: mine });
      if (depth === 0) { tips.push([q, mine]); return; }
      const kids = depth > 3 ? 2 : R() < 0.45 ? 3 : 2;
      const pick = Math.floor(R() * kids);
      for (let k = 0; k < kids; k++) {
        const a = (k / kids) * TAU + R() * 1.2 + depth;
        const spread = 0.55 + R() * 0.25;
        let nd = [d[0] + Math.cos(a) * spread, d[1] + 0.25, d[2] + Math.sin(a) * spread];
        const l = Math.hypot(...nd); nd = nd.map((x) => x / l);
        grow(q, nd, len * (0.7 + R() * 0.1), depth - 1, mine && k === pick);
      }
    };
    grow([0, -0.95, 0], [0, 1, 0], 0.5, 6, true);
    for (const [q, mine] of tips) tr.line(circle(q[0], q[1], q[2], mine ? 0.04 : 0.012, mine ? 10 : 6, "xy"), { closed: true, accent: mine, w: mine ? 1.3 : 0.45 });
    const ground = cylinder(0.75, 0.04, 36).xf(M.t(0, -0.97, 0));
    // the path through the forest, dashed on the ground
    const path = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30; path.push([0.72 * (1 - u) * Math.cos(u * 2.4), -0.948, 0.72 * (1 - u) * Math.sin(u * 2.4)]); }
    ground.line(path, { accent: true, w: 0.9 });
    return make([{ shape: tr }, { shape: ground }], { mode: "spin", pitch: -0.24, speed: 0.22 });
  };

  // 10 · Sagenland: a stage mill, sails turning
  B.mill = () => {
    const body = lathe([[0, -1], [0.46, -1], [0.46, -0.84], [0.41, -0.82], [0.28, 0.35], [0, 0.35]], 8, { a0: PI / 8 });
    const rad = (y) => 0.41 + (0.28 - 0.41) * ((y + 0.82) / 1.17);
    const zf = (y) => rad(y) * Math.cos(PI / 8) + 0.004;
    body.line([[-0.07, -1, zf(-0.95)], [-0.07, -0.78, zf(-0.78)], [0.07, -0.78, zf(-0.78)], [0.07, -1, zf(-0.95)]], { w: 0.8 });
    for (const y of [-0.12, 0.12]) body.line([[-0.04, y, zf(y)], [0.04, y, zf(y)], [0.04, y + 0.09, zf(y + 0.09)], [-0.04, y + 0.09, zf(y + 0.09)]], { closed: true, w: 0.7 });
    const gallery = lathe([[0, -0.42], [0.66, -0.42], [0.66, -0.39], [0, -0.39]], 8, { a0: PI / 8 });
    const rail = new Shape();
    const oct = Array.from({ length: 8 }, (_, i) => { const a = PI / 8 + (i / 8) * TAU; return [Math.cos(a) * 0.64, -0.27, -Math.sin(a) * 0.64]; });
    rail.line(oct, { closed: true, w: 0.7 });
    for (const p of oct) rail.line([[p[0], -0.39, p[2]], p], { w: 0.6 });
    const cap = lathe([[0.3, 0.35], [0.31, 0.42], [0.25, 0.54], [0.12, 0.62], [0, 0.64]], 12);
    const axle = cylinder(0.04, 0.3, 10).xf(M.chain(M.t(0, 0.47, 0.3), M.rx(PI / 2)));
    const sails = new Shape();
    for (let k = 0; k < 4; k++) {
      const s = new Shape();
      s.line([[0, 0, 0], [0, 1.08, 0]], { w: 1.2 });
      s.line([[0, 0.22, 0], [0.17, 0.22, 0], [0.17, 1.04, 0], [0, 1.04, 0]], { w: 0.8 });
      for (let j = 1; j < 10; j++) { const y = 0.22 + j * 0.082; s.line([[0, y, 0], [0.17, y, 0]], { w: 0.45 }); }
      s.line([[0.085, 0.22, 0], [0.085, 1.04, 0]], { w: 0.45 });
      if (k % 2 === 0) { const cloth = flat([[0.012, 0.3], [0.16, 0.3], [0.16, 1.0], [0.012, 1.0]]); s.add(cloth, M.t(0, 0, -0.01)); }
      sails.add(s, M.rz((k / 4) * TAU));
    }
    return make([
      { shape: body }, { shape: gallery }, { shape: rail }, { shape: cap }, { shape: axle },
      { shape: sails, m: (t) => M.chain(M.t(0, 0.47, 0.46), M.rz(-t * 0.7)) },
    ], { mode: "spin", pitch: -0.16, speed: 0.18, yaw0: 0.4 });
  };

  // 11 · Nachtdienst: the card cabinet, one drawer sliding out
  B.cabinet = () => {
    const Wd = 1.3, Hd = 1.0, Dd = 0.8;
    const body = box(Wd, Hd, Dd);
    const top = box(Wd + 0.08, 0.05, Dd + 0.06, M.t(0, Hd / 2 + 0.025, 0));
    const legs = new Shape();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.add(box(0.06, 0.16, 0.06), M.t(sx * (Wd / 2 - 0.06), -Hd / 2 - 0.08, sz * (Dd / 2 - 0.06)));
    const cw = 0.27, ch = 0.25, gx = (Wd - 4 * cw) / 5, gy = (Hd - 3 * ch) / 4, z = Dd / 2 + 0.003;
    const OUT = [2, 1];
    const fr = (x, y) => [[x, y, z], [x + cw, y, z], [x + cw, y + ch, z], [x, y + ch, z]];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) {
      const x = -Wd / 2 + gx + c * (cw + gx), y = -Hd / 2 + gy + r * (ch + gy);
      body.line(fr(x, y), { closed: true, w: 0.8 });
      if (c === OUT[0] && r === OUT[1]) continue;
      body.line([[x + cw * 0.3, y + ch * 0.66, z], [x + cw * 0.7, y + ch * 0.66, z], [x + cw * 0.7, y + ch * 0.82, z], [x + cw * 0.3, y + ch * 0.82, z]], { closed: true, w: 0.55, accent: c === 1 && r === 2 });
      body.line(circle(x + cw / 2, y + ch * 0.36, z, 0.025, 10, "xy"), { closed: true, w: 0.6 });
    }
    // the drawer: open box with cards
    const dx = -Wd / 2 + gx + OUT[0] * (cw + gx), dy = -Hd / 2 + gy + OUT[1] * (ch + gy), dl = 0.62;
    const dr = new Shape();
    const v = (x, y, zz) => dr.vert(x, y, zz);
    const w = cw - 0.01, h = ch - 0.01;
    const P = [v(0, 0, 0), v(w, 0, 0), v(w, 0, -dl), v(0, 0, -dl), v(0, h, 0), v(w, h, 0), v(w, h * 0.8, -dl), v(0, h * 0.8, -dl)];
    dr.quad(P[0], P[1], P[5], P[4]); // front
    dr.quad(P[3], P[2], P[1], P[0]); // bottom
    dr.quad(P[1], P[2], P[6], P[5]); // right
    dr.quad(P[3], P[0], P[4], P[7]); // left
    dr.quad(P[2], P[3], P[7], P[6]); // back
    dr.line([[w * 0.3, h * 0.66, 0.003], [w * 0.7, h * 0.66, 0.003], [w * 0.7, h * 0.82, 0.003], [w * 0.3, h * 0.82, 0.003]], { closed: true, w: 0.55, accent: true });
    dr.line(circle(w / 2, h * 0.36, 0.003, 0.025, 10, "xy"), { closed: true, w: 0.6 });
    for (let k = 0; k < 9; k++) {
      const zz = -0.06 - k * 0.058, ht = h * 0.95 + (k === 3 ? 0.05 : 0);
      const card = flat([[0.02, 0.01], [w - 0.02, 0.01], [w - 0.02, ht], [0.02, ht]]);
      if (k === 3) card.line([[0.06, ht - 0.03, 0.002], [0.13, ht - 0.03, 0.002]], { accent: true, w: 0.8 });
      dr.add(card, M.t(0, 0, zz));
    }
    const ease = (t) => { const c = (t * 0.22) % 1; const u = c < 0.15 ? 0 : c < 0.35 ? (c - 0.15) / 0.2 : c < 0.75 ? 1 : c < 0.95 ? 1 - (c - 0.75) / 0.2 : 0; return u * u * (3 - 2 * u); };
    return make([
      { shape: body }, { shape: top }, { shape: legs },
      { shape: dr, m: (t) => M.t(dx + 0.005, dy + 0.005, z + ease(t) * 0.48 - 0.002) },
    ], { mode: "sway", pitch: -0.3, speed: 0.25, amp: 0.42, yaw0: -0.45, pad: 1 });
  };

  // 0 · The emblem: an acid-free archive box, lid open, one record lifted out
  B.box = () => {
    const w = 1.2, h = 0.6, d = 0.8;
    const bx = new Shape();
    const V = [];
    for (let i = 0; i < 8; i++) V.push(bx.vert(i & 1 ? w / 2 : -w / 2, i & 2 ? h : 0, i & 4 ? d / 2 : -d / 2));
    bx.quad(V[4], V[5], V[7], V[6]); // front
    bx.quad(V[1], V[0], V[2], V[3]); // back
    bx.quad(V[5], V[1], V[3], V[7]); // right
    bx.quad(V[0], V[4], V[6], V[2]); // left
    bx.quad(V[0], V[1], V[5], V[4]); // bottom
    const zf = d / 2 + 0.004;
    // label holder with a typed label, and a finger hole
    bx.line([[-0.26, 0.3, zf], [0.26, 0.3, zf], [0.26, 0.48, zf], [-0.26, 0.48, zf]], { closed: true, w: 0.8 });
    bx.line([[-0.2, 0.42, zf], [0.12, 0.42, zf]], { w: 0.6, accent: true });
    bx.line([[-0.2, 0.36, zf], [0.04, 0.36, zf]], { w: 0.6 });
    bx.line(circle(0, 0.15, zf, 0.05, 14, "xy"), { closed: true, w: 0.7 });
    // cards with tabs, filed front to back
    const cards = new Shape();
    const hc = h * 0.86, tabs = [-0.38, -0.05, 0.27];
    for (let k = 0; k < 11; k++) {
      if (k === 5) continue;
      const z = d / 2 - 0.1 - k * 0.058, tl = tabs[k % 3];
      const poly = [[-w / 2 + 0.05, 0.02], [w / 2 - 0.05, 0.02], [w / 2 - 0.05, hc], [tl + 0.2, hc], [tl + 0.2, hc + 0.07], [tl, hc + 0.07], [tl, hc], [-w / 2 + 0.05, hc]];
      cards.add(flat(poly), M.t(0, 0, z));
    }
    // the lifted record
    const rec = flat([[-w / 2 + 0.05, 0.02], [w / 2 - 0.05, 0.02], [w / 2 - 0.05, hc], [0.02, hc], [0.02, hc + 0.07], [-0.2, hc + 0.07], [-0.2, hc], [-w / 2 + 0.05, hc]]);
    for (let r = 0; r < 4; r++) rec.line([[-0.44, hc - 0.12 - r * 0.09, 0.004], [0.3 - (r % 2) * 0.2, hc - 0.12 - r * 0.09, 0.004]], { w: 0.6, accent: r === 0 });
    const lid = box(w + 0.05, 0.04, d + 0.05);
    lid.line([[-0.3, -0.021, -0.1], [0.3, -0.021, -0.1], [0.3, -0.021, 0.12], [-0.3, -0.021, 0.12]], { closed: true, w: 0.6 });
    return make([
      { shape: bx }, { shape: cards },
      { shape: rec, m: (t) => M.t(0, 0.2 + 0.07 * Math.sin(t * 0.9), d / 2 - 0.1 - 5 * 0.058) },
      { shape: lid, m: M.chain(M.t(0, h, -d / 2 - 0.02), M.rx(-2.25), M.t(0, 0.02, (d + 0.05) / 2)) },
    ], { mode: "sway", pitch: -0.62, speed: 0.26, amp: 0.5, yaw0: -0.5, zoom: 1.1 });
  };

  const cache = {};
  function get(key) { return cache[key] || (cache[key] = B[key]()); }

  window.Objects = { get, pose, keys: Object.keys(B) };
})();
