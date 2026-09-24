import { CONFIG, SCENARIOS } from '../config.js';

// Player-adjustable settings, persisted in localStorage. Two independent groups:
//  - per-scenario settings (traffic, drivers, rules, duration) keyed by scenario id
//  - performance settings, shared by every scenario
// Each group is described by a declarative field list, which the config dialog turns into a
// form (ui/settingsForm.js) and the game reads back through resolveScenario()/getPerformance().

const SCENARIO_KEY = 'dls_scenario_settings_v1';
const PERFORMANCE_KEY = 'dls_performance_v1';
const CONTROLS_KEY = 'dls_controls_v1';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {}; // storage blocked or corrupted — behave as if nothing was saved
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: settings just won't persist */ }
}

// ---- Scenario settings ----

const DURATION_CHOICES = CONFIG.GAME_DURATION_OPTIONS.map(sec => ({ value: sec, label: `${Math.round(sec / 60)} min` }));

// `show(scenario)` decides whether a field applies to a scenario at all; `default(scenario)`
// gives its value when the player hasn't changed it.
export const SCENARIO_FIELDS = [
  {
    key: 'duration', section: 'Partida', type: 'choice', label: 'Duración', options: DURATION_CHOICES,
    default: () => CONFIG.DEFAULT_GAME_DURATION, show: sc => !sc.untimed,
  },
  {
    key: 'speedLimit', section: 'Partida', type: 'range', label: 'Límite de velocidad', min: 20, max: 100, step: 5, unit: ' km/h',
    default: sc => sc.speedLimit, help: 'Superarlo por más de 6 km/h genera una papeleta M20.', show: sc => !sc.scripted,
  },
  {
    key: 'traffic', section: 'Tráfico', type: 'range', label: 'Cantidad de tráfico', min: 0, max: 200, step: 10, unit: '%',
    default: () => 100, help: '100% es la densidad normal del escenario.', show: sc => !sc.scripted,
  },
  {
    key: 'badDrivers', section: 'Tráfico', type: 'range', label: 'Conductores imprudentes', min: 0, max: 100, step: 5, unit: '%',
    default: sc => sc.badDrivers, help: 'Porcentaje de vehículos que cambian de carril sin avisar, se pegan a tu parachoques o ignoran el ceda el paso.',
    show: sc => !sc.scripted,
  },
  {
    key: 'goodDrivers', section: 'Tráfico', type: 'range', label: 'Conductores educados', min: 0, max: 100, step: 5, unit: '%',
    default: sc => sc.goodDrivers, help: 'Señalizan antes de cambiar de carril, guardan distancia y ceden el paso. El resto son conductores normales.',
    show: sc => !sc.scripted,
  },
  {
    key: 'passing', section: 'Tráfico', type: 'range', label: 'Autos que te rebasan', min: 0, max: 100, step: 5, unit: '%',
    default: () => 35, help: 'Vehículos rápidos que se acercan por detrás en el carril vecino: revisa los espejos antes de cambiar de carril.',
    show: sc => sc.layout === 'line',
  },
  {
    key: 'hazards', section: 'Tráfico', type: 'choice', label: 'Autos malogrados en tu carril',
    options: [{ value: 'off', label: 'Ninguno' }, { value: 'low', label: 'Pocos' }, { value: 'medium', label: 'Normal' }, { value: 'high', label: 'Muchos' }],
    default: () => 'medium', help: 'Un auto se malogra frente a ti y debes cambiar de carril mientras otro auto te rebasa.', show: sc => sc.layout === 'line',
  },
  {
    key: 'pedestrians', section: 'Tráfico', type: 'range', label: 'Peatones', min: 0, max: 10, step: 1, unit: '',
    default: sc => sc.pedestrians ?? 0, help: 'Máximo de peatones cruzando a la vez. Los peatones cruzan por las cebras y, en las avenidas, también por cualquier parte.',
    show: sc => !sc.scripted,
  },
  {
    key: 'zebras', section: 'Tráfico', type: 'choice', label: 'Cruces peatonales (cebras)',
    options: [{ value: 'off', label: 'Ninguno' }, { value: 'low', label: 'Pocos' }, { value: 'medium', label: 'Normal' }, { value: 'high', label: 'Muchos' }],
    default: () => 'medium', help: 'Cantidad de cebras en la vía. Los conductores educados se detienen para los peatones; tú también debes hacerlo.',
    show: sc => !sc.scripted,
  },
  {
    key: 'parkingSpace', section: 'Estacionamiento', type: 'choice', label: 'Tamaño del espacio',
    options: [{ value: 'wide', label: 'Amplio' }, { value: 'normal', label: 'Normal' }, { value: 'tight', label: 'Justo' }],
    default: () => 'normal', help: 'Hueco entre los autos (paralelo) o ancho de la plaza (batería). Cuanto más justo, más precisión hace falta.',
    show: sc => sc.layout === 'parking',
  },
  {
    key: 'parkingGuide', section: 'Estacionamiento', type: 'toggle', label: 'Guía de referencias', default: true,
    help: 'Muestra los pasos con sus puntos de referencia, las medidas de la maniobra y un rectángulo verde sobre el espacio.',
    show: sc => sc.layout === 'parking',
  },
];

