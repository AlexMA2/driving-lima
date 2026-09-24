import { adoptScreen, goTo, registerScreen, setGearButton } from './app/router';
import { takeAutostart } from './app/autostart';
import { loadGame, loadScenarios } from './app/screens';
import { screen as homeScreen } from './screens/home';
import './ui/ripple';

// The entry point is deliberately tiny. It carries the router and the home screen (whose markup is already in
// index.html, painted with the inlined critical CSS), and nothing else: the scenario picker, the settings
// dialogs and above all the 3D game (three.js, the physics engine, the world builders) are separate chunks that
// are fetched when the player first needs them.

registerScreen('home', async () => ({ screen: homeScreen }));
adoptScreen('home', homeScreen); // its markup is in index.html already
registerScreen('scenarios', loadScenarios);
registerScreen('game', loadGame);

const gear = document.getElementById('globalConfigBtn');
if (gear) {
  setGearButton(gear);
  gear.addEventListener('click', () => {
    void import('./dialogs/globalConfig').then(m => m.openGlobalConfig());
  });
}

// A restart reloads the page with a flag that skips the menus (see app/autostart.ts).
const autostart = takeAutostart();
if (autostart) {
  goTo('game', { scenarioId: autostart }).catch(() => goTo('home')); // a stale or unknown scenario: the normal home screen
} else {
  void goTo('home');
}
