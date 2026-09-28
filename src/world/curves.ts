// Generic 2D curved-path helpers shared by anything that needs a bent driveable polyline (a
// roundabout's entry/exit flares today, a plain road bend elsewhere): points in the world (x, z)
// plane plus their cumulative arc length, with no assumption about what the curve represents.

export interface Pt { x: number; z: number }

// A polyline with its arc length walked and memoized — the structural shape world/roundabout.ts's
// sampleRoute() needs to interpolate a position/heading at any distance along the path.
export interface Path { pts: Pt[]; cum: number[]; length: number }

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    });
  }
  return pts;
}

// Points along a circular arc centred on (cx, cz), from theta0 to theta1 (radians, either
// direction/sign), spaced roughly `step` world units apart along the arc.
export function arcPoints(cx: number, cz: number, r: number, theta0: number, theta1: number, step = 1.5): Pt[] {
  const sweep = theta1 - theta0;
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) * r) / step));
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const th = theta0 + sweep * (i / steps);
    pts.push({ x: cx + r * Math.cos(th), z: cz + r * Math.sin(th) });
  }
  return pts;
}

// Walks a polyline once to build its cumulative arc length.
export function buildPathFromPoints(pts: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, length: cum[cum.length - 1] };
}
