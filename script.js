// Interactive knight-attack bitboard for the hero.
// Squares use the same mapping as the engine: a1 = 0, h8 = 63,
// index = (rank - 1) * 8 + (file - 1).

(() => {
  const board = document.getElementById("board");
  const squareLabel = document.getElementById("bb-square");
  const hexLabel = document.getElementById("bb-hex");
  if (!board) return;

  const FILES = "abcdefgh";
  const FILE_A = 0x0101010101010101n;
  const FILE_B = 0x0202020202020202n;
  const FILE_G = 0x4040404040404040n;
  const FILE_H = 0x8080808080808080n;
  const FULL = 0xFFFFFFFFFFFFFFFFn;

  // Knight attacks computed the way the engine does it: shift the whole
  // bitboard and mask off files that would wrap around the board edge.
  function knightAttacks(sq) {
    const b = 1n << BigInt(sq);
    const notA = FULL ^ FILE_A, notH = FULL ^ FILE_H;
    const notAB = FULL ^ (FILE_A | FILE_B), notGH = FULL ^ (FILE_G | FILE_H);
    const attacks =
      ((b & notH)  << 17n) | ((b & notA)  << 15n) |
      ((b & notGH) << 10n) | ((b & notAB) <<  6n) |
      ((b & notA)  >> 17n) | ((b & notH)  >> 15n) |
      ((b & notAB) >> 10n) | ((b & notGH) >>  6n);
    return attacks & FULL;
  }

  const name = (sq) => FILES[sq % 8] + (Math.floor(sq / 8) + 1);
  const cells = new Map();

  // Draw rank 8 at the top, like a real board.
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const sq = rank * 8 + file;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell" + ((rank + file) % 2 === 0 ? " dark" : "");
      cell.dataset.sq = sq;
      cell.setAttribute("aria-label", name(sq));
      cell.tabIndex = -1;
      cell.addEventListener("click", () => select(sq, true));
      board.appendChild(cell);
      cells.set(sq, cell);
    }
  }

  let current = 28; // e4

  function select(sq, focus) {
    current = sq;
    const attacks = knightAttacks(sq);
    for (const [s, cell] of cells) {
      const bit = (attacks >> BigInt(s)) & 1n;
      cell.classList.toggle("on", bit === 1n);
      cell.classList.toggle("knight", s === sq);
      cell.textContent = s === sq ? "♞" : bit === 1n ? "1" : "";
      cell.tabIndex = s === sq ? 0 : -1;
    }
    squareLabel.textContent = name(sq);
    hexLabel.textContent = "0x" + attacks.toString(16).toUpperCase().padStart(16, "0");
    if (focus) cells.get(sq).focus();
  }

  // Arrow keys move the knight around the board.
  board.addEventListener("keydown", (e) => {
    const file = current % 8, rank = Math.floor(current / 8);
    const moves = {
      ArrowLeft: [file - 1, rank], ArrowRight: [file + 1, rank],
      ArrowUp: [file, rank + 1], ArrowDown: [file, rank - 1],
    };
    if (!moves[e.key]) return;
    const [f, r] = moves[e.key];
    if (f < 0 || f > 7 || r < 0 || r > 7) return;
    e.preventDefault();
    select(r * 8 + f, true);
  });

  select(current, false);

  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