// ---- Performance settings ----

export const PERFORMANCE_FIELDS = [
  {
    key: 'renderScale', section: 'Rendimiento', type: 'range', label: 'Resolución de render', min: 50, max: 100, step: 10, unit: '%',
    default: 100, help: 'Bajarla es lo que más FPS gana en equipos modestos.',
  },
  {
    key: 'shadows', section: 'Rendimiento', type: 'toggle', label: 'Sombras', default: true,
    help: 'Desactivarlas mejora bastante los FPS.',
  },
  {
    key: 'shadowQuality', section: 'Rendimiento', type: 'choice', label: 'Calidad de sombras',
    options: [{ value: 512, label: 'Baja' }, { value: 1024, label: 'Media' }, { value: 2048, label: 'Alta' }], default: 2048,
    enabledWhen: values => values.shadows,
  },
  {
    key: 'viewDistance', section: 'Rendimiento', type: 'choice', label: 'Distancia de visión',
    options: [{ value: 140, label: 'Corta' }, { value: 200, label: 'Media' }, { value: 260, label: 'Larga' }], default: 260,
  },
  {
    key: 'sideMirrors', section: 'Rendimiento', type: 'toggle', label: 'Espejos laterales', default: true,
    help: 'Cada espejo es una vista extra que se dibuja en cada cuadro. Sin ellos no podrás revisar tus costados.',
  },
  { key: 'showFps', section: 'Rendimiento', type: 'toggle', label: 'Mostrar FPS', default: false },
];

// ---- Control feel (global, applied straight onto CONFIG) ----
// The game systems read these CONFIG keys every frame, so applying a saved value is just
// writing it back; the untouched defaults are snapshotted here, before anything is applied.

export const CONTROL_FIELDS = [
  { key: 'THROTTLE_WHEEL_STEP', section: 'Acelerador', type: 'range', label: 'Paso por cada giro de la rueda', min: 0.02, max: 0.3, step: 0.01, unit: '', format: v => v.toFixed(2), help: 'Cuánto sube o baja el acelerador con cada notch de la rueda del mouse.' },
  { key: 'THROTTLE_RAMP_UP', section: 'Acelerador', type: 'range', label: 'Tiempo para acelerar a fondo', min: 0.3, max: 4, step: 0.05, unit: '', format: v => v.toFixed(2) + ' s', help: 'Segundos que tarda el pedal en pasar de 0 a 100%.' },
  { key: 'THROTTLE_RAMP_DOWN', section: 'Acelerador', type: 'range', label: 'Tiempo para soltar a fondo', min: 0.2, max: 4, step: 0.05, unit: '', format: v => v.toFixed(2) + ' s', help: 'Segundos que tarda el pedal en volver de 100% a 0.' },
  { key: 'THROTTLE_AUTO_RELEASE', section: 'Acelerador', type: 'range', label: 'Soltado automático', min: 0, max: 0.5, step: 0.02, unit: '', format: v => (v === 0 ? 'Mantener' : v.toFixed(2) + '/s'), help: 'En "Mantener" el acelerador se queda donde lo dejaste. Con un valor mayor, se va soltando solo cuando dejas de usar la rueda.' },
  { key: 'THROTTLE_INVERT_SCROLL', section: 'Acelerador', type: 'toggle', label: 'Invertir la rueda del mouse', help: 'Girar hacia abajo acelera y hacia arriba desacelera.' },

  { key: 'BRAKE_RAMP_UP', section: 'Freno', type: 'range', label: 'Tiempo para pisar el freno', min: 0.1, max: 2, step: 0.05, unit: '', format: v => v.toFixed(2) + ' s', help: 'Qué tan progresivo es el pedal al mantener S.' },
  { key: 'BRAKE_RAMP_DOWN', section: 'Freno', type: 'range', label: 'Tiempo para soltar el freno', min: 0.1, max: 2, step: 0.05, unit: '', format: v => v.toFixed(2) + ' s' },
  { key: 'BRAKE_FORCE', section: 'Freno', type: 'range', label: 'Fuerza del freno', min: 10, max: 90, step: 1, unit: '' },
  { key: 'ENGINE_BRAKE', section: 'Freno', type: 'range', label: 'Freno motor', min: 0, max: 0.5, step: 0.01, unit: '', format: v => v.toFixed(2), help: 'Cuánto frena el auto solo al soltar el acelerador.' },
  { key: 'HANDBRAKE_FORCE', section: 'Freno', type: 'range', label: 'Fuerza del freno de mano', min: 20, max: 120, step: 1, unit: '' },
  { key: 'REVERSE_SPEED_THRESHOLD_KMH', section: 'Freno', type: 'range', label: 'Velocidad para engranar reversa', min: 0, max: 10, step: 1, unit: ' km/h', help: 'Por debajo de esta velocidad, mantener el freno pasa a retroceder.' },

  { key: 'WHEEL_MAX_ANGLE_DEG', section: 'Volante', type: 'range', label: 'Giro total del volante', min: 180, max: 720, step: 10, unit: '°', help: 'Grados que puede girar el volante hacia cada lado.' },
  { key: 'MAX_STEER', section: 'Volante', type: 'range', label: 'Ángulo máximo de las ruedas', min: 0.2, max: 0.8, step: 0.01, unit: '', format: v => v.toFixed(2) + ' rad' },
  { key: 'WHEEL_FOLLOW_RATE', section: 'Volante', type: 'range', label: 'Respuesta del volante', min: 4, max: 30, step: 1, unit: '', help: 'Qué tan rápido el volante sigue al mouse o al teclado.' },
  { key: 'WHEEL_RETURN_RATE', section: 'Volante', type: 'range', label: 'Autocentrado', min: 1, max: 12, step: 0.5, unit: '', help: 'Qué tan rápido vuelve al centro al soltarlo.' },
  { key: 'KEYBOARD_STEER_FRACTION', section: 'Volante', type: 'range', label: 'Giro con teclado (A / D)', min: 0.2, max: 1, step: 0.05, unit: '', format: v => Math.round(v * 100) + '%', help: 'Porcentaje del giro total al que llegan las teclas.' },
  { key: 'STEER_SPEED_FALLOFF', section: 'Volante', type: 'toggle', label: 'Volante más duro a alta velocidad', help: 'Reduce el giro de las ruedas al ir rápido, para mayor estabilidad.' },

  { key: 'ENGINE_FORCE', section: 'Motor', type: 'range', label: 'Fuerza del motor', min: 200, max: 900, step: 10, unit: '', help: 'Más fuerza, más aceleración.' },
  { key: 'MAX_SPEED_KMH', section: 'Motor', type: 'range', label: 'Velocidad máxima', min: 40, max: 200, step: 5, unit: ' km/h' },
];

