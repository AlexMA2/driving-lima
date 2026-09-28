// Whether the real keyboard/mouse driving input should be ignored — set while the tutorial's AI
// autopilot (systems/tutorialAutopilot.ts) is driving instead, so it doesn't fight a key the player
// happens to still be holding. Mirrors the isOverlayOpen() pattern (ui/overlays.ts).
let locked = false;

export function isInputLocked(): boolean {
  return locked;
}

export function setInputLocked(v: boolean): void {
  locked = v;
}
