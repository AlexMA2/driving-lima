import { CONFIG, type PenaltyCode } from '../config';

// Mutable, shared game state. Plain-object mutation (not reassignment of the export
// itself) is what lets every importing module observe live updates.
export const gameState: {
  gameOver: boolean;
  duration: number;
  timeLeft: number;
  elapsed: number;
  infractionCounts: Partial<Record<PenaltyCode, number>>;
} = {
  gameOver: false,
  duration: CONFIG.DEFAULT_GAME_DURATION,  // seconds, set from the home screen's picker
  timeLeft: CONFIG.DEFAULT_GAME_DURATION,
  elapsed: 0,          // seconds played, counted in every scenario (untimed ones have no countdown)
  infractionCounts: {}, // PENALTIES code -> number of times triggered this run (see systems/rules.ts)
};
