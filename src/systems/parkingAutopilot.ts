import * as THREE from 'three';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../entities/player';
import { PARKING } from '../world/parkingLot';
import {
  currentParkingStepId, getParkingPose, exitMetrics,
  parallelMetrics, perpendicularMetrics, diagonalMetrics, TURN_RADIUS, REAR_OVERHANG,
} from './parking';
import { AutopilotController } from './autopilotKit';

// The "AI" button for the three parking exercises (world/parkingLot.ts / systems/parking.ts): drives
// each mode's own reference-point method — the same one PARALLEL_STEPS/PERPENDICULAR_STEPS/
// DIAGONAL_STEPS teach a human, in the same order — by watching which step is active and steering
// toward that step's own target. It never touches systems/parking.ts's grading state directly; that
// keeps running every frame regardless of who is at the wheel and advances the step on its own.

const ap = new AutopilotController();
export const isAutoplayOn = (): boolean => ap.isOn();
export const stopAutoplay = (): void => ap.stop();
export const toggleAutoplay = (): void => ap.toggle();

interface Scratch { signaled: boolean }
const freshScratch = (): Scratch => ({ signaled: false });

function tickParallel(stepId: string, dt: number): void {
  const P = PARKING, pose = getParkingPose();
  const s = ap.scratch(stepId, freshScratch);
  const frontCarSideX = P.kerbX - 0.3 - 2 * CAR_HALF_WIDTH;

  switch (stepId) {
    case 'align': {
      const targetX = frontCarSideX - 0.8 - CAR_HALF_WIDTH;
      const targetZ = P.zF - CAR_HALF_LENGTH;
      ap.driveToward(targetX, targetZ, pose.z - targetZ > 8 ? 8 : 1.5, dt);
      break;
    }
    case 'reverse':
      if (!s.signaled) { ap.tap('signalRight'); s.signaled = true; }
      ap.setHeld('steerRight', true); ap.setHeld('steerLeft', false);
      ap.driveSpeed(-3, dt);
      break;
    case 'straight':
      ap.setHeld('steerRight', false); ap.setHeld('steerLeft', false);
      ap.driveSpeed(-3, dt);
      break;
    case 'left':
      ap.setHeld('steerLeft', true); ap.setHeld('steerRight', false);
      ap.driveSpeed(-2.5, dt);
      break;
    case 'finish': {
      ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
      if (parallelMetrics().parked) { ap.driveSpeed(0, dt); break; }
      // recentre along the slot, straight — the three manoeuvres above already land close
      const errZ = pose.z - (P.zF + P.zR) / 2;
      ap.driveSpeed(Math.abs(errZ) > 0.3 ? THREE.MathUtils.clamp(errZ * 1.2, -2, 2) : 0, dt);
      break;
    }
    case 'exit': {
      if (!s.signaled) { ap.tap('signalLeft'); s.signaled = true; }
      ap.driveToward(P.laneEdgeX - 0.5, pose.z - 15, exitMetrics() ? 0 : 6, dt);
      break;
    }
  }
}

function tickPerpendicular(stepId: string, dt: number): void {
  const P = PARKING, pose = getParkingPose();
  const s = ap.scratch(stepId, freshScratch);
  const laneX = P.aisleX - 1.85; // matches the mode's own spawn x: the driving lane past the bays

  switch (stepId) {
    case 'pass': {
      const idealRearBumperZ = P.zBay - TURN_RADIUS() + REAR_OVERHANG;
      const targetZ = idealRearBumperZ - CAR_HALF_LENGTH;
      ap.driveToward(laneX, targetZ, pose.z - targetZ > 8 ? 10 : 1.5, dt);
      break;
    }
    case 'swing':
      if (!s.signaled) { ap.tap('signalRight'); s.signaled = true; }
      ap.setHeld('steerRight', true); ap.setHeld('steerLeft', false);
      ap.driveSpeed(-3, dt);
      break;
    case 'straight':
      ap.setHeld('steerRight', false); ap.setHeld('steerLeft', false);
      ap.driveSpeed(perpendicularMetrics().parked ? 0 : -2, dt);
      break;
    case 'exit': {
      if (!s.signaled) { ap.tap('signalLeft'); s.signaled = true; }
      ap.driveToward(laneX, pose.z - 15, exitMetrics() ? 0 : 6, dt);
      break;
    }
  }
}

function tickDiagonal(stepId: string, dt: number): void {
  const P = PARKING;
  const s = ap.scratch(stepId, freshScratch);

  switch (stepId) {
    case 'enter':
      if (!s.signaled) { ap.tap('signalRight'); s.signaled = true; }
      ap.driveToward(P.bayCx, P.zBay - 2, 7, dt);
      break;
    case 'straight':
      ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
      ap.driveSpeed(diagonalMetrics().parked ? 0 : 2, dt);
      break;
    case 'exit':
      if (!s.signaled) { ap.tap('signalLeft'); s.signaled = true; }
      ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
      ap.driveSpeed(exitMetrics() ? 0 : -4, dt);
      break;
  }
}

export function updateAutoplay(dt: number): void {
  if (!ap.isOn()) return;
  const stepId = currentParkingStepId();
  if (stepId) {
    if (PARKING.mode === 'perpendicular') tickPerpendicular(stepId, dt);
    else if (PARKING.mode === 'diagonal') tickDiagonal(stepId, dt);
    else tickParallel(stepId, dt);
  }
  ap.publish();
}
