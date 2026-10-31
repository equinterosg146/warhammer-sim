// 2D geometry in inches. The battlefield is seen from above: x runs along the long edge, y along the
// short edge. Models are circles (their bases); terrain areas are polygons; walls are segments.

export interface Vec {
  x: number;
  y: number;
}

export interface Circle extends Vec {
  r: number;
}

export interface Segment {
  a: Vec;
  b: Vec;
}

export type Polygon = Vec[];

export const EPS = 1e-6;

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Distance between the closest points of two bases (0 when they touch or overlap). */
export const edgeDistance = (a: Circle, b: Circle) => Math.max(0, dist(a, b) - a.r - b.r);

/** Closest point to p on segment ab. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return lerp(a, b, t);
}

export const pointSegmentDistance = (p: Vec, a: Vec, b: Vec) => dist(p, closestOnSegment(p, a, b));

/** Shortest distance between two segments. */
export function segmentSegmentDistance(p1: Vec, p2: Vec, q1: Vec, q2: Vec): number {
  if (segmentsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(
    pointSegmentDistance(p1, q1, q2),
    pointSegmentDistance(p2, q1, q2),
    pointSegmentDistance(q1, p1, p2),
    pointSegmentDistance(q2, p1, p2),
  );
}

const orient = (a: Vec, b: Vec, c: Vec) => cross(sub(b, a), sub(c, a));

/** Whether segments p1p2 and q1q2 cross or touch. */
export function segmentsIntersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  const on = (a: Vec, b: Vec, c: Vec) =>
    Math.abs(orient(a, b, c)) <= EPS && Math.min(a.x, b.x) - EPS <= c.x && c.x <= Math.max(a.x, b.x) + EPS && Math.min(a.y, b.y) - EPS <= c.y && c.y <= Math.max(a.y, b.y) + EPS;
  return on(q1, q2, p1) || on(q1, q2, p2) || on(p1, p2, q1) || on(p1, p2, q2);
}

/** Ray casting point-in-polygon test. */
export function pointInPolygon(p: Vec, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const polygonEdges = (poly: Polygon): Segment[] => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }));

/** Distance from a point to the boundary of a polygon (0 inside). */
export function pointPolygonDistance(p: Vec, poly: Polygon): number {
  if (pointInPolygon(p, poly)) return 0;
  return Math.min(...polygonEdges(poly).map((e) => pointSegmentDistance(p, e.a, e.b)));
}

/** Whether any part of a base is within the polygon ("within a terrain area"). */
export const circleTouchesPolygon = (c: Circle, poly: Polygon) => pointPolygonDistance(c, poly) < c.r - EPS || pointInPolygon(c, poly);

/** Whether the segment passes through the interior of the polygon (touching a corner does not count). */
export function segmentCrossesPolygon(a: Vec, b: Vec, poly: Polygon): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  // Collect crossing parameters along ab and test the midpoints between them.
  const ts: number[] = [0, 1];
  const ab = sub(b, a);
  for (const e of polygonEdges(poly)) {
    const ed = sub(e.b, e.a);
    const denom = cross(ab, ed);
    if (Math.abs(denom) < EPS) continue;
    const t = cross(sub(e.a, a), ed) / denom;
    const u = cross(sub(e.a, a), ab) / denom;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < EPS) continue;
    if (pointInPolygon(lerp(a, b, (ts[i] + ts[i + 1]) / 2), poly)) return true;
  }
  return false;
}

/** Points around the edge of a base plus its centre, used to test lines of sight between bases. */
export function samplePoints(c: Circle, n = 8): Vec[] {
  const pts: Vec[] = [{ x: c.x, y: c.y }];
  const r = Math.max(0, c.r - 0.02);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
  }
  return pts;
}

/** Axis-aligned rectangle as a polygon. */
export const rect = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Converts a Wahapedia base size ("32mm", "90 x 52mm", "Use model") to a radius in inches. */
export function baseRadius(baseSize: string, fallbackMm = 60): number {
  const nums = [...baseSize.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const mm = nums.length === 0 ? fallbackMm : nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
  return mm / 25.4 / 2;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
