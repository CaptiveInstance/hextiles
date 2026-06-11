/*
 * Hexia game engine — pure game logic, no rendering code.
 *
 * THE PIECE: a 12-sided shape made of 3 mutually-adjacent hexagons
 * (a triangle cluster). Players take turns placing pieces on empty cells.
 * Your score is the number of pieces you placed. The game ends when no
 * piece fits anywhere; most pieces wins.
 *
 * Coordinates: axial (q, r). A cluster is identified by an anchor cell and
 * a direction index i (0..5): it covers the anchor plus its neighbors in
 * directions i and i+1. Each distinct cluster is reachable from any of its
 * three cells with the appropriate i, so anchor+rotation can express every
 * placement.
 */
(function (root) {
  "use strict";

  const DIRS = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];

  const key = (q, r) => q + "," + r;

  function inBoard(q, r, radius) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= radius;
  }

  function allCells(radius) {
    const cells = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (inBoard(q, r, radius)) cells.push([q, r]);
      }
    }
    return cells;
  }

  // The three cells of the cluster anchored at (q, r) with rotation i.
  function clusterCells(q, r, i) {
    i = ((i % 6) + 6) % 6;
    const j = (i + 1) % 6;
    return [
      [q, r],
      [q + DIRS[i][0], r + DIRS[i][1]],
      [q + DIRS[j][0], r + DIRS[j][1]],
    ];
  }

  function createGame(radius) {
    radius = radius == null ? 2 : radius;
    const cells = {};
    for (const [q, r] of allCells(radius)) {
      cells[key(q, r)] = null; // null = empty; 0 or 1 = covered by that player's piece
    }
    return {
      radius: radius,
      cells: cells,
      pieces: [],          // [{ cells: [[q,r]x3], player }]
      counts: [0, 0],      // pieces placed by each player
      currentPlayer: 0,
      over: false,
      lastMove: null,
    };
  }

  function canPlace(game, q, r, i) {
    for (const [cq, cr] of clusterCells(q, r, i)) {
      if (game.cells[key(cq, cr)] !== null) return false; // occupied or off-board
    }
    return true;
  }

  // Does ANY piece fit? (Common pool: if one fits, whoever moves can play it.)
  function anyMove(game) {
    for (const k in game.cells) {
      if (game.cells[k] !== null) continue;
      const parts = k.split(",");
      const q = +parts[0], r = +parts[1];
      for (let i = 0; i < 6; i++) {
        if (canPlace(game, q, r, i)) return true;
      }
    }
    return false;
  }

  function place(game, q, r, i) {
    if (game.over || !canPlace(game, q, r, i)) {
      return { ok: false, cells: null };
    }
    const player = game.currentPlayer;
    const cells = clusterCells(q, r, i);
    for (const [cq, cr] of cells) game.cells[key(cq, cr)] = player;
    game.pieces.push({ cells: cells, player: player });
    game.counts[player]++;
    game.lastMove = { q: q, r: r, i: i, player: player, cells: cells };

    if (anyMove(game)) {
      game.currentPlayer = 1 - player;
    } else {
      game.over = true;
    }
    return { ok: true, cells: cells };
  }

  const Engine = {
    DIRS: DIRS,
    key: key,
    inBoard: inBoard,
    allCells: allCells,
    clusterCells: clusterCells,
    createGame: createGame,
    canPlace: canPlace,
    anyMove: anyMove,
    place: place,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Engine; // Node.js (tests)
  } else {
    root.HexiaEngine = Engine; // Browser
  }
})(typeof self !== "undefined" ? self : this);
