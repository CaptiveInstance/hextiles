/*
 * Hexia UI — all rendering and interaction. Talks to the engine, never
 * implements game rules itself.
 */
(function () {
  "use strict";

  const E = window.HexiaEngine;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const RADIUS = 3; // board radius (3 -> 37 cells)
  const SIZE = 34;  // hex circumradius in px

  const PLAYERS = [
    { name: "Teal", fill: "#a9c4bd", edge: "#8aa9a1" },
    { name: "Coral", fill: "#d99b80", edge: "#bf7f63" },
  ];
  const LINE_COLOR = "#f5f2e9";
  const BG = "#f6f3ec";

  let game, svg, cellLayer, pieceLayer, fxLayer;
  let currentRot = 0;      // 0..5, which pair of neighbors the piece covers
  let hovered = null;      // [q, r] of the cell under the mouse, or null
  let vsAI = false;        // one player controlled by the computer
  let aiPlayer = 1;        // which seat the computer occupies (0 = goes first)
  let aiThinking = false;
  let armed = null;        // touch devices: cell key awaiting a confirming tap

  const IS_TOUCH = typeof window.matchMedia === "function"
    && window.matchMedia("(hover: none)").matches;

  function isAITurn() {
    return vsAI && !game.over && game.currentPlayer === aiPlayer;
  }

  // ---- geometry ----------------------------------------------------------

  function center(q, r) {
    return {
      x: SIZE * Math.sqrt(3) * (q + r / 2),
      y: SIZE * 1.5 * r,
    };
  }

  // Pointy-top hexagon corner points around (0,0)
  function hexPoints(scale) {
    const s = SIZE * (scale || 1);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      pts.push((s * Math.cos(a)).toFixed(2) + "," + (s * Math.sin(a)).toFixed(2));
    }
    return pts.join(" ");
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  // ---- piece artwork -----------------------------------------------------
  // The 12-sided piece: three hexagons around a shared corner P. Each hex
  // carries five cream rays that converge to a SINGLE POINT at its outermost
  // vertex (the apex) and fan inward toward P. The outer rays run along the
  // piece's chord edges (drawing the big triangle), the middle rays of all
  // three hexes meet at P. No outlines, no lines between hexes.
  function hexPointsAt(c) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      pts.push((c.x + SIZE * Math.cos(a)).toFixed(1) + "," + (c.y + SIZE * Math.sin(a)).toFixed(1));
    }
    return pts.join(" ");
  }

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

    // where the line (px,py)+t*(dx,dy) crosses the line through A and B
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
        // OUTER rays: outer edge exactly on the chord (apex -> chord end),
        // inner corner mitered along the terminal hex edge.
        const end = delta > 0 ? E2 : E1; // chord end = flanking vertex
        const pin = rad(d - Math.sign(delta) * 90);
        const ix = Math.cos(pin), iy = Math.sin(pin);
        const innerStart = { x: apex.x + ix * w, y: apex.y + iy * w };
        const innerCut = cut({ x: innerStart.x, y: innerStart.y }, dx, dy, end, Pv);
        const nbi = { x: nb.x + ix * w, y: nb.y + iy * w };
        el("polygon", {
          points: [pt(apex), pt(end), pt(innerCut), pt(nbi)].join(" "),
          fill: LINE_COLOR,
        }, g);
      } else if (delta !== 0) {
        // INTERMEDIATE rays: both long edges cut along the terminal hex edge.
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
        // MIDDLE ray: ends at P itself in a V-tip mitered along BOTH edges,
        // so the three middle rays of a piece tile seamlessly around P.
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

  function pieceGroup(cells, playerIdx) {
    const p = PLAYERS[playerIdx];
    const g = el("g", { class: "piece" });

    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };

    for (const c of ctrs) {
      el("polygon", { points: hexPointsAt(c), fill: p.fill }, g);
      hexRays(g, c, P);
    }
    return g;
  }

  // ---- board -------------------------------------------------------------

  function buildBoard() {
    const boardEl = document.getElementById("board");
    boardEl.innerHTML = "";

    const span = SIZE * Math.sqrt(3) * (2 * RADIUS + 1) / 2 + 14;
    const vspan = SIZE * (1.5 * RADIUS + 1) + 14;
    svg = el("svg", {
      viewBox: [-span, -vspan, span * 2, vspan * 2].join(" "),
      width: "100%",
    }, boardEl);

    cellLayer = el("g", {}, svg);
    pieceLayer = el("g", { "pointer-events": "none" }, svg);
    fxLayer = el("g", { "pointer-events": "none" }, svg);

    for (const [q, r] of E.allCells(RADIUS)) {
      const c = center(q, r);
      const g = el("g", { transform: "translate(" + c.x + "," + c.y + ")", class: "cell" }, cellLayer);
      el("polygon", { points: hexPoints(0.97), class: "base" }, g);
      g.addEventListener("click", () => tryPlace(q, r));
      g.addEventListener("mouseenter", () => { hovered = [q, r]; showGhost(); });
      g.addEventListener("mouseleave", () => { hideGhost(); hovered = null; });
    }
  }

  function showGhost() {
    if (!hovered || game.over || isAITurn()) return;
    hideGhost();
    const [q, r] = hovered;
    // try the current rotation first, then the others, so the ghost appears
    // wherever the piece can pivot around the hovered cell
    for (let d = 0; d < 6; d++) {
      const rot = (currentRot + d) % 6;
      if (E.canPlace(game, q, r, rot)) {
        if (d > 0) { currentRot = rot; renderTray(); }
        const ghost = pieceGroup(E.clusterCells(q, r, rot), game.currentPlayer);
        ghost.classList.add("ghost");
        pieceLayer.appendChild(ghost);
        return;
      }
    }
  }

  function hideGhost() {
    const old = svg.querySelector(".ghost");
    if (old) old.remove();
  }

  // ---- rotation ----------------------------------------------------------

  function rotate() {
    if (hovered && !game.over && !isAITurn()) {
      // pivot to the next rotation that fits around the hovered cell
      const [q, r] = hovered;
      for (let d = 1; d <= 6; d++) {
        const rot = (currentRot + d) % 6;
        if (E.canPlace(game, q, r, rot)) { currentRot = rot; break; }
      }
    } else {
      currentRot = (currentRot + 1) % 6;
    }
    renderTray();
    showGhost();
  }

  // ---- moves & effects ---------------------------------------------------

  function tryPlace(q, r) {
    if (isAITurn() || aiThinking) return; // not the human's turn
    if (IS_TOUCH) {
      // first tap previews, second tap on the same cell places
      const k = E.key(q, r);
      if (armed !== k) {
        hovered = [q, r];
        hideGhost();
        showGhost();
        armed = svg.querySelector(".ghost") ? k : null;
        return;
      }
      armed = null;
    }
    if (!E.canPlace(game, q, r, currentRot)) {
      // be forgiving: if some rotation fits around this cell, use it
      let found = -1;
      for (let d = 1; d < 6; d++) {
        const rot = (currentRot + d) % 6;
        if (E.canPlace(game, q, r, rot)) { found = rot; break; }
      }
      if (found < 0) return;
      currentRot = found;
    }
    placeMove(q, r, currentRot);
  }

  function placeMove(q, r, rot) {
    const result = E.place(game, q, r, rot);
    if (!result.ok) return;

    hideGhost();
    const piece = pieceGroup(result.cells, game.lastMove.player);
    piece.classList.add("pop");
    pieceLayer.appendChild(piece);

    updatePanel();
    maybeAIMove();
  }

  function maybeAIMove() {
    if (!isAITurn() || aiThinking) return;
    aiThinking = true;
    document.getElementById("status").textContent = "Claude is thinking…";
    setTimeout(function () {
      aiThinking = false;
      const m = window.HexiaAI.chooseMove(game);
      if (m) placeMove(m.q, m.r, m.i);
    }, 700);
  }

  // ---- panel & tray ------------------------------------------------------

  function renderTray() {
    const box = document.getElementById("next-tile");
    box.innerHTML = "";
    if (game.over || isAITurn()) return;
    const cells = E.clusterCells(0, 0, currentRot);
    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };
    const m = SIZE * 2.1;
    const s = el("svg", {
      viewBox: [P.x - m, P.y - m, 2 * m, 2 * m].join(" "),
    }, box);
    s.appendChild(pieceGroup(cells, game.currentPlayer));
  }

  function updatePanel() {
    PLAYERS[0].name = vsAI && aiPlayer === 0 ? "Claude" : "Teal";
    PLAYERS[1].name = vsAI && aiPlayer === 1 ? "Claude" : "Coral";
    for (let i = 0; i < 2; i++) {
      document.getElementById("name-" + i).textContent = PLAYERS[i].name;
      document.getElementById("score-" + i).textContent = game.counts[i];
      document.getElementById("left-" + i).textContent = "pieces placed";
      document.getElementById("card-" + i).classList.toggle("active", !game.over && game.currentPlayer === i);
    }
    const status = document.getElementById("status");
    if (game.over) {
      const a = game.counts[0], b = game.counts[1];
      status.textContent = a === b
        ? "It's a tie, " + a + "–" + b + "!"
        : (a > b ? PLAYERS[0].name : PLAYERS[1].name) + " wins " + Math.max(a, b) + "–" + Math.min(a, b) + "!";
      status.classList.add("game-over");
    } else {
      status.textContent = PLAYERS[game.currentPlayer].name + " to play";
      status.classList.remove("game-over");
    }
    document.getElementById("tray").style.visibility = game.over ? "hidden" : "visible";
    renderTray();
  }

  function newGame() {
    game = E.createGame(RADIUS);
    currentRot = 0;
    hovered = null;
    armed = null;
    buildBoard();
    updatePanel();
    maybeAIMove(); // if Claude has the first seat, it opens
  }

  // ---- init --------------------------------------------------------------

  document.getElementById("new-game").addEventListener("click", newGame);
  document.getElementById("ai-toggle").addEventListener("change", function (e) {
    vsAI = e.target.checked;
    newGame();
  });
  document.getElementById("ai-first").addEventListener("change", function (e) {
    aiPlayer = e.target.checked ? 0 : 1;
    newGame();
  });
  document.getElementById("rotate").addEventListener("click", rotate);
  document.getElementById("next-tile").addEventListener("click", rotate);
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") rotate();
  });

  for (let i = 0; i < 2; i++) {
    document.getElementById("name-" + i).textContent = PLAYERS[i].name;
    const swatch = document.getElementById("swatch-" + i);
    const cells = E.clusterCells(0, 0, 0);
    const ctrs = cells.map(([q, r]) => center(q, r));
    const P = {
      x: (ctrs[0].x + ctrs[1].x + ctrs[2].x) / 3,
      y: (ctrs[0].y + ctrs[1].y + ctrs[2].y) / 3,
    };
    const m = SIZE * 2.1;
    const s = el("svg", { viewBox: [P.x - m, P.y - m, 2 * m, 2 * m].join(" ") }, swatch);
    s.appendChild(pieceGroup(cells, i));
  }
  newGame();
})();