const CONTROL_DEFAULTS = Object.fromEntries(CONTROL_FIELDS.map(f => [f.key, CONFIG[f.key]]));

export function getControls() {
  const saved = readJson(CONTROLS_KEY);
  const values = { ...CONTROL_DEFAULTS };
  Object.keys(values).forEach(k => { if (saved[k] !== undefined) values[k] = saved[k]; });
  return values;
}

export function saveControls(values) { writeJson(CONTROLS_KEY, values); }

export function resetControls() {
  writeJson(CONTROLS_KEY, {});
  return { ...CONTROL_DEFAULTS };
}

export function applyControls(values) {
  Object.keys(CONTROL_DEFAULTS).forEach(k => { CONFIG[k] = values[k]; });
}

function defaultsOf(fields, scenario) {
  const out = {};
  fields.forEach(f => { out[f.key] = typeof f.default === 'function' ? f.default(scenario) : f.default; });
  return out;
}

export function getScenarioSettings(scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  const saved = readJson(SCENARIO_KEY)[scenarioId] ?? {};
  const merged = defaultsOf(SCENARIO_FIELDS, scenario);
  // ignore saved keys that no longer exist so a schema change can't leak stale values
  Object.keys(merged).forEach(k => { if (saved[k] !== undefined) merged[k] = saved[k]; });
  return merged;
}

export function saveScenarioSettings(scenarioId, values) {
  const all = readJson(SCENARIO_KEY);
  all[scenarioId] = values;
  writeJson(SCENARIO_KEY, all);
}

export function resetScenarioSettings(scenarioId) {
  const all = readJson(SCENARIO_KEY);
  delete all[scenarioId];
  writeJson(SCENARIO_KEY, all);
  return getScenarioSettings(scenarioId);
}

export function getPerformance() {
  const merged = defaultsOf(PERFORMANCE_FIELDS);
  const saved = readJson(PERFORMANCE_KEY);
  Object.keys(merged).forEach(k => { if (saved[k] !== undefined) merged[k] = saved[k]; });
  return merged;
}

export function savePerformance(values) {
  writeJson(PERFORMANCE_KEY, values);
}

export function resetPerformance() {
  writeJson(PERFORMANCE_KEY, {});
  return getPerformance();
}

// The scenario as the game should build it: the static definition with the player's saved
// settings applied on top. `settings` keeps the raw values for systems that want them.
export function resolveScenario(scenarioId) {
  const base = SCENARIOS[scenarioId];
  const s = getScenarioSettings(scenarioId);
  return {
    ...base,
    aiTargetCount: Math.round((base.aiTargetCount ?? 0) * s.traffic / 100),
    badDrivers: s.badDrivers,
    goodDrivers: Math.min(s.goodDrivers, 100 - s.badDrivers), // the two shares can't exceed the traffic
    pedestrians: s.pedestrians,
    passing: s.passing,
    hazards: s.hazards,
    zebras: s.zebras,
    parkingSpace: s.parkingSpace,
    guide: s.parkingGuide,
    speedLimit: s.speedLimit,
    duration: s.duration,
    settings: s,
  };
}
