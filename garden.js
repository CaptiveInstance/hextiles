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
  let moves = [];    // every move this garden: {q,r,i,player} — for online sync
  let net = null;    // online session: { peer, conn, myIndex, hostId }
  let duel = false;  // duel mode: first untouched triangle wins
  let winner = null; // player index of the winner, or null while playing
  let winningPieceIdx = -1; // index of the isolated piece that ended the game
  let boardR = 0;    // 0 = infinite garden; otherwise hex-board radius (2 -> 19 cells)

  function inBoard(q, r) {
    if (!boardR) return true;
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= boardR;
  }

  function isHumanTurn() {
    if (busy || winner !== null) return false;
    if (net) return !!net.conn && current === net.myIndex;
    return !withClaude || current === 0;
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
    for (const [cq, cr] of cells) {
      if (!inBoard(cq, cr)) return false;  // walls are walls
      if (!isEmpty(cq, cr)) return false;
    }
    if (!touchesPattern(cells)) return false;
    // RULE: no move may strand empty cells that could never again hold a
    // hexafoil (e.g. sealing off a 1- or 2-cell pocket). Applies to everyone.
    return orphanCost(cells) === 0;
  }

  function doPlace(q, r, i, player) {
    const cells = clusterCells(q, r, i);
    const col = colorFor(player, placedBy[player]);
    const piece = { cells: cells, player: player, fill: col.fill, edge: col.edge };
    piece.contacts = contactKeys(cells);
    pieces.push(piece);
    placedBy[player]++;
    for (const [cq, cr] of cells) cellOwner.set(key(cq, cr), pieces.length - 1);
    moves.push({ q: q, r: r, i: i, player: player });
    if (duel && winner === null) {
      const idx = findUntouchedTriangle();
      if (idx !== -1) { winner = player; winningPieceIdx = idx; }
    }
    return piece;
  }

  // ---- duel mode: the untouched triangle -----------------------------------
  // A piece's drawn triangle meets its own boundary at exactly six points:
  // its three apex corners and the three chord midpoints (the outer vertex
  // shared by each pair of its hexes). Two triangles touch iff their pieces
  // share one of those points. A player WINS by placing the piece that
  // completes an arrangement where some piece is fully walled in AND its
  // triangle touches no other triangle.
  function contactKeys(cells) {
    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };
    const pts = [];
    for (const c of ctrs) pts.push([2 * c.x - P.x, 2 * c.y - P.y]); // apex corners
    pts.push([ctrs[0].x + ctrs[1].x - P.x, ctrs[0].y + ctrs[1].y - P.y]); // chord midpoints
    pts.push([ctrs[0].x + ctrs[2].x - P.x, ctrs[0].y + ctrs[2].y - P.y]);
    pts.push([ctrs[1].x + ctrs[2].x - P.x, ctrs[1].y + ctrs[2].y - P.y]);
    return pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1));
  }

  function isSurrounded(cells) {
    const own = new Set(cells.map(c => key(c[0], c[1])));
    for (const [q, r] of cells) {
      for (const d of DIRS) {
        const nk = key(q + d[0], r + d[1]);
        if (!own.has(nk) && !cellOwner.has(nk)) return false;
      }
    }
    return true;
  }

  function trianglesTouch(a, b) {
    for (const ck of a.contacts) {
      if (b.contacts.indexOf(ck) !== -1) return true;
    }
    return false;
  }

  // Any piece fully surrounded with an untouched triangle? Returns its index.
  function findUntouchedTriangle() {
    for (let n = 0; n < pieces.length; n++) {
      if (!isSurrounded(pieces[n].cells)) continue;
      let touched = false;
      for (let m = 0; m < pieces.length; m++) {
        if (m !== n && trianglesTouch(pieces[n], pieces[m])) { touched = true; break; }
      }
      if (!touched) return n;
    }
    return -1;
  }

  // Would placing this piece end the game? (Only pieces adjacent to the new
  // one can newly become surrounded, so the scan stays local.)
  function winIfPlaced(q, r, i) {
    const cells = clusterCells(q, r, i);
    const temp = { cells: cells, contacts: contactKeys(cells) };
    const cellSet = new Set(cells.map(c => key(c[0], c[1])));
    for (const [cq, cr] of cells) cellOwner.set(key(cq, cr), -1);
    pieces.push(temp);
    const near = [temp];
    for (const p of pieces) {
      if (p === temp) continue;
      let adj = false;
      for (const [pq, pr] of p.cells) {
        for (const d of DIRS) {
          if (cellSet.has(key(pq + d[0], pr + d[1]))) { adj = true; break; }
        }
        if (adj) break;
      }
      if (adj) near.push(p);
    }
    let win = false;
    for (const cand of near) {
      if (!isSurrounded(cand.cells)) continue;
      let touched = false;
      for (const p of pieces) {
        if (p !== cand && trianglesTouch(cand, p)) { touched = true; break; }
      }
      if (!touched) { win = true; break; }
    }
    pieces.pop();
    for (const [cq, cr] of cells) cellOwner.delete(key(cq, cr));
    return win;
  }

  // After a hypothetical move of mine, could the opponent win immediately?
  function allowsOpponentWin(q, r, i) {
    const cells = clusterCells(q, r, i);
    const temp = { cells: cells, contacts: contactKeys(cells) };
    for (const [cq, cr] of cells) cellOwner.set(key(cq, cr), -1);
    pieces.push(temp);
    let bad = false;
    outer:
    for (const [fq, fr] of frontierCells()) {
      for (let fi = 0; fi < 6; fi++) {
        if (canPlace(fq, fr, fi) && winIfPlaced(fq, fr, fi)) { bad = true; break outer; }
      }
    }
    pieces.pop();
    for (const [cq, cr] of cells) cellOwner.delete(key(cq, cr));
    return bad;
  }

  // Empty cells adjacent to the pattern (clickable anchors). Before the
  // first piece: a small starting patch around the origin.
  function allBoardCells() {
    const out = [];
    for (let q = -boardR; q <= boardR; q++) {
      for (let r = -boardR; r <= boardR; r++) {
        if (inBoard(q, r)) out.push([q, r]);
      }
    }
    return out;
  }

  function frontierCells() {
    const out = new Map();
    if (pieces.length === 0) {
      if (boardR) return allBoardCells();
      out.set("0,0", [0, 0]);
      for (const d of DIRS) out.set(key(d[0], d[1]), [d[0], d[1]]);
      return [...out.values()];
    }
    for (const k of cellOwner.keys()) {
      const [q, r] = k.split(",").map(Number);
      for (const d of DIRS) {
        const nq = q + d[0], nr = r + d[1];
        if (inBoard(nq, nr) && isEmpty(nq, nr)) out.set(key(nq, nr), [nq, nr]);
      }
    }
    return [...out.values()];
  }

  // Hexagonal "graph paper": a generous field of empty cells so a hexafoil
  // always has room around it and never appears to drop off the edge. We draw
  // every empty cell within PAPER_RADIUS rings of the pattern (or of the
  // origin before the first piece). Frontier cells are still where legal
  // placements live; this just gives them visible space to grow into.
  const PAPER_RADIUS = 3;

  function addDisk(cq, cr, radius, out) {
    for (let dq = -radius; dq <= radius; dq++) {
      const lo = Math.max(-radius, -dq - radius);
      const hi = Math.min(radius, -dq + radius);
      for (let dr = lo; dr <= hi; dr++) {
        const q = cq + dq, r = cr + dr;
        if (isEmpty(q, r)) out.set(key(q, r), [q, r]);
      }
    }
  }

  function paperCells() {
    if (boardR) return allBoardCells().filter(([q, r]) => isEmpty(q, r)); // walled board: show exactly the board
    const out = new Map();
    if (pieces.length === 0) {
      addDisk(0, 0, PAPER_RADIUS + 1, out);
    } else {
      for (const k of cellOwner.keys()) {
        const [q, r] = k.split(",").map(Number);
        addDisk(q, r, PAPER_RADIUS, out);
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

    const paper = paperCells();

    // bounds over everything we draw
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const consider = [];
    for (const p of pieces) for (const c of p.cells) consider.push(c);
    for (const c of paper) consider.push(c);
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

    for (const [q, r] of paper) {
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

    // duel victory: crown the untouched triangle in gold
    if (winner !== null && winningPieceIdx >= 0 && pieces[winningPieceIdx]) {
      const wp = pieces[winningPieceIdx];
      const ctrs = wp.cells.map(([q, r]) => center(q, r));
      const P = {
        x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
        y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
      };
      const pts = ctrs.map(c => (2 * c.x - P.x).toFixed(1) + "," + (2 * c.y - P.y).toFixed(1));
      el("polygon", {
        points: pts.join(" "),
        fill: "none",
        stroke: "#e3b34c",
        "stroke-width": 6,
        "stroke-linejoin": "round",
        class: "win-tri",
      }, pieceLayer);
    }

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
    if (net && net.conn) net.conn.send({ t: "move", q: q, r: r, i: rot });
    current = 1 - current;
    render(true);
    updateStatus();
    if (!net && withClaude && current === 1) setTimeout(claudeMove, 800);
  }

  // Can this empty cell still belong to SOME all-empty cluster? If not, it's
  // an orphan: hemmed in so it can never be part of a piece.
  function cellCanHostPiece(q, r) {
    for (let i = 0; i < 6; i++) {
      const cells = clusterCells(q, r, i);
      let ok = true;
      for (const [cq, cr] of cells) if (!inBoard(cq, cr) || !isEmpty(cq, cr)) { ok = false; break; }
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
          if (!inBoard(nq, nr)) continue;   // beyond the wall is nobody's problem
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
    // stale or invalid wake-ups: online session, toggled to friend mode,
    // already thinking, game already won, or no longer coral's turn
    if (busy || net || !withClaude || current !== 1 || winner !== null) return;
    busy = true;
    updateStatus();
    setTimeout(function () {
      if (!withClaude) { // toggled off while "thinking" — hand turn to friend
        busy = false;
        updateStatus();
        return;
      }
      let pick = null;

      // Duel: take a winning placement if one exists
      if (duel) {
        outerWin:
        for (const [q, r] of frontierCells()) {
          for (let i = 0; i < 6; i++) {
            if (canPlace(q, r, i) && winIfPlaced(q, r, i)) { pick = { q: q, r: r, i: i }; break outerWin; }
          }
        }
      }

      if (!pick) {
        // organic growth: prefer staying close to the pattern's center of
        // mass, with a little wander (orphan moves are illegal for everyone)
        let sx = 0, sy = 0, n = 0;
        for (const k of cellOwner.keys()) {
          const [q, r] = k.split(",").map(Number);
          const c = center(q, r);
          sx += c.x; sy += c.y; n++;
        }
        const cx = sx / n, cy = sy / n;
        const candidates = [];
        for (const [q, r] of frontierCells()) {
          for (let i = 0; i < 6; i++) {
            if (!canPlace(q, r, i)) continue;
            const cells = clusterCells(q, r, i);
            let px = 0, py = 0;
            for (const [pq, pr] of cells) { const c = center(pq, pr); px += c.x / 3; py += c.y / 3; }
            candidates.push({
              q: q, r: r, i: i,
              score: Math.hypot(px - cx, py - cy) + Math.random() * SIZE * 1.5,
            });
          }
        }
        candidates.sort((a, b) => a.score - b.score);
        if (duel) {
          // don't tee up an immediate win for the opponent, if avoidable
          for (let n2 = 0; n2 < candidates.length && n2 < 15; n2++) {
            if (!allowsOpponentWin(candidates[n2].q, candidates[n2].r, candidates[n2].i)) {
              pick = candidates[n2];
              break;
            }
          }
        }
        if (!pick && candidates.length) pick = candidates[0];
      }

      if (pick) doPlace(pick.q, pick.r, pick.i, 1);
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
    if (winner !== null) return; // game over — no next piece
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
    const who0 = document.getElementById("who-0");
    const who1 = document.getElementById("who-1");
    if (net) {
      who0.textContent = net.myIndex === 0 ? "You" : "Friend";
      who1.textContent = net.myIndex === 1 ? "You" : "Friend";
      if (!net.conn) {
        status.textContent = "Online garden — waiting for your friend…";
      } else if (current === net.myIndex) {
        status.textContent = "Your turn — you're " + (net.myIndex === 0 ? "teal" : "coral");
      } else {
        status.textContent = "Waiting for your friend…";
      }
    } else {
      who0.textContent = "You";
      who1.textContent = withClaude ? "Claude" : "Friend";
      if (busy) {
        status.textContent = "Claude is placing…";
      } else if (withClaude) {
        status.textContent = "Your turn — hexafoil #" + (placedBy[0] + 1);
      } else {
        status.textContent = (current === 0 ? "You to play (teal)" : "Friend to play (coral)");
      }
    }
    if (winner !== null) {
      let wname;
      if (net) wname = winner === net.myIndex ? "You" : "Your friend";
      else if (winner === 0) wname = "You";
      else wname = withClaude ? "Claude" : "Friend";
      status.textContent = (wname === "You" ? "You win" : wname + " wins")
        + " — the untouched triangle!";
    }
    document.getElementById("count-you").textContent = placedBy[0];
    document.getElementById("count-claude").textContent = placedBy[1];
    renderTray();
  }

  function resetState() {
    cellOwner = new Map();
    pieces = [];
    placedBy = [0, 0];
    moves = [];
    current = 0;
    busy = false;
    currentRot = 0;
    hovered = null;
    armed = null;
    winner = null;
    winningPieceIdx = -1;
  }

  function newGarden() {
    resetState();
    if (net && net.conn) net.conn.send({ t: "reset" });
    render(false);
    updateStatus();
  }

  // ---- online play (PeerJS: browser-to-browser, no accounts) ---------------

  function setInviteStatus(text) {
    document.getElementById("invite-status").textContent = text;
  }
  function showInvite() { document.getElementById("invite").style.display = "flex"; }
  function hideInvite() { document.getElementById("invite").style.display = "none"; }

  function enterRemoteUI() {
    document.getElementById("companion-label").style.display = "none";
    updateStatus();
  }

  function wireConn(conn) {
    net.conn = conn;
    conn.on("data", function (msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "move") {
        doPlace(msg.q, msg.r, msg.i, current);
        current = 1 - current;
        render(true);
        updateStatus();
      } else if (msg.t === "sync") {
        resetState();
        duel = !!msg.duel;
        document.getElementById("duel-mode").checked = duel;
        boardR = msg.board || 0;
        document.getElementById("board-size").value = String(boardR);
        for (const m of msg.moves) doPlace(m.q, m.r, m.i, m.player);
        current = msg.current;
        render(false);
        updateStatus();
      } else if (msg.t === "reset") {
        resetState();
        render(false);
        updateStatus();
      } else if (msg.t === "mode") {
        duel = !!msg.duel;
        document.getElementById("duel-mode").checked = duel;
        resetState();
        render(false);
        updateStatus();
      } else if (msg.t === "board") {
        boardR = msg.board || 0;
        document.getElementById("board-size").value = String(boardR);
        resetState();
        render(false);
        updateStatus();
      }
    });
    conn.on("close", function () {
      net.conn = null;
      setInviteStatus("Your friend disconnected. If they reopen the link, the garden continues.");
      showInvite();
      updateStatus();
    });
    // host catches a (re)joining friend up on the whole garden
    if (net.myIndex === 0) {
      conn.send({ t: "sync", moves: moves, current: current, duel: duel, board: boardR });
    }
    setInviteStatus("Connected! Close this and start growing.");
    setTimeout(hideInvite, 1200);
    updateStatus();
  }

  function startOnline() {
    showInvite();
    if (typeof Peer === "undefined") {
      setInviteStatus("Couldn't load the connection library — check your internet and reload the page.");
      return;
    }
    if (net && net.peer) return; // already hosting/joined; just show the panel
    const id = "hexafoil-" + Math.random().toString(36).slice(2, 8);
    net = { peer: null, conn: null, myIndex: 0, hostId: id };
    setInviteStatus("Setting up…");
    try {
      const peer = new Peer(id);
      net.peer = peer;
      peer.on("open", function () {
        const link = location.origin + location.pathname + "?join=" + id;
        document.getElementById("invite-link").value = link;
        document.getElementById("invite-link-row").style.display = "flex";
        setInviteStatus("Send this link to a friend, then wait for them to open it:");
      });
      peer.on("connection", function (conn) {
        if (net.conn) { conn.close(); return; } // one friend at a time
        conn.on("open", function () { wireConn(conn); });
      });
      peer.on("error", function (e) {
        setInviteStatus("Connection trouble (" + e.type + "). Reload the page and try again.");
      });
    } catch (err) {
      setInviteStatus("This browser can't make peer connections.");
      net = null;
      return;
    }
    enterRemoteUI();
  }

  function joinFromLink(hostId) {
    showInvite();
    if (typeof Peer === "undefined") {
      setInviteStatus("Couldn't load the connection library — check your internet and reload the page.");
      return;
    }
    net = { peer: null, conn: null, myIndex: 1, hostId: hostId };
    setInviteStatus("Joining your friend's garden…");
    try {
      const peer = new Peer();
      net.peer = peer;
      peer.on("open", function () {
        const conn = peer.connect(hostId, { reliable: true });
        conn.on("open", function () { wireConn(conn); });
      });
      peer.on("error", function (e) {
        setInviteStatus(e.type === "peer-unavailable"
          ? "Couldn't find that garden — ask your friend to reopen their page and send a fresh link."
          : "Connection trouble (" + e.type + "). Reload to try again.");
      });
    } catch (err) {
      setInviteStatus("This browser can't make peer connections.");
      net = null;
      return;
    }
    enterRemoteUI();
  }

  // ---- init --------------------------------------------------------------

  document.getElementById("new-game").addEventListener("click", newGarden);
  document.getElementById("with-claude").addEventListener("change", function (e) {
    withClaude = e.target.checked;
    updateStatus(); // keep the garden — just swap who plays coral
    if (withClaude && current === 1) setTimeout(claudeMove, 400);
  });
  document.getElementById("board-size").addEventListener("change", function (e) {
    boardR = parseInt(e.target.value, 10) || 0;
    resetState();
    if (net && net.conn) net.conn.send({ t: "board", board: boardR });
    render(false);
    updateStatus();
  });
  document.getElementById("duel-mode").addEventListener("change", function (e) {
    duel = e.target.checked;
    resetState();
    if (net && net.conn) net.conn.send({ t: "mode", duel: duel });
    render(false);
    updateStatus();
  });
  document.getElementById("play-online").addEventListener("click", startOnline);
  document.getElementById("invite-close").addEventListener("click", hideInvite);
  document.getElementById("copy-link").addEventListener("click", function () {
    const input = document.getElementById("invite-link");
    const done = () => { this.textContent = "Copied!"; setTimeout(() => { this.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done.bind(this), () => { input.select(); });
    } else {
      input.select();
      try { document.execCommand("copy"); done.call(this); } catch (e) {}
    }
  });
  document.getElementById("rotate").addEventListener("click", rotate);
  document.getElementById("next-tile").addEventListener("click", rotate);
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") rotate();
  });

  newGarden();

  // test/companion hook (harmless in production): lets automated checks and
  // Claude-in-the-browser read the garden and take proper turns
  window.HexafoilTest = {
    canPlace: canPlace,
    doPlace: doPlace,
    clusterCells: clusterCells,
    contactKeys: contactKeys,
    winIfPlaced: winIfPlaced,
    state: function () {
      return {
        moves: moves.slice(),
        current: current,
        counts: placedBy.slice(),
        withClaude: withClaude,
        online: !!net,
        duel: duel,
        board: boardR,
        winner: winner,
        winningPieceIdx: winningPieceIdx,
      };
    },
    play: function (q, r, i) {
      if (winner !== null) return false;
      if (!canPlace(q, r, i)) return false;
      doPlace(q, r, i, current);
      if (net && net.conn) net.conn.send({ t: "move", q: q, r: r, i: i });
      current = 1 - current;
      render(true);
      updateStatus();
      return true;
    },
    // test-only: take back the last piece (clears any win state)
    undo: function () {
      const last = pieces.pop();
      if (!last) return false;
      moves.pop();
      placedBy[last.player]--;
      for (const [cq, cr] of last.cells) cellOwner.delete(key(cq, cr));
      winner = null;
      winningPieceIdx = -1;
      current = last.player;
      render(false);
      updateStatus();
      return true;
    },
  };

  // arriving via an invite link?
  const joinMatch = location.search.match(/[?&]join=([\w-]+)/);
  if (joinMatch) joinFromLink(joinMatch[1]);
})();
