/**
 * Safety-math invariants for the simulation core.
 *
 * SCOPE, stated once and meant literally: everything here is about the SIMULATOR's internal
 * consistency. It proves that the modelled braking corridor is kinematically sound, that a
 * hazard is only called "detected in time" when the numbers say so, and that coverage is
 * withheld when evidence is incomplete. It proves NOTHING about any real robot, real sensor
 * or real warehouse, and nothing here should be read as a real-world safety certification.
 *
 * Before this file src/engine/ -- calibration, geometry, sensing, braking and the evaluator
 * -- had no tests at all; the suite covered UI, store and fixtures only.
 */
import { describe, it, expect } from 'vitest';
import { coverageMetrics, stoppingDistance } from './evaluate';
import { clearance, sweptContact } from './geometry';
import { routeLength, routePose } from './math';
import type { HazardFinding, HazardInstance, HazardLibraryItem, Platform, Pose } from '../../shared/contracts';

const platform = (over: Partial<Platform> = {}): Platform => ({
  mode: 'ground', radiusM: 0.25, heightM: 0.8, speedMps: 1.2,
  brakingDecelerationMps2: 1.5, controlLatencyS: 0.25, clearanceMarginM: 0.1, ...over,
});

const finding = (status: HazardFinding['status'], id: string): HazardFinding => ({
  hazardId: id, status, firstDetectionRangeM: null, firstDetectionAxialDepthM: null,
  theoreticalThresholdRangeM: null, requiredStoppingDistanceM: null,
  reason: 'test', sampleMethod: 'analytic_with_occlusion',
});

const pose = (x: number, z: number): Pose => ({ positionM: [x, 0, z], orientation: [0, 0, 0, 1] });

describe('braking corridor is kinematically sound', () => {
  // S1. The closed form must BE the physics: reaction distance at constant speed, plus the
  // braking distance from a constant deceleration, plus the margin. This is the number every
  // "detected in time" verdict is measured against, so it is checked against the textbook
  // expression rather than against itself.
  it('S1 matches v*t + v^2/(2a) + margin exactly', () => {
    for (const v of [0.2, 0.75, 1.2, 2.5, 3]) {
      for (const t of [0, 0.1, 0.25, 0.8]) {
        for (const a of [0.5, 1.5, 4]) {
          for (const m of [0, 0.1, 0.5]) {
            expect(stoppingDistance(v, t, a, m)).toBeCloseTo(v * t + (v * v) / (2 * a) + m, 12);
          }
        }
      }
    }
  });

  // S2. INDEPENDENT BASELINE. The evaluator advances the robot with a 20 ms fixed-step
  // integrator; the corridor it trusts comes from the closed form above. If those two
  // disagree the robot brakes on a number its own motion does not honour. This integrates the
  // same motion law numerically -- a separate implementation, not a call into the engine --
  // and requires the distance actually travelled to fit inside the corridor.
  it('S2 a fixed-step integration of the same motion stops within the closed-form corridor', () => {
    const dt = 0.02;
    for (const v0 of [0.3, 0.9, 1.2, 2.0, 3.0]) {
      for (const latency of [0, 0.15, 0.25, 0.6]) {
        for (const decel of [0.6, 1.5, 3.0]) {
          const corridor = stoppingDistance(v0, latency, decel, 0);
          let travelled = 0;
          let speed = v0;
          let time = 0;
          const brakeAt = latency;
          // guard against a runaway loop rather than trusting the model to terminate
          for (let step = 0; step < 100000 && speed > 1e-12; step++) {
            const delay = Math.min(Math.max(brakeAt - time, 0), dt);
            const braking = Math.min(dt - delay, speed / decel);
            travelled += speed * delay + speed * braking - 0.5 * decel * braking * braking;
            speed = Math.max(0, speed - decel * braking);
            time += dt;
          }
          expect(speed).toBeLessThan(1e-12); // fully stopped, modulo float residue
          // The integrator must not need MORE room than the corridor promises. A small
          // positive slack is expected because the step lands past the exact stop instant.
          expect(travelled).toBeLessThanOrEqual(corridor + 1e-9);
          expect(travelled).toBeGreaterThan(corridor - dt * v0 - 1e-9);
        }
      }
    }
  });

  // S3. Monotonicity. Faster, slower to react, weaker brakes or a bigger margin can only ever
  // need MORE room. A corridor that shrank as speed rose would quietly under-brake exactly
  // when it matters most.
  it('S3 the corridor never shrinks when the situation gets worse', () => {
    const base = stoppingDistance(1.2, 0.25, 1.5, 0.1);
    expect(stoppingDistance(1.5, 0.25, 1.5, 0.1)).toBeGreaterThan(base); // faster
    expect(stoppingDistance(1.2, 0.40, 1.5, 0.1)).toBeGreaterThan(base); // slower to react
    expect(stoppingDistance(1.2, 0.25, 1.0, 0.1)).toBeGreaterThan(base); // weaker brakes
    expect(stoppingDistance(1.2, 0.25, 1.5, 0.3)).toBeGreaterThan(base); // bigger margin
    for (let v = 0.1; v <= 3; v += 0.1) {
      expect(stoppingDistance(v + 0.1, 0.25, 1.5, 0.1)).toBeGreaterThan(stoppingDistance(v, 0.25, 1.5, 0.1));
    }
  });
});

