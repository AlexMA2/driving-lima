import { buildSign } from '../assets/props';
import { scene } from '../core/scene';
import { ROAD_HALF_WIDTH } from './road';

// Purely decorative roadside signage that isn't tied to any rule/system.
export function buildDecorations(): void {
  const pare = buildSign('', 0xcc1111, 'octagon');
  pare.position.set(ROAD_HALF_WIDTH + 1.2, 0, -2050);
  scene.add(pare);
}
