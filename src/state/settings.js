import { CONFIG, SCENARIOS } from '../config.js';

// Player-adjustable settings, persisted in localStorage. Two independent groups:
//  - per-scenario settings (traffic, drivers, rules, duration) keyed by scenario id
//  - performance settings, shared by every scenario
// Each group is described by a declarative field list, which the config dialog turns into a
// form (ui/settingsForm.js) and the game reads back through resolveScenario()/getPerformance().

const SCENARIO_KEY = 'dls_scenario_settings_v1';
const PERFORMANCE_KEY = 'dls_performance_v1';

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
    default: sc => sc.pedestrians ?? 0, help: 'Máximo de peatones cruzando a la vez.', show: sc => sc.layout === 'line',
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
    badDriverMultiplier: s.badDrivers / 25, // legacy scale: 25% reckless == 1.0
    pedestrians: s.pedestrians,
    passing: s.passing,
    hazards: s.hazards,
    speedLimit: s.speedLimit,
    duration: s.duration,
    settings: s,
  };
}
