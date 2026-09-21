import { CONFIG } from '../config.js';

// Mutable, shared game state. Plain-object mutation (not reassignment of the export
// itself) is what lets every importing module observe live updates.
export const gameState = {
  score: CONFIG.SCORE_START,
  damage: 0,
  gameOver: false,
  duration: CONFIG.DEFAULT_GAME_DURATION,  // seconds, set from the home screen's picker
  timeLeft: CONFIG.DEFAULT_GAME_DURATION,
};
