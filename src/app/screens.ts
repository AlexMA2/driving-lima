// The chunks the app loads on demand. Every dynamic import lives here, so the router and the screens'
// prefetching share one loader per chunk (and the bundler sees one entry point for each).
export const loadScenarios = () => import('../screens/scenarios');
export const loadGame = () => import('../screens/game');
export const loadSession = () => import('../game/session');