describe('coverage is withheld when the evidence is incomplete', () => {
  // C1. THE HONESTY INVARIANT. One unknown encounter suppresses the percentage entirely.
  // Reporting "80% detected" while an encounter could not be evaluated is the single most
  // misleading thing this product could do, so it is pinned here rather than left to review.
  it('C1 any unknown encounter forces percent to null', () => {
    const m = coverageMetrics([
      finding('detected_in_time', 'a'), finding('detected_in_time', 'b'),
      finding('missed', 'c'), finding('unknown', 'd'),
    ]);
    expect(m.unknown).toBe(1);
    expect(m.percent).toBeNull();
  });

  it('C1b with no unknowns the percentage is the detected share of eligible encounters', () => {
    const m = coverageMetrics([
      finding('detected_in_time', 'a'), finding('detected_in_time', 'b'),
      finding('missed', 'c'), finding('late', 'd'), finding('excluded', 'e'),
    ]);
    expect(m.eligibleEncounters).toBe(4);
    expect(m.excluded).toBe(1);
    expect(m.percent).toBeCloseTo(50, 12);
  });

  it('C1c no eligible encounters is null, never 0% and never 100%', () => {
    expect(coverageMetrics([]).percent).toBeNull();
    expect(coverageMetrics([finding('excluded', 'a')]).percent).toBeNull();
  });

  // C2. The buckets must account for every finding exactly once. A finding that falls out of
  // the tally is an encounter silently dropped from the report.
  it('C2 every finding lands in exactly one bucket, over many random mixes', () => {
    const statuses: HazardFinding['status'][] = ['detected_in_time', 'late', 'missed', 'unknown', 'excluded'];
    for (let seed = 0; seed < 500; seed++) {
      let x = seed * 2654435761 % 2147483647;
      const next = () => (x = (x * 48271) % 2147483647) / 2147483647;
      const findings = Array.from({ length: 1 + Math.floor(next() * 8) }, (_, i) =>
        finding(statuses[Math.floor(next() * statuses.length)]!, `h${i}`));
      const m = coverageMetrics(findings);
      expect(m.eligibleEncounters + m.excluded).toBe(findings.length);
      expect(m.detectedBeforeBoundary + m.missedOrLate + m.unknown).toBe(m.eligibleEncounters);
      if (m.percent !== null) {
        expect(m.unknown).toBe(0);
        expect(m.percent).toBeGreaterThanOrEqual(0);
        expect(m.percent).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('truth geometry, independent of anything rendered', () => {
  const cableItem: HazardLibraryItem = {
    id: 'lib-cable', version: 1, name: 'Loose cable', type: 'cable',
    dimensionsM: [2, 0.02, 0.02], dimensionEvidence: 'assumed',
    materialClass: 'dark_matte', returnAssumption: 'test fixture, not a measured sensor property',
  };
  const cable = (diameterM: number): HazardInstance => ({
    id: 'cable-1', libraryItem: cableItem,
    geometry: { kind: 'cable', startM: [-1, 0.02, -3], endM: [1, 0.02, -3], diameterM },
    placementSource: 'preset', observedInPhoto: false, justification: 'test',
  });

  // G1. Clearance is a signed distance: positive with room, zero or negative on contact. The
  // swept test must agree with it, because one drives the collision verdict and the other
  // drives the near-miss verdict and they must not disagree about the same instant.
  it('G1 clearance is signed and the swept test agrees with it', () => {
    const p = platform();
    const h = cable(0.02);
    expect(clearance(pose(0, 0), p, h)).toBeGreaterThan(0);
    expect(clearance(pose(0, -3), p, h)).toBeLessThanOrEqual(0);
    const hit = sweptContact(pose(0, 0), pose(0, -3), p, [h]);
    expect(hit).not.toBeNull();
    expect(hit!.hazardId).toBe('cable-1');
    expect(clearance(hit!.pose, p, h)).toBeLessThanOrEqual(1e-9);
  });

  // G2. A pass that never touches the hazard must report no contact; a swept test that
  // reported one would brake the robot for nothing and inflate the false-stop count.
  it('G2 a clear pass reports no contact', () => {
    expect(sweptContact(pose(5, 0), pose(5, -1), platform(), [cable(0.02)])).toBeNull();
  });

  // G3. A THINNER cable is harder to see but not easier to hit: the contact envelope grows
  // with the radius, so shrinking the diameter must never move first contact EARLIER. This is
  // the geometric half of the thin-cable blind spot the product is about.
  it('G3 a thinner cable never produces earlier contact than a thicker one', () => {
    const p = platform();
    const thick = sweptContact(pose(0, 0), pose(0, -3.5), p, [cable(0.08)]);
    const thin = sweptContact(pose(0, 0), pose(0, -3.5), p, [cable(0.01)]);
    expect(thick).not.toBeNull();
    expect(thin).not.toBeNull();
    expect(thin!.fraction).toBeGreaterThanOrEqual(thick!.fraction - 1e-9);
  });
});

describe('route parameterisation is exact and reproducible', () => {
  const route: Pose[] = [pose(0, 0), pose(0, -2), pose(3, -2)];

  it('R1 arc length is the sum of the segments, and the ends are exact', () => {
    expect(routeLength(route)).toBeCloseTo(5, 12);
    expect(routePose(route, 0).positionM).toEqual([0, 0, 0]);
    expect(routePose(route, 5).positionM[0]).toBeCloseTo(3, 9);
  });

  // R2. Determinism is the precondition for every replayed report: the same arc length must
  // always give the same pose, or two runs of one scenario are not comparable.
  it('R2 the same arc length always yields the same pose', () => {
    for (let s = 0; s <= 5; s += 0.137) {
      const a = routePose(route, s);
      const b = routePose(route, s);
      expect(a.positionM).toEqual(b.positionM);
      expect(a.orientation).toEqual(b.orientation);
    }
  });

  // R3. Travel along the route is monotonic: advancing the parameter never moves the robot
  // backwards along the path it has already covered.
  it('R3 advancing arc length never moves backwards along the route', () => {
    let covered = 0;
    let previous = routePose(route, 0);
    for (let s = 0.05; s <= 5; s += 0.05) {
      const current = routePose(route, s);
      const step = Math.hypot(...current.positionM.map((n, i) => n - previous.positionM[i]!));
      covered += step;
      previous = current;
    }
    expect(covered).toBeCloseTo(5, 6);
  });
});
