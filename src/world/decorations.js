import { buildSign } from '../assets/props.js';
import { scene } from '../core/scene.js';
import { ROAD_HALF_WIDTH } from './road.js';

// Purely decorative roadside signage that isn't tied to any rule/system.
export function buildDecorations() {
  const pare = buildSign('', 0xcc1111, 'octagon');
  pare.position.set(ROAD_HALF_WIDTH + 1.2, 0, -2050);
  scene.add(pare);
}
