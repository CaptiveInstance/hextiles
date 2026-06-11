/*
 * Hexia AI — computer opponent for the piece-packing game. Pure logic,
 * no DOM: works in the browser (window.HexiaAI) and in Node.js for testing.
 *
 * Masks are BigInts (boards can exceed 32 cells). Play style:
 *  - ENDGAME (≤ 21 free cells, or any board ≤ 24 cells): solved exactly by
 *    memoized search — perfect play to the end.
 *  - MIDGAME on big boards: parity heuristic. After your move the remaining
 *    placements T get split: opponent takes ceil(T/2). So steer the board
 *    toward an EVEN estimated remainder, then keep options plentiful.
 */
(function (root) {
  "use strict";

  const E = (typeof module !== "undefined" && module.exports)
    ? require("./engine.js")
    : root.HexiaEngine;

  // ---- board indexing ----------------------------------------------------

  function boardInfo(radius) {
    const cells = E.allCells(radius);
    const bit = {}; // "q,r" -> bit index
    cells.forEach(function (c, n) { bit[E.key(c[0], c[1])] = n; });

    // every distinct cluster as { mask, q, r, i } (dedup: each cluster is
    // reachable from each of its 3 cells; keep one representative)
    const seen = new Set();
    const clusters = [];
    for (const [q, r] of cells) {
      for (let i = 0; i < 6; i++) {
        const cc = E.clusterCells(q, r, i);
        let mask = 0n, ok = true;
        for (const [cq, cr] of cc) {
          const b = bit[E.key(cq, cr)];
          if (b === undefined) { ok = false; break; }
          mask |= (1n << BigInt(b));
        }
        if (!ok || seen.has(mask)) continue;
        seen.add(mask);
        clusters.push({ mask: mask, q: q, r: r, i: i });
      }
    }
    return { cells: cells, bit: bit, clusters: clusters };
  }

  const infoCache = {};
  function getInfo(radius) {
    if (!infoCache[radius]) infoCache[radius] = boardInfo(radius);
    return infoCache[radius];
  }

  function maskOf(game, info) {
    let mask = 0n;
    for (const k in game.cells) {
      if (game.cells[k] !== null) mask |= (1n << BigInt(info.bit[k]));
    }
    return mask;
  }

  function freeCellCount(game) {
    let n = 0;
    for (const k in game.cells) if (game.cells[k] === null) n++;
    return n;
  }

  // ---- exact solver ------------------------------------------------------
  // solve(mask, player) -> [future pieces for P0, future pieces for P1]
  // under optimal play (each maximizes own count, tiebreak: minimize the
  // opponent's).
  const solverCache = {};
  function getSolver(radius) {
    if (solverCache[radius]) return solverCache[radius];
    const info = getInfo(radius);
    const memo = new Map();
    function solve(mask, player) {
      const mkey = (mask << 1n) | BigInt(player);
      if (memo.has(mkey)) return memo.get(mkey);
      let best = null;
      for (const cl of info.clusters) {
        if (mask & cl.mask) continue;
        const sub = solve(mask | cl.mask, 1 - player);
        const cand = player === 0 ? [sub[0] + 1, sub[1]] : [sub[0], sub[1] + 1];
        if (
          best === null ||
          cand[player] > best[player] ||
          (cand[player] === best[player] && cand[1 - player] < best[1 - player])
        ) {
          best = cand;
        }
      }
      if (best === null) best = [0, 0]; // no piece fits: game over
      memo.set(mkey, best);
      return best;
    }
    solverCache[radius] = solve;
    return solve;
  }

  // ---- heuristic helpers -------------------------------------------------

  // Rough upper-ish estimate of how many more pieces fit: greedy packing,
  // preferring clusters that destroy the fewest other options.
  function greedyEstimate(mask, info) {
    let count = 0;
    let m = mask;
    for (;;) {
      let best = null, bestKill = Infinity;
      for (const cl of info.clusters) {
        if (m & cl.mask) continue;
        let kill = 0;
        for (const other of info.clusters) {
          if (!(m & other.mask) && (other.mask & cl.mask)) kill++;
        }
        if (kill < bestKill) { bestKill = kill; best = cl; }
      }
      if (!best) return count;
      m |= best.mask;
      count++;
    }
  }

  function legalClusters(info, mask) {
    return info.clusters.filter(function (cl) { return !(mask & cl.mask); });
  }

  // ---- move choice -------------------------------------------------------

  function chooseMove(game) {
    const info = getInfo(game.radius);
    const mask = maskOf(game, info);
    const player = game.currentPlayer;
    const legal = legalClusters(info, mask);
    if (legal.length === 0) return null;

    const exact = info.cells.length <= 24 || freeCellCount(game) <= 21;

    if (exact) {
      const solve = getSolver(game.radius);
      let best = null, bestVal = null;
      for (const cl of legal) {
        const sub = solve(mask | cl.mask, 1 - player);
        const val = player === 0 ? [sub[0] + 1, sub[1]] : [sub[0], sub[1] + 1];
        if (
          bestVal === null ||
          val[player] > bestVal[player] ||
          (val[player] === bestVal[player] && val[1 - player] < bestVal[1 - player])
        ) {
          bestVal = val; best = cl;
        }
      }
      return { q: best.q, r: best.r, i: best.i, expected: bestVal, exact: true };
    }

    // Midgame heuristic: prefer an EVEN estimated remainder after our move
    // (the odd "extra" piece then falls to us next time), then mobility.
    let pool = [], bestScore = -Infinity;
    for (const cl of legal) {
      const after = mask | cl.mask;
      const t = greedyEstimate(after, info);
      const parityBonus = (t % 2 === 0) ? 1000 : 0;
      const mobility = legalClusters(info, after).length;
      const score = parityBonus + mobility;
      if (score > bestScore + 1e-9) { bestScore = score; pool = [cl]; }
      else if (score === bestScore) pool.push(cl);
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { q: pick.q, r: pick.r, i: pick.i, exact: false };
  }

  const AI = { chooseMove: chooseMove, _boardInfo: boardInfo, _greedyEstimate: greedyEstimate };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AI;
  } else {
    root.HexiaAI = AI;
  }
})(typeof self !== "undefined" ? self : this);
