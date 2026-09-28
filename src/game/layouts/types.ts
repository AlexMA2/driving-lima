import type { Spawn } from '../../entities/player';
import type { ResolvedScenario } from '../../state/settings';

// What differs from one scenario layout to the next: the world that is built, the traffic and rules that run
// each frame, and where the steering assist applies. Each layout is its own module (game/layouts/*.ts) and
// is loaded only when a scenario that uses it is played, so a session never carries the code of the
// layouts it is not using. game/session.ts is everything the layouts have in common.
export interface LayoutRuntime {
  // Builds the static world and returns where the player starts. Runs before the player exists.
  build(scenario: ResolvedScenario): Spawn;
  // Sets up whatever needs the player to exist (traffic that spawns clear of it, the tutorial script...).
  init(scenario: ResolvedScenario, api: { endGame(title?: string): void }): void;
  // Per-frame traffic, lights and rules for this layout.
  update(dt: number, speedKmh: number): void;
  // Where the steering assist may straighten the car: the layouts made of straight roads along the world axes.
  steerAssistZone(position: { x: number; z: number }): boolean;
  // A toast shown as the game starts.
  intro?: { title: string; text: string };
  // The "AI drives it for me" button (game/hudTemplate.ts's #aiBtn), for the guided layouts that
  // have one. `toggle` is the button's click; `stop` is called when the exercise ends (or is torn
  // down) so a still-running autopilot doesn't keep holding inputs into the results screen.
  autopilot?: { toggle(): void; stop(): void };
}
