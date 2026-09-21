// Global tunables. Vehicle physics, AI frequencies and rule thresholds all live here
// so gameplay feel can be adjusted without touching the systems that consume them.
export const CONFIG = {
  // ---- Road geometry ----
  LANE_WIDTH: 3.5,
  ROAD_LENGTH: 3000,          // total length of generated world (meters), road runs along -Z
  SIDEWALK_WIDTH: 3,

  // ---- Vehicle physics (RaycastVehicle) — TWEAK HERE for handling feel ----
  ENGINE_FORCE: 1450,         // higher = faster acceleration
  MAX_SPEED_KMH: 100,         // soft cap enforced in code
  BRAKE_FORCE: 36,
  HANDBRAKE_FORCE: 60,
  MAX_STEER: 0.55,
  STEER_SPEED_FALLOFF: true,  // reduce steering angle at high speed for stability

  // ---- Rule thresholds ----
  URBAN_SPEED_LIMIT: 50,      // km/h  (M20)
  SCHOOL_SPEED_LIMIT: 30,     // km/h  (M20 in school zone)
  INFRACTION_COOLDOWN: 4.5,   // seconds between repeated same-type infractions

  // ---- AI traffic frequencies — TWEAK HERE for difficulty ----
  AI_TARGET_COUNT: 9,
  AI_LANE_CHANGE_CHANCE_PER_SEC: 0.06,  // combi/mototaxi unsignaled lane change probability
  AI_SUDDEN_STOP_CHANCE_PER_SEC: 0.03,  // combi sudden passenger stop probability
  PEDESTRIAN_TARGET_COUNT: 4,
  PEDESTRIAN_SPAWN_CHANCE_PER_SEC: 0.25,

  SCORE_START: 100,
};

// Penalties follow the Peruvian Reglamento Nacional de Transito (D.S. N 016-2009-MTC).
export const PENALTIES = {
  M20: { score: -20, label: 'M20: Exceso de Velocidad' },
  G10: { score: -10, label: 'G10: Cambio de carril sin señalización' },
  G28: { score: -15, label: 'G28: Cruce en luz roja' },
  G57: { score: -10, label: 'G57: No ceder el paso' },
  COLLISION: { score: -25, damage: 30, label: 'Choque detectado' },
  BUMP: { score: -5, damage: 10, label: 'Rompemuelas a alta velocidad' },
};
