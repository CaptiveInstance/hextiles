/*
 * Hexia Garden — non-competitive infinite mode.
 * You and Claude take turns growing one shared pattern. Every piece after
 * the first must touch the existing pattern. Your pieces drift toward green,
 * Claude's toward red (hue only — saturation and lightness stay fixed), so
 * every individual piece is distinguishable from its neighbors.
 */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const SIZE = 40;
  const LINE_COLOR = "#f5f2e9";
  const BG = "#f6f3ec";

  const DIRS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  const key = (q, r) => q + "," + r;

  // ---- colors -------------------------------------------------------------
  // Fixed palettes: you are teal, Claude is coral. The white triangle art
  // does the visual talking.
  const COLORS = [
    { fill: "#a9c4bd", edge: "#8aa9a1" }, // you: teal
    { fill: "#d99b80", edge: "#bf7f63" }, // Claude: coral
  ];
  function colorFor(player, n) {
    return COLORS[player];
  }

  // ---- game state --------------------------------------------------------

  let cellOwner;   // Map "q,r" -> piece index
  let pieces;      // [{ cells, player, fill, edge }]
  let placedBy;    // [player0Count, player1Count]
  let current;     // whose turn: 0 or 1
  let withClaude = true; // false = pass-and-play with a friend
  let currentRot = 0;
  let hovered = null;
  let busy = false;  // Claude is "thinking"
  let armed = null;  // touch devices: cell key awaiting a confirming tap

  function isHumanTurn() {
    return !busy && (!withClaude || current === 0);
  }

  const IS_TOUCH = typeof window.matchMedia === "function"
    && window.matchMedia("(hover: none)").matches;

  function clusterCells(q, r, i) {
    i = ((i % 6) + 6) % 6;
    const j = (i + 1) % 6;
    return [
      [q, r],
      [q + DIRS[i][0], r + DIRS[i][1]],
      [q + DIRS[j][0], r + DIRS[j][1]],
    ];
  }

  function isEmpty(q, r) { return !cellOwner.has(key(q, r)); }

  function touchesPattern(cells) {
    if (pieces.length === 0) return true;
    const own = new Set(cells.map(c => key(c[0], c[1])));
    for (const [q, r] of cells) {
      for (const d of DIRS) {
        const nk = key(q + d[0], r + d[1]);
        if (!own.has(nk) && cellOwner.has(nk)) return true;
      }
    }
    return false;
  }

  function canPlace(q, r, i) {
    const cells = clusterCells(q, r, i);
    for (const [cq, cr] of cells) if (!isEmpty(cq, cr)) return false;
    return touchesPattern(cells);
  }

  function doPlace(q, r, i, player) {
    const cells = clusterCells(q, r, i);
    const col = colorFor(player, placedBy[player]);
    const piece = { cells: cells, player: player, fill: col.fill, edge: col.edge };
    pieces.push(piece);
    placedBy[player]++;
    for (const [cq, cr] of cells) cellOwner.set(key(cq, cr), pieces.length - 1);
    return piece;
  }

  // Empty cells adjacent to the pattern (clickable anchors). Before the
  // first piece: a small starting patch around the origin.
  function frontierCells() {
    const out = new Map();
    if (pieces.length === 0) {
      out.set("0,0", [0, 0]);
      for (const d of DIRS) out.set(key(d[0], d[1]), [d[0], d[1]]);
      return [...out.values()];
    }
    for (const k of cellOwner.keys()) {
      const [q, r] = k.split(",").map(Number);
      for (const d of DIRS) {
        const nq = q + d[0], nr = r + d[1];
        if (isEmpty(nq, nr)) out.set(key(nq, nr), [nq, nr]);
      }
    }
    return [...out.values()];
  }

  // ---- geometry & svg ----------------------------------------------------

  function center(q, r) {
    return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r };
  }

  function hexPoints(cx, cy, scale) {
    const s = SIZE * (scale || 1);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      pts.push((cx + s * Math.cos(a)).toFixed(2) + "," + (cy + s * Math.sin(a)).toFixed(2));
    }
    return pts.join(" ");
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  // The piece: each hex carries five cream rays converging to a SINGLE POINT
  // at its outermost vertex (the apex), fanning inward toward the shared
  // corner P. Outer rays trace the big triangle's edges; the middle rays of
  // all three hexes meet at P. No outlines, no lines between hexes.
  function hexRays(g, c, P) {
    const rad = d => (Math.PI / 180) * d;
    const th = Math.atan2(P.y - c.y, P.x - c.x) * 180 / Math.PI; // apex -> P direction
    const apex = { x: c.x + SIZE * Math.cos(rad(th + 180)), y: c.y + SIZE * Math.sin(rad(th + 180)) };
    // hex vertices flanking P: every ray terminates on edge (P,E1) or (P,E2),
    // and every end cap is MITERED along that edge so rays from neighboring
    // hexes join flush — no chips at the seams.
    const Pv = { x: c.x + SIZE * Math.cos(rad(th)), y: c.y + SIZE * Math.sin(rad(th)) };
    const E1 = { x: c.x + SIZE * Math.cos(rad(th - 60)), y: c.y + SIZE * Math.sin(rad(th - 60)) };
    const E2 = { x: c.x + SIZE * Math.cos(rad(th + 60)), y: c.y + SIZE * Math.sin(rad(th + 60)) };
    const w = SIZE * 0.09;     // constant ray width
    const tipLen = w * 1.6;    // needle that pinches the strip to the apex point

    function cut(pxy, dx, dy, A, B) {
      const ex = B.x - A.x, ey = B.y - A.y;
      const t = ((A.x - pxy.x) * ey - (A.y - pxy.y) * ex) / (dx * ey - dy * ex);
      return { x: pxy.x + dx * t, y: pxy.y + dy * t };
    }
    const pt = p => p.x.toFixed(2) + "," + p.y.toFixed(2);

    for (const delta of [-30, -15, 0, 15, 30]) {
      const d = th + delta;
      const dx = Math.cos(rad(d)), dy = Math.sin(rad(d));
      const px = Math.cos(rad(d + 90)), py = Math.sin(rad(d + 90));
      const nb = { x: apex.x + dx * tipLen, y: apex.y + dy * tipLen };

      if (Math.abs(delta) === 30) {
        const end = delta > 0 ? E2 : E1; // chord end = flanking vertex
        const pin = rad(d - Math.sign(delta) * 90);
        const ix = Math.cos(pin), iy = Math.sin(pin);
        const innerStart = { x: apex.x + ix * w, y: apex.y + iy * w };
        const innerCut = cut(innerStart, dx, dy, end, Pv);
        const nbi = { x: nb.x + ix * w, y: nb.y + iy * w };
        el("polygon", {
          points: [pt(apex), pt(end), pt(innerCut), pt(nbi)].join(" "),
          fill: LINE_COLOR,
        }, g);
      } else if (delta !== 0) {
        const lineE = delta > 0 ? E2 : E1;
        const eP = { x: apex.x + px * w / 2, y: apex.y + py * w / 2 };
        const eM = { x: apex.x - px * w / 2, y: apex.y - py * w / 2 };
        const cP = cut(eP, dx, dy, lineE, Pv);
        const cM = cut(eM, dx, dy, lineE, Pv);
        const nbP = { x: nb.x + px * w / 2, y: nb.y + py * w / 2 };
        const nbM = { x: nb.x - px * w / 2, y: nb.y - py * w / 2 };
        el("polygon", {
          points: [pt(apex), pt(nbP), pt(cP), pt(cM), pt(nbM)].join(" "),
          fill: LINE_COLOR,
        }, g);
      } else {
        const s1 = (E1.x - Pv.x) * px + (E1.y - Pv.y) * py;
        const linePlus = s1 > 0 ? E1 : E2;
        const lineMinus = s1 > 0 ? E2 : E1;
        const eP = { x: apex.x + px * w / 2, y: apex.y + py * w / 2 };
        const eM = { x: apex.x - px * w / 2, y: apex.y - py * w / 2 };
        const cP = cut(eP, dx, dy, linePlus, Pv);
        const cM = cut(eM, dx, dy, lineMinus, Pv);
        const nbP = { x: nb.x + px * w / 2, y: nb.y + py * w / 2 };
        const nbM = { x: nb.x - px * w / 2, y: nb.y - py * w / 2 };
        el("polygon", {
          points: [pt(apex), pt(nbP), pt(cP), pt(Pv), pt(cM), pt(nbM)].join(" "),
          fill: LINE_COLOR,
        }, g);
      }
    }
  }

  // ---- tutorial illustrations (used by index.html) ------------------------
  window.HexafoilArt = function (container, specs) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sp of specs) {
      for (const [q, r] of sp.cells) {
        const c = center(q, r);
        minX = Math.min(minX, c.x - SIZE * 1.05); maxX = Math.max(maxX, c.x + SIZE * 1.05);
        minY = Math.min(minY, c.y - SIZE * 1.05); maxY = Math.max(maxY, c.y + SIZE * 1.05);
      }
    }
    const s = el("svg", {
      viewBox: [minX, minY, maxX - minX, maxY - minY].map(v => v.toFixed(0)).join(" "),
    }, container);
    for (const sp of specs) {
      const col = COLORS[sp.player];
      const g = pieceGroup(sp.cells, col.fill, col.edge);
      if (sp.ghost) g.setAttribute("opacity", "0.45");
      s.appendChild(g);
    }
  };

  function pieceGroup(cells, fill, edge) {
    const g = el("g", { class: "piece" });
    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };

    for (const c of ctrs) {
      el("polygon", { points: hexPoints(c.x, c.y, 1), fill: fill }, g);
      hexRays(g, c, P);
    }
    return g;
  }

  // ---- rendering ---------------------------------------------------------

  let svg;

  function render(popLast) {
    const boardEl = document.getElementById("board");
    boardEl.innerHTML = "";

    const frontier = frontierCells();

    // bounds over everything we draw
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const consider = [];
    for (const p of pieces) for (const c of p.cells) consider.push(c);
    for (const c of frontier) consider.push(c);
    for (const [q, r] of consider) {
      const c = center(q, r);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    const pad = SIZE * 1.6;
    svg = el("svg", {
      viewBox: [(minX - pad).toFixed(0), (minY - pad).toFixed(0),
                (maxX - minX + 2 * pad).toFixed(0), (maxY - minY + 2 * pad).toFixed(0)].join(" "),
      width: "100%",
    }, boardEl);

    const cellLayer = el("g", {}, svg);
    const pieceLayer = el("g", { "pointer-events": "none" }, svg);

    for (const [q, r] of frontier) {
      const c = center(q, r);
      const g = el("g", { class: "cell" }, cellLayer);
      el("polygon", { points: hexPoints(c.x, c.y, 0.97), class: "base" }, g);
      g.addEventListener("click", () => tryPlace(q, r));
      g.addEventListener("mouseenter", () => { hovered = [q, r]; showGhost(); });
      g.addEventListener("mouseleave", () => { hideGhost(); hovered = null; });
    }

    pieces.forEach(function (p, n) {
      const g = pieceGroup(p.cells, p.fill, p.edge);
      if (popLast && n === pieces.length - 1) g.classList.add("pop");
      pieceLayer.appendChild(g);
    });

    window._gardenPieceLayer = pieceLayer;
  }

  function showGhost() {
    if (!hovered || !isHumanTurn()) return;
    hideGhost();
    const [q, r] = hovered;
    for (let d = 0; d < 6; d++) {
      const rot = (currentRot + d) % 6;
      if (canPlace(q, r, rot)) {
        if (d > 0) { currentRot = rot; renderTray(); }
        const col = colorFor(current, placedBy[current]);
        const ghost = pieceGroup(clusterCells(q, r, rot), col.fill, col.edge);
        ghost.classList.add("ghost");
        window._gardenPieceLayer.appendChild(ghost);
        return;
      }
    }
  }

  function hideGhost() {
    const old = svg && svg.querySelector(".ghost");
    if (old) old.remove();
  }

  function rotate() {
    if (hovered && isHumanTurn()) {
      const [q, r] = hovered;
      for (let d = 1; d <= 6; d++) {
        const rot = (currentRot + d) % 6;
        if (canPlace(q, r, rot)) { currentRot = rot; break; }
      }
    } else {
      currentRot = (currentRot + 1) % 6;
    }
    renderTray();
    showGhost();
  }

  // ---- turns -------------------------------------------------------------

  function tryPlace(q, r) {
    if (!isHumanTurn()) return;
    if (IS_TOUCH) {
      // first tap previews, second tap on the same cell places
      const k = key(q, r);
      if (armed !== k) {
        hovered = [q, r];
        hideGhost();
        showGhost();
        armed = svg.querySelector(".ghost") ? k : null;
        return;
      }
      armed = null;
    }
    let rot = currentRot;
    if (!canPlace(q, r, rot)) {
      let found = -1;
      for (let d = 1; d < 6; d++) {
        const t = (currentRot + d) % 6;
        if (canPlace(q, r, t)) { found = t; break; }
      }
      if (found < 0) return;
      rot = currentRot = found;
    }
    doPlace(q, r, rot, current);
    current = 1 - current;
    render(true);
    updateStatus();
    if (withClaude && current === 1) setTimeout(claudeMove, 800);
  }

  // Can this empty cell still belong to SOME all-empty cluster? If not, it's
  // an orphan: hemmed in so it can never be part of a piece.
  function cellCanHostPiece(q, r) {
    for (let i = 0; i < 6; i++) {
      const cells = clusterCells(q, r, i);
      let ok = true;
      for (const [cq, cr] of cells) if (!isEmpty(cq, cr)) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  // Orphaned empty cells within distance 2 of the given cells (the only
  // region a placement there can affect).
  function orphansNear(cells) {
    const seen = new Set();
    const out = [];
    const ring = [[0, 0]].concat(DIRS);
    for (const [q, r] of cells) {
      for (const d1 of ring) {
        for (const d2 of ring) {
          const nq = q + d1[0] + d2[0], nr = r + d1[1] + d2[1];
          const k = key(nq, nr);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!isEmpty(nq, nr)) continue;
          if (!cellCanHostPiece(nq, nr)) out.push(k);
        }
      }
    }
    return out;
  }

  // How many empty cells would this placement newly orphan?
  function orphanCost(cells) {
    const before = new Set(orphansNear(cells));
    for (const [q, r] of cells) cellOwner.set(key(q, r), -1); // try it on
    let cost = 0;
    for (const k of orphansNear(cells)) if (!before.has(k)) cost++;
    for (const [q, r] of cells) cellOwner.delete(key(q, r)); // take it off
    return cost;
  }

  function claudeMove() {
    // stale or invalid wake-ups: toggled to friend mode, already thinking,
    // or no longer coral's turn
    if (busy || !withClaude || current !== 1) return;
    busy = true;
    updateStatus();
    setTimeout(function () {
      if (!withClaude) { // toggled off while "thinking" — hand turn to friend
        busy = false;
        updateStatus();
        return;
      }
      // organic growth: never orphan empty hexes if avoidable, then prefer
      // staying close to the pattern's center of mass, with a little wander
      let sx = 0, sy = 0, n = 0;
      for (const k of cellOwner.keys()) {
        const [q, r] = k.split(",").map(Number);
        const c = center(q, r);
        sx += c.x; sy += c.y; n++;
      }
      const cx = sx / n, cy = sy / n;
      let best = null, bestScore = Infinity;
      for (const [q, r] of frontierCells()) {
        for (let i = 0; i < 6; i++) {
          if (!canPlace(q, r, i)) continue;
          const cells = clusterCells(q, r, i);
          let px = 0, py = 0;
          for (const [pq, pr] of cells) { const c = center(pq, pr); px += c.x / 3; py += c.y / 3; }
          const score = orphanCost(cells) * 100000
            + Math.hypot(px - cx, py - cy)
            + Math.random() * SIZE * 1.5;
          if (score < bestScore) { bestScore = score; best = { q: q, r: r, i: i }; }
        }
      }
      if (best) doPlace(best.q, best.r, best.i, 1);
      busy = false;
      current = 0;
      render(true);
      updateStatus();
    }, 500);
  }

  // ---- panel -------------------------------------------------------------

  function renderTray() {
    const box = document.getElementById("next-tile");
    box.innerHTML = "";
    const cells = clusterCells(0, 0, currentRot);
    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };
    const m = SIZE * 2.1;
    const s = el("svg", { viewBox: [P.x - m, P.y - m, 2 * m, 2 * m].join(" ") }, box);
    const col = colorFor(current, placedBy[current]);
    s.appendChild(pieceGroup(cells, col.fill, col.edge));
  }

  function updateStatus() {
    const status = document.getElementById("status");
    document.getElementById("who-1").textContent = withClaude ? "Claude" : "Friend";
    if (busy) {
      status.textContent = "Claude is placing…";
    } else if (withClaude) {
      status.textContent = "Your turn — hexafoil #" + (placedBy[0] + 1);
    } else {
      status.textContent = (current === 0 ? "You to play (teal)" : "Friend to play (coral)");
    }
    document.getElementById("count-you").textContent = placedBy[0];
    document.getElementById("count-claude").textContent = placedBy[1];
    renderTray();
  }

  function newGarden() {
    cellOwner = new Map();
    pieces = [];
    placedBy = [0, 0];
    current = 0;
    busy = false;
    currentRot = 0;
    hovered = null;
    armed = null;
    render(false);
    updateStatus();
  }

  // ---- init --------------------------------------------------------------

  document.getElementById("new-game").addEventListener("click", newGarden);
  document.getElementById("with-claude").addEventListener("change", function (e) {
    withClaude = e.target.checked;
    updateStatus(); // keep the garden — just swap who plays coral
    if (withClaude && current === 1) setTimeout(claudeMove, 400);
  });
  document.getElementById("rotate").addEventListener("click", rotate);
  document.getElementById("next-tile").addEventListener("click", rotate);
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") rotate();
  });

  newGarden();
})();
