import { CONFIG } from '../config.js';

// Mutable, shared game state. Plain-object mutation (not reassignment of the export
// itself) is what lets every importing module observe live updates.
export const gameState = {
  gameOver: false,
  duration: CONFIG.DEFAULT_GAME_DURATION,  // seconds, set from the home screen's picker
  timeLeft: CONFIG.DEFAULT_GAME_DURATION,
  infractionCounts: {}, // PENALTIES code -> number of times triggered this run (see systems/rules.js)
};
