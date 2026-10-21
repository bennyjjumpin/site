// Runs the WebAssembly engine off the main thread, so the page stays
// responsive while it thinks. The worker owns the only copy of the game;
// the page sends commands and gets the full game state back after each one.
//
// Page -> worker:  { cmd: "new" }
//                  { cmd: "play", move: "e2e4" }
//                  { cmd: "think", ms: 1000 }
//                  { cmd: "undo", plies: 2 }
// Worker -> page:  { type: "state", state: {...} }
//                  { type: "error", message: "..." }

importScripts("engine.js");   // defines createEngine(); engine.wasm loads from the same folder

let engine = null;
const history = [];           // moves played so far, in UCI form

function currentState() {
  return {
    board: engine.board(),                       // 64 chars, a1 first
    legal: engine.legalMoves().split(" ").filter(Boolean),
    side: engine.sideToMove(),                   // "w" or "b"
    status: engine.gameStatus(),                 // "playing" | "checkmate" | "stalemate"
    inCheck: engine.isInCheck(),
    history: history.slice(),
  };
}

function sendState() {
  postMessage({ type: "state", state: currentState() });
}

createEngine()
  .then((e) => {
    engine = e;
    engine.newGame();
    sendState();
  })
  .catch((err) => {
    postMessage({ type: "error", message: "The engine failed to load: " + err });
  });

onmessage = ({ data }) => {
  if (!engine) return;

  switch (data.cmd) {
    case "new":
      engine.newGame();
      history.length = 0;
      break;

    case "play":
      if (engine.playMove(data.move)) history.push(data.move);
      break;

    case "think": {
      const move = engine.engineMove(data.ms);   // blocks this worker, not the page
      if (move) history.push(move);
      break;
    }

    case "undo":
      for (let i = 0; i < data.plies && history.length > 0; i++) {
        engine.undoMove();
        history.pop();
      }
      break;
  }

  sendState();
};
