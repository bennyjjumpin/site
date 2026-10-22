// The board page. All chess rules live in the engine (inside the worker);
// this file only draws the board, turns clicks and drags into UCI moves,
// and plays sounds.

(() => {
  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const moveListEl = document.getElementById("move-list");
  const promoEl = document.getElementById("promo");
  const promoChoicesEl = document.getElementById("promo-choices");
  const undoBtn = document.getElementById("undo");
  const soundBtn = document.getElementById("sound");
  const newWhiteBtn = document.getElementById("new-white");
  const newBlackBtn = document.getElementById("new-black");
  const thinkSelect = document.getElementById("think-time");

  const FILES = "abcdefgh";
  const NAMES = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
  // Text-style chess symbols, used if the piece images are missing.
  // The ︎ stops some systems from drawing them as colored emoji.
  const GLYPHS = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
  };

  let state = null;          // latest game state from the worker
  let playerColor = "w";
  let selected = null;       // square index of the selected piece, or null
  let busy = true;           // waiting on the worker
  let thinking = false;      // the engine is choosing a move
  let loadError = null;
  let useImages = true;      // switches to text symbols if an image fails to load
  let drag = null;           // the drag in progress, if any

  const squareName = (sq) => FILES[sq % 8] + (Math.floor(sq / 8) + 1);
  const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();
  const isOwnPiece = (c) => c !== "." && isWhitePiece(c) === (playerColor === "w");

  // ---------- Sounds ----------
  // Generated with the Web Audio API rather than loaded from files:
  // a filtered burst of noise sounds like a piece tapping wood.

  let audio = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem("chess-sound") !== "off"; } catch (e) {}

  function audioContext() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  // A short wooden knock: noise, band-passed, with a fast decay.
  function knock(at, { freq = 1000, q = 1.2, gain = 0.5, decay = 0.05 } = {}) {
    const c = audio;
    const length = Math.floor(c.sampleRate * decay * 3);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * decay * 0.4));

    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = c.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(c.destination);
    src.start(at);

    // A little low "body" under the click makes it sound like a solid piece.
    tone(at, 170, 0.06, gain * 0.35, "sine");
  }

  function tone(at, freq, duration, gain, type = "sine") {
    const c = audio;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp).connect(c.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function playSound(kind) {
    if (!soundOn || !audioContext()) return;
    const t = audio.currentTime + 0.01;
    switch (kind) {
      case "move":
        knock(t, { freq: 900, gain: 0.55 });
        break;
      case "capture":
        knock(t, { freq: 1500, q: 1.6, gain: 0.8, decay: 0.045 });
        knock(t + 0.03, { freq: 700, gain: 0.45 });
        break;
      case "castle":
        knock(t, { freq: 900, gain: 0.5 });
        knock(t + 0.11, { freq: 1050, gain: 0.5 });
        break;
      case "check":
        knock(t, { freq: 1100, gain: 0.55 });
        tone(t + 0.02, 880, 0.18, 0.12, "triangle");
        break;
      case "promote":
        knock(t, { freq: 900, gain: 0.5 });
        tone(t + 0.04, 660, 0.12, 0.1, "triangle");
        tone(t + 0.14, 990, 0.18, 0.1, "triangle");
        break;
      case "end":
        tone(t, 523, 0.35, 0.12, "triangle");
        tone(t + 0.15, 659, 0.35, 0.12, "triangle");
        tone(t + 0.3, 784, 0.6, 0.12, "triangle");
        break;
      case "illegal":
        tone(t, 220, 0.12, 0.08, "square");
        break;
    }
  }

  // Works out which sound fits the move just played, by comparing the
  // board before and after it.
  function soundForMove(before, after, move) {
    if (after.status !== "playing") return "end";
    if (after.inCheck) return "check";
    if (move.length === 5) return "promote";
    const pieces = (b) => b.replace(/\./g, "").length;
    if (pieces(after.board) < pieces(before.board)) return "capture";
    const from = FILES.indexOf(move[0]) + (Number(move[1]) - 1) * 8;
    const to = FILES.indexOf(move[2]) + (Number(move[3]) - 1) * 8;
    const piece = after.board[to].toUpperCase();
    if (piece === "K" && Math.abs((from % 8) - (to % 8)) === 2) return "castle";
    return "move";
  }

  function updateSoundButton() {
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
  }
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    try { localStorage.setItem("chess-sound", soundOn ? "on" : "off"); } catch (e) {}
    updateSoundButton();
    if (soundOn) playSound("move");
  });
  updateSoundButton();

  // ---------- Talking to the engine ----------

  const worker = new Worker("engine-worker.js");

  worker.onmessage = ({ data }) => {
    if (data.type === "error") {
      loadError = data.message;
      busy = false;
      render();
      return;
    }
    const before = state;
    state = data.state;
    busy = false;
    thinking = false;

    // One new move means a move was just played (by either side): play its sound.
    if (before && state.history.length === before.history.length + 1) {
      playSound(soundForMove(before, state, state.history[state.history.length - 1]));
    }

    render();
    maybeEngineTurn();
  };

  worker.onerror = () => {
    loadError = "The engine failed to load. Check that engine.js and engine.wasm are in this folder.";
    busy = false;
    render();
  };

  function send(cmd) {
    busy = true;
    // After the player moves, the engine replies right away, so show
    // "thinking" from that moment rather than flashing "Your move" again.
    thinking = cmd.cmd === "think" || cmd.cmd === "play";
    worker.postMessage(cmd);
    render();
  }

  function maybeEngineTurn() {
    if (state && state.status === "playing" && state.side !== playerColor) {
      send({ cmd: "think", ms: Number(thinkSelect.value) });
    }
  }

  function play(move) {
    selected = null;
    hidePromotion();
    send({ cmd: "play", move });
  }

  function newGame(color) {
    playerColor = color;
    selected = null;
    hidePromotion();
    send({ cmd: "new" });
  }

  function playerMovesMade() {
    const n = state ? state.history.length : 0;
    return playerColor === "w" ? Math.ceil(n / 2) : Math.floor(n / 2);
  }

  function undo() {
    if (busy || !state || playerMovesMade() === 0) return;
    // Take back the engine's reply too, so it's the player's turn again.
    // If the player's own move ended the game, there's no reply to take back.
    const plies = state.side === playerColor ? 2 : 1;
    selected = null;
    hidePromotion();
    send({ cmd: "undo", plies });
  }

  const playerToMove = () =>
    !busy && state && state.status === "playing" && state.side === playerColor && promoEl.hidden;

  // Tries to move the selected piece to `sq`. Returns true if that's a legal move.
  function tryMoveTo(sq) {
    if (selected === null) return false;
    const prefix = squareName(selected) + squareName(sq);
    const moves = state.legal.filter((m) => m.startsWith(prefix));
    if (moves.length === 1) { play(moves[0]); return true; }
    if (moves.length > 1) { showPromotion(moves); return true; }   // four promotion moves
    return false;
  }

  const canMoveFrom = (sq) =>
    isOwnPiece(state.board[sq]) && state.legal.some((m) => m.startsWith(squareName(sq)));

  // ---------- Input: click-click and drag-and-drop ----------
  // Pointer events cover mouse, touch and pen with the same code.

  const squareFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest("#board .sq");
    return cell ? Number(cell.dataset.sq) : null;
  };

  boardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !playerToMove()) return;
    audioContext();   // browsers only allow sound after a user gesture
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (sq === null) return;

    // Clicking a highlighted square moves the selected piece there.
    if (selected !== null && sq !== selected && tryMoveTo(sq)) return;

    if (canMoveFrom(sq)) {
      // Pick the piece up. It becomes a drag if the pointer moves far enough;
      // otherwise it was just a click that selects (or deselects) it.
      drag = { from: sq, x: e.clientX, y: e.clientY, active: false, wasSelected: selected === sq, ghost: null };
      selected = sq;
      boardEl.setPointerCapture(e.pointerId);
      render();
    } else {
      selected = null;
      render();
    }
  });

  boardEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      startDrag();
    }
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
  });

  boardEl.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag;
    endDrag();

    if (d.active) {
      const target = squareFromPoint(e.clientX, e.clientY);
      if (target !== null && target !== d.from && tryMoveTo(target)) return;
      if (target !== null && target !== d.from) playSound("illegal");
      // Dropped somewhere illegal: the piece snaps back and stays selected.
      render();
    } else if (d.wasSelected) {
      // A plain click on the already-selected piece deselects it.
      selected = null;
      render();
    }
  });

  boardEl.addEventListener("pointercancel", () => {
    if (drag) { endDrag(); render(); }
  });

  function startDrag() {
    drag.active = true;
    const size = boardEl.getBoundingClientRect().width / 8;
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.style.width = ghost.style.height = size + "px";
    const piece = pieceElement(state.board[drag.from]);
    if (piece.classList.contains("glyph")) piece.style.fontSize = size * 0.8 + "px";
    ghost.appendChild(piece);
    document.body.appendChild(ghost);
    document.body.classList.add("dragging");
    drag.ghost = ghost;
    render();   // fades the piece left behind on its square
  }

  function endDrag() {
    if (drag.ghost) drag.ghost.remove();
    document.body.classList.remove("dragging");
    drag = null;
  }

  // Keyboard: Enter or Space on a square acts like a click.
  boardEl.addEventListener("click", (e) => {
    if (e.detail !== 0 || !playerToMove()) return;   // detail is 0 only for keyboard clicks
    const cell = e.target.closest(".sq");
    if (!cell) return;
    const sq = Number(cell.dataset.sq);
    if (selected !== null && sq !== selected && tryMoveTo(sq)) return;
    selected = canMoveFrom(sq) && selected !== sq ? sq : null;
    render();
    boardEl.querySelector(`[data-sq="${sq}"]`)?.focus();
  });

  function showPromotion(moves) {
    promoChoicesEl.textContent = "";
    for (const type of ["q", "r", "b", "n"]) {
      const move = moves.find((m) => m[4] === type);
      if (!move) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promo-choice";
      btn.setAttribute("aria-label", NAMES[type.toUpperCase()]);
      btn.appendChild(pieceElement(playerColor === "w" ? type.toUpperCase() : type));
      btn.addEventListener("click", () => play(move));
      promoChoicesEl.appendChild(btn);
    }
    promoEl.hidden = false;
    promoChoicesEl.querySelector("button").focus();
  }

  function hidePromotion() {
    promoEl.hidden = true;
  }

  function cancelPromotion() {
    hidePromotion();
    selected = null;
    render();
  }

  document.getElementById("promo-cancel").addEventListener("click", cancelPromotion);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !promoEl.hidden) cancelPromotion();
  });

  newWhiteBtn.addEventListener("click", () => newGame("w"));
  newBlackBtn.addEventListener("click", () => newGame("b"));
  undoBtn.addEventListener("click", undo);

  // ---------- Drawing ----------

  function pieceElement(c) {
    const color = isWhitePiece(c) ? "w" : "b";
    const type = c.toUpperCase();
    const label = (color === "w" ? "white " : "black ") + NAMES[type];

    if (useImages) {
      const img = document.createElement("img");
      img.src = `pieces/${color}${type}.svg`;
      img.alt = label;
      img.draggable = false;   // use our own dragging, not the browser's image drag
      img.addEventListener("error", () => {
        if (useImages) {
          useImages = false;   // fall back to text symbols everywhere
          render();
        }
      });
      return img;
    }

    const span = document.createElement("span");
    span.className = "glyph glyph-" + color;
    span.textContent = GLYPHS[c] + "︎";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  // Board square at a display position. Flips when playing black,
  // so the player's pieces are always at the bottom.
  function squareAt(row, col) {
    return playerColor === "w" ? (7 - row) * 8 + col : row * 8 + (7 - col);
  }

  function render() {
    renderBoard();
    renderStatus();
    renderMoves();
    undoBtn.disabled = busy || !state || playerMovesMade() === 0;
    newWhiteBtn.disabled = newBlackBtn.disabled = busy && !loadError;
  }

  function renderBoard() {
    boardEl.textContent = "";
    if (!state) return;

    const last = state.history[state.history.length - 1];
    const lastFrom = last ? last.slice(0, 2) : null;
    const lastTo = last ? last.slice(2, 4) : null;

    const targets = new Set();
    if (selected !== null) {
      const from = squareName(selected);
      for (const m of state.legal) if (m.startsWith(from)) targets.add(m.slice(2, 4));
    }

    const kingChar = state.side === "w" ? "K" : "k";
    const canAct = playerToMove();

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = squareAt(row, col);
        const name = squareName(sq);
        const piece = state.board[sq];
        const rank = Math.floor(sq / 8);
        const file = sq % 8;

        const cell = document.createElement("button");
        cell.type = "button";
        cell.dataset.sq = sq;
        cell.className = "sq " + ((rank + file) % 2 === 0 ? "dark" : "light");
        if (name === lastFrom || name === lastTo) cell.classList.add("last");
        if (sq === selected) cell.classList.add("selected");
        if (state.inCheck && piece === kingChar) cell.classList.add("check");
        if (targets.has(name)) cell.classList.add(piece === "." ? "target" : "target-capture");
        if (canAct && isOwnPiece(piece)) cell.classList.add("movable");
        if (drag && drag.active && drag.from === sq) cell.classList.add("drag-from");

        let label = name;
        if (piece !== ".") label += ", " + (isWhitePiece(piece) ? "white " : "black ") + NAMES[piece.toUpperCase()];
        cell.setAttribute("aria-label", label);

        if (piece !== ".") cell.appendChild(pieceElement(piece));

        // Coordinates along the left and bottom edges.
        if (col === 0) {
          const r = document.createElement("span");
          r.className = "coord coord-rank";
          r.textContent = rank + 1;
          cell.appendChild(r);
        }
        if (row === 7) {
          const f = document.createElement("span");
          f.className = "coord coord-file";
          f.textContent = FILES[file];
          cell.appendChild(f);
        }

        boardEl.appendChild(cell);
      }
    }
  }

  function renderStatus() {
    let text;
    if (loadError) text = loadError;
    else if (!state) text = "Loading the engine…";
    else if (thinking) text = "The engine is thinking…";
    else if (state.status === "checkmate")
      text = state.side === playerColor ? "Checkmate. The engine wins." : "Checkmate. You win!";
    else if (state.status === "stalemate") text = "Stalemate. It's a draw.";
    else if (state.status === "draw-repetition") text = "Draw by threefold repetition.";
    else if (state.status === "draw-fifty") text = "Draw by the 50-move rule.";
    else if (state.status === "draw-material") text = "Draw: neither side can checkmate.";
    else if (state.side === playerColor)
      text = state.inCheck ? "You're in check. Your move." : "Your move.";
    else text = "";
    statusEl.textContent = text;
    statusEl.classList.toggle("status-error", Boolean(loadError));
  }

  function renderMoves() {
    moveListEl.textContent = "";
    if (!state) return;
    const h = state.history;
    for (let i = 0; i < h.length; i += 2) {
      const li = document.createElement("li");
      li.textContent = h[i] + (h[i + 1] ? "  " + h[i + 1] : "");
      moveListEl.appendChild(li);
    }
    moveListEl.parentElement.scrollTop = moveListEl.parentElement.scrollHeight;
  }

  render();
})();
