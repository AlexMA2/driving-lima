import { rng } from '../utils/rng';

export type DriverProfile = 'good' | 'normal' | 'bad';

// Every AI vehicle is a "good", "normal" or "bad" driver, drawn from the scenario's shares
// (settings: goodDrivers / badDrivers %; whatever is left over is normal).
//  - good:   signals before changing lane, keeps bigger gaps, drives a little under the pace,
//            yields to pedestrians and to traffic on a roundabout
//  - normal: the everyday Lima driver — combis and mototaxis still swerve without signalling
//  - bad:    cuts in without signalling, tailgates and brake-checks, speeds, ignores yields
export function pickDriverProfile(scenario?: { badDrivers?: number; goodDrivers?: number } | null): DriverProfile {
  const bad = scenario?.badDrivers ?? 0;
  const good = Math.min(scenario?.goodDrivers ?? 0, 100 - bad);
  const r = rng() * 100;
  return r < bad ? 'bad' : r < bad + good ? 'good' : 'normal';
}

// Multiplier applied to a vehicle's cruise speed.
export const PROFILE_SPEED: Record<DriverProfile, number> = { good: 0.92, normal: 1, bad: 1.2 };
// Following distance: metres standing gap + seconds of headway.
export const PROFILE_GAP: Record<DriverProfile, [number, number]> = { good: [5.5, 1.1], normal: [4, 0.9], bad: [2.5, 0.5] };
