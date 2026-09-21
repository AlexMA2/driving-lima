// Global tunables. Vehicle physics, AI frequencies and rule thresholds all live here
// so gameplay feel can be adjusted without touching the systems that consume them.
export const CONFIG = {
  // ---- Road geometry ----
  LANE_WIDTH: 3.5,
  SIDEWALK_WIDTH: 3,

  // ---- Vehicle physics (RaycastVehicle) — TWEAK HERE for handling feel ----
  ENGINE_FORCE: 480,          // higher = faster acceleration (~11s 0-120km/h at this value)
  MAX_SPEED_KMH: 100,         // soft cap enforced in code
  BRAKE_FORCE: 36,
  HANDBRAKE_FORCE: 60,
  MAX_STEER: 0.55,
  STEER_SPEED_FALLOFF: true,  // reduce steering angle at high speed for stability

  // ---- Rule thresholds ----
  URBAN_SPEED_LIMIT: 50,      // km/h  (M20)
  SCHOOL_SPEED_LIMIT: 30,     // km/h  (M20 in school zone)
  INFRACTION_COOLDOWN: 4.5,   // seconds between repeated same-type infractions
  WRONG_WAY_SPEED_THRESHOLD: 5, // km/h above which crossing into the oncoming lanes counts as driving in the wrong direction

  // ---- Match duration (configured on the home screen) ----
  DEFAULT_GAME_DURATION: 180,     // seconds
  GAME_DURATION_OPTIONS: [120, 180, 300, 600], // seconds, shown as selectable pills on the home screen

  // ---- AI traffic frequencies — TWEAK HERE for difficulty ----
  AI_TARGET_COUNT: 9,
  AI_LANE_CHANGE_CHANCE_PER_SEC: 0.06,  // combi/mototaxi unsignaled lane change probability
  AI_SUDDEN_STOP_CHANCE_PER_SEC: 0.03,  // combi sudden passenger stop probability
  AI_TAILGATE_CHANCE_PER_SEC: 0.02,     // "bad driver" that closes in dangerously close, then brakes
  PEDESTRIAN_TARGET_COUNT: 4,
  PEDESTRIAN_SPAWN_CHANCE_PER_SEC: 0.25,

  SCORE_START: 100,

  // ---- Steering wheel (mouse-drag, hydraulic power-steering feel) ----
  WHEEL_MAX_ANGLE_DEG: 420,     // total lock-to-lock rotation the on-screen wheel allows either way
  WHEEL_RETURN_RATE: 4.2,       // how fast the wheel self-centers when not gripped (hydraulic assist)
  WHEEL_FOLLOW_RATE: 14,        // how fast the wheel chases the mouse/keyboard target (hydraulic damping)

  // ---- Pedals (press / hold / release, ramped — not instant on/off) ----
  THROTTLE_RAMP_UP: 1.35,       // seconds to go 0 -> 1 while held
  THROTTLE_RAMP_DOWN: 0.9,      // seconds to go 1 -> 0 after release
  BRAKE_RAMP_UP: 0.45,          // seconds to go 0 -> 1 while held
  BRAKE_RAMP_DOWN: 0.35,        // seconds to go 1 -> 0 after release
  REVERSE_SPEED_THRESHOLD_KMH: 3, // must be nearly stopped before brake-hold engages reverse
};

// Penalties follow the Peruvian Reglamento Nacional de Transito (D.S. N 016-2009-MTC).
export const PENALTIES = {
  M20: { score: -20, label: 'M20: Exceso de Velocidad' },
  G10: { score: -10, label: 'G10: Cambio de carril sin señalización' },
  G28: { score: -15, label: 'G28: Cruce en luz roja' },
  G57: { score: -10, label: 'G57: No ceder el paso' },
  M12: { score: -20, label: 'M12: Conducir en Sentido Contrario' },
  COLLISION: { score: -25, damage: 30, label: 'Choque detectado' },
  BUMP: { score: -5, damage: 10, label: 'Rompemuelas a alta velocidad' },
};

// ---- Scenario presets, picked on the start screen ----
// `layout: 'line'` scenarios reuse the single long avenue (world/road.js).
// `layout: 'grid'` builds a real turnable street grid (world/gridCity.js).
export const SCENARIOS = {
  straight: {
    id: 'straight',
    layout: 'line',
    label: 'Recta Directa',
    description: 'Avenida larga y recta. Ideal para practicar velocidad, señalización de carril y distancias de frenado.',
    laneCountPerSide: 2,
    roadLength: 3000,
    aiDensity: 1,
    aiTargetCount: 9,
    badDriverMultiplier: 1,
    speedLimit: 50,
  },
  highway: {
    id: 'highway',
    layout: 'line',
    label: 'Autopista Densa',
    description: 'Vía ancha de tres carriles por sentido con tráfico denso y conductores imprudentes. Pon a prueba tus reflejos.',
    laneCountPerSide: 3,
    roadLength: 3000,
    aiDensity: 1.9,
    aiTargetCount: 26,
    badDriverMultiplier: 2.4,
    speedLimit: 80,
  },
  grid: {
    id: 'grid',
    layout: 'grid',
    label: 'Ciudad con Giros',
    description: 'Cuadrícula urbana de avenidas y cruces reales con semáforos en cada esquina. Practica giros, cesión de paso y maniobras.',
    laneCountPerSide: 1,
    blocks: 3,             // streets per axis -> (blocks-1)^2... see gridCity.js for exact layout
    blockSize: 150,
    aiDensity: 1.2,
    aiTargetCount: 12,
    badDriverMultiplier: 1.6,
    speedLimit: 40,
  },
};
