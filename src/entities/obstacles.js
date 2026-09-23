// Stalled vehicles currently blocking a lane (see entities/breakdowns.js). Kept in its own
// module so the traffic AI can route around them without importing the module that spawns them.
// Each entry: { x, z, halfZ, halfX }
export const stalledVehicles = [];
