// run_sim.mjs — Node.js headless simulation of the game engine.
// Run with: node run_sim.mjs
//
// Fixed simulation: tap plans are assigned ONCE per obstacle (not re-rolled
// each frame), missRate is decided once, and engine.state.time is used
// instead of an external counter (avoids hitstop desync).

import { GameEngine, HIT_QUALITY } from './js/engine.js';

const PROFILES = {
  perfect:    { name: 'Perfect (AI)',     mean: 8,   std: 5,   missRate: 0.00 },
  human_pro:  { name: 'Pro Human',        mean: 22,  std: 12,  missRate: 0.01 },
  human_good: { name: 'Good Human',       mean: 45,  std: 25,  missRate: 0.03 },
  human_avg:  { name: 'Average Human',    mean: 75,  std: 35,  missRate: 0.06 },
  beginner:   { name: 'Beginner',         mean: 120, std: 50,  missRate: 0.12 },
  terrible:   { name: 'Terrible',         mean: 160, std: 60,  missRate: 0.25 },
};

function gaussRandom(mean, std) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

function simulateRun(profile, maxTime = 180000) {
  const engine = new GameEngine();
  engine.start();
  const DT = 16.67;

  while (engine.state.phase === 'running' && engine.state.time < maxTime) {
    engine.update(DT);

    const now = engine.state.time;

    for (const obs of engine.state.obstacles) {
      if (obs.hit || obs.missed) continue;

      // Assign a tap plan ONCE per obstacle on first encounter
      if (obs._plan === undefined) {
        // Decide: will this player try to hit this obstacle?
        if (Math.random() < profile.missRate) {
          obs._plan = null; // deliberately ignore
        } else {
          // Pre-compute when this player will tap
          const precision = Math.abs(gaussRandom(profile.mean, profile.std));
          const earlyOrLate = Math.random() < 0.5 ? -1 : 1;
          obs._plan = obs.hitTime + earlyOrLate * precision;
        }
      }

      // Skip if deliberately missing
      if (obs._plan === null) continue;

      // Tap when the current engine time crosses the planned tap time
      // (within one frame of the target)
      if (now >= obs._plan - DT && now <= obs._plan + DT) {
        engine.tap(obs._plan);
      }
    }
  }

  return engine.state;
}

function simulateBatch(profileKey, N = 500) {
  const profile = PROFILES[profileKey];
  const results = [];
  for (let i = 0; i < N; i++) results.push(simulateRun(profile));

  const scores = results.map(r => r.score);
  const survivals = results.map(r => r.stats.survivalTime / 1000);
  const combos = results.map(r => r.maxCombo);
  const precisions = results.map(r =>
    r.stats.hitCount > 0 ? r.stats.totalPrecisionMs / r.stats.hitCount : 0
  );

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const med = arr => { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length/2)]; };
  const p95 = arr => { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length * 0.95)]; };
  const p05 = arr => { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length * 0.05)]; };

  const qt = { perfect: 0, great: 0, good: 0, miss: 0 };
  results.forEach(r => {
    qt.perfect += r.stats.perfect;
    qt.great += r.stats.great;
    qt.good += r.stats.good;
    qt.miss += r.stats.miss;
  });

  const total = qt.perfect + qt.great + qt.good + qt.miss;

  return {
    profile: profile.name,
    N,
    avgScore: Math.round(avg(scores)),
    medScore: Math.round(med(scores)),
    p95Score: Math.round(p95(scores)),
    avgSurvival: avg(survivals).toFixed(1),
    medSurvival: med(survivals).toFixed(1),
    p95Survival: p95(survivals).toFixed(1),
    p05Survival: p05(survivals).toFixed(1),
    avgCombo: avg(combos).toFixed(1),
    maxCombo: Math.max(...combos),
    avgPrecision: avg(precisions).toFixed(1),
    qualityPct: {
      perfect: (qt.perfect / total * 100).toFixed(1),
      great: (qt.great / total * 100).toFixed(1),
      good: (qt.good / total * 100).toFixed(1),
      miss: (qt.miss / total * 100).toFixed(1),
    },
    successRate: ((1 - qt.miss / total) * 100).toFixed(1),
    total,
  };
}

console.log('\n=== WEIRD MOMENTUM — Simulation Results (v2, data-tuned) ===');
console.log(`=== 500 runs per profile ===\n`);
console.log('Profile          | Avg Score | Med Surv | P5-P95 Surv  | Avg Combo | Max Combo | Precision | Hit Rate | Quality Distribution');
console.log('-----------------|-----------|----------|--------------|-----------|-----------|-----------|----------|---------------------');

for (const key of Object.keys(PROFILES)) {
  const r = simulateBatch(key, 500);
  const qd = `P:${r.qualityPct.perfect}% G:${r.qualityPct.great}% Go:${r.qualityPct.good}% M:${r.qualityPct.miss}%`;
  const survRange = `${r.p05Survival}s-${r.p95Survival}s`;
  console.log(
    `${r.profile.padEnd(17)}| ${String(r.avgScore).padStart(9)} | ${(r.medSurvival + 's').padStart(8)} | ${survRange.padStart(12)} | ${String(r.avgCombo).padStart(9)} | ${String(r.maxCombo).padStart(9)} | ${(r.avgPrecision + 'ms').padStart(9)} | ${(r.successRate + '%').padStart(8)} | ${qd}`
  );
}

console.log('\n--- Target Benchmarks ---');
console.log('Session length:  30-90s runs (casual), 5-12min sessions');
console.log('Success rate:    ~85% for average player (85% rule)');
console.log('Near-miss:       ~30% of deaths should be near-misses');
console.log('BPM range:       100 BPM (start) → 160 BPM (max momentum)');
console.log('Starting BPM:    ~116 BPM (momentum 0.30)');
console.log('');
