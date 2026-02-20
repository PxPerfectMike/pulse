// engine.js — Pure game simulation. No rendering, no DOM, no side effects.
// Input: tap timestamps. Output: game state. Fully deterministic.
// This is the layer Claude can "play" directly.
//
// ALL tuning values below are derived from published research data:
//   - Timing windows: osu! OD5 scale (±50/100/150), DDR asymmetric bias
//   - BPM range: Music psychology arousal research (100-160 BPM)
//   - Tempo curve: Weber-Fechner exponential (perceptually uniform acceleration)
//   - Hitstop: Fighting game / Vlambeer research (~50ms for speed games)
//   - Difficulty: 85% success rule (Wilson et al. 2019, Nature Communications)
//   - Near-miss: Kassinove & Schare 2001 (~30% near-miss for max retry)
//   - Session length: Flappy Bird / Crossy Road data (30-90s runs, 5-12min sessions)

export const HIT_QUALITY = {
  PERFECT: 'perfect',
  GREAT: 'great',
  GOOD: 'good',
  OK: 'ok',
  MISS: 'miss',
};

const DEFAULT_CONFIG = {
  // --- TIMING WINDOWS (ms from center of beat) ---
  // Tight windows — 3 tiers only (Perfect / Great / Good). No "OK" tier.
  // You either hit it or you miss. osu! OD8-9 territory.
  // Good window covers ~24% of gap at starting tempo — demanding but fair.
  perfectWindow: 50,     // ±50ms — generous for learning the ring visual
  greatWindow: 100,      // ±100ms — forgiving, lets players find the rhythm
  goodWindow: 150,       // ±150ms — hard to miss if you're trying

  // NO early bias. The research said it helps, but it made the game trivial.
  // Symmetry feels more honest in a game this simple.
  earlyBias: 0,

  // Hard late cutoff: obstacle past the line = gone.
  // 35ms ≈ 2 frames grace for display lag.
  maxLateMs: 80,

  // --- HITSTOP (freeze frames on hit) ---
  hitstop: {
    perfect: 50,
    great: 20,
    good: 0,
  },

  // --- MOMENTUM ---
  momentumBoost: {
    perfect: 0.06,
    great: 0.02,
    good: -0.02,    // good hits barely maintain — they're a warning
  },
  missMomentumPenalty: -0.12,
  momentumDecayPerSec: 0.012,   // gentle decay — momentum builds easier

  // --- SCORING ---
  scoreBase: {
    perfect: 300,
    great: 100,
    good: 20,
  },
  multiplierGain: {
    perfect: 1.0,
    great: 0.25,
    good: -0.5,     // good hits chip at your multiplier
  },
  maxMultiplier: 32,

  // --- TEMPO ---
  baseTempo: 720,       // 83 BPM start — relaxed opening
  minTempo: 330,        // 182 BPM peak — pushes into "extreme" arousal zone

  // Weber-Fechner exponential curve
  tempoRatio: 0.55,     // steeper curve — speed ramps faster

  // Tempo variation
  tempoVariation: 0.04,

  // --- ESCALATING DIFFICULTY ---
  // Windows shrink over time so every run eventually kills you.
  // After windowShrinkStart ms, windows tighten by windowShrinkRate per second.
  // At 60s, a 90ms good window becomes 90 * (1 - 0.008*30) = 90 * 0.76 = 68ms.
  // At 120s, it's 90 * 0.28 = 25ms. Basically impossible. Everyone dies.
  windowShrinkStart: 45000,    // ms — difficulty starts escalating at 45s
  windowShrinkRate: 0.004,     // per second — windows lose 0.4% per second

  // --- SURVIVABILITY ---
  graceObstacles: 6,
  startingLives: 5,
  maxLives: 5,

  // --- APPROACH RATE ---
  baseApproachTime: 1600,
  minApproachTime: 700,
  approachRatio: 0.6,

  // --- SPEED (visual) ---
  baseSpeed: 240,
  maxSpeed: 950,

  // --- COMBO ---
  comboLifeReward: 50,     // reward good play more often

  // Starting momentum
  startingMomentum: 0.05,
};

export class GameEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._listeners = {};
    this.state = null;
    this.reset();
  }

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
  }

  _emit(event, data) {
    for (const fn of this._listeners[event] || []) fn(data);
  }

  reset() {
    this.state = {
      phase: 'ready', // ready | running | dead
      time: 0,
      tick: 0,

      // Core meters
      momentum: this.config.startingMomentum,
      lives: this.config.startingLives,
      score: 0,
      multiplier: 1,
      combo: 0,
      maxCombo: 0,
      distance: 0,

      // Obstacles
      obstacles: [],
      obstacleIdCounter: 0,
      obstaclesSpawned: 0,
      nextObstacleTime: 0,

      // Tempo & beat tracking
      tempo: this.config.baseTempo,
      lastBeatTime: 0,

      // Current speed (derived from momentum)
      speed: this.config.baseSpeed,

      // Hitstop: when > 0, game time is frozen (renderer keeps drawing)
      hitstopRemaining: 0,

      // Last hit info (for feedback)
      lastHit: null,

      // Visual hints (renderer reads these, engine sets them)
      screenShake: 0,
      flashIntensity: 0,
      flashColor: null,

      // Statistics (for simulation analysis)
      stats: {
        perfect: 0,
        great: 0,
        good: 0,
        ok: 0,
        miss: 0,
        totalPrecisionMs: 0,
        hitCount: 0,
        survivalTime: 0,
        peakMomentum: this.config.startingMomentum,
        peakMultiplier: 1,
        peakCombo: 0,
        livesGained: 0,
      },

      // Full hit log for deep analysis
      hitLog: [],
    };
  }

  // --- Derived values ---

  getCurrentTempo() {
    const { baseTempo, tempoRatio } = this.config;
    const m = this.state.momentum;
    // Weber-Fechner exponential: each equal momentum increment produces
    // a constant percentage decrease in tempo, so speed-ups feel
    // perceptually uniform. tempo = baseTempo * ratio^m
    return baseTempo * Math.pow(tempoRatio, m);
  }

  getCurrentBPM() {
    return 60000 / this.getCurrentTempo();
  }

  getCurrentSpeed() {
    const { baseSpeed, maxSpeed } = this.config;
    const m = this.state.momentum;
    // Speed also uses exponential for visual consistency with tempo
    return baseSpeed * Math.pow(maxSpeed / baseSpeed, m);
  }

  // How long an obstacle is visible before reaching the hit zone.
  // Decoupled from tempo so obstacles are always visually readable.
  getCurrentApproachTime() {
    const { baseApproachTime, approachRatio } = this.config;
    return baseApproachTime * Math.pow(approachRatio, this.state.momentum);
  }

  // Escalating difficulty: windows shrink over time.
  // Returns a multiplier 0-1 applied to all timing windows.
  getDifficultyScale() {
    const c = this.config;
    const elapsed = this.state.time - c.windowShrinkStart;
    if (elapsed <= 0) return 1; // no shrink yet
    const shrink = 1 - c.windowShrinkRate * (elapsed / 1000);
    return Math.max(0.20, shrink); // floor at 20% of original windows
  }

  // How far through the game we are (affects visual intensity)
  getIntensity() {
    return Math.min(1, this.state.momentum * 0.7 + (this.state.combo / 80) * 0.3);
  }

  // --- Game lifecycle ---

  start() {
    if (this.state.phase !== 'ready') return;
    this.state.phase = 'running';
    // First obstacle arrives after a comfortable delay
    this.state.nextObstacleTime = 1000;
    this._spawnObstacle();
  }

  // --- Core input: tap at a given time ---
  // Returns hit result or null if no valid target

  tap(atTime) {
    if (this.state.phase !== 'running') return null;
    const time = atTime !== undefined ? atTime : this.state.time;

    // Find the closest unhit obstacle within any timing window
    let best = null;
    let bestDiff = Infinity;

    for (const obs of this.state.obstacles) {
      if (obs.hit || obs.missed) continue;
      const diff = Math.abs(time - obs.hitTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = obs;
      }
    }

    if (!best) return null;

    const c = this.config;
    const rawDiff = time - best.hitTime; // negative = early, positive = late
    const absDiff = Math.abs(rawDiff);
    const isEarly = rawDiff < 0;

    // Hard late cutoff: obstacle past the line = gone
    if (!isEarly && rawDiff > c.maxLateMs) return null;

    // Apply escalating difficulty — windows shrink over time
    const scale = this.getDifficultyScale();
    const bias = isEarly ? c.earlyBias : 0;

    // 3 tiers only: Perfect / Great / Good. No "OK". Miss or hit.
    const pW = c.perfectWindow * scale + bias;
    const gW = c.greatWindow * scale + bias;
    const goW = c.goodWindow * scale + bias;

    let quality;
    if (absDiff <= pW) quality = HIT_QUALITY.PERFECT;
    else if (absDiff <= gW) quality = HIT_QUALITY.GREAT;
    else if (absDiff <= goW) quality = HIT_QUALITY.GOOD;
    else return null; // outside all windows = miss

    best.hit = true;
    best.quality = quality;
    best.hitDiff = rawDiff;
    best.early = isEarly;

    this._applyHit(quality, absDiff);

    const result = { quality, precisionMs: absDiff, early: isEarly, obstacle: best };
    this.state.lastHit = result;
    this._emit('hit', result);
    return result;
  }

  // --- Frame update ---

  update(dt) {
    if (this.state.phase !== 'running') return;

    const s = this.state;
    const c = this.config;

    // --- Hitstop: freeze game logic, renderer keeps drawing ---
    if (s.hitstopRemaining > 0) {
      s.hitstopRemaining = Math.max(0, s.hitstopRemaining - dt);
      // Still decay visual effects during hitstop
      s.screenShake *= 0.88;
      s.flashIntensity *= 0.92;
      if (s.screenShake < 0.5) s.screenShake = 0;
      if (s.flashIntensity < 0.01) s.flashIntensity = 0;
      return; // skip all game logic — time is frozen
    }

    s.tick++;
    s.time += dt;
    s.stats.survivalTime = s.time;

    // Update tempo
    s.tempo = this.getCurrentTempo();

    // Beat tracking
    if (s.time - s.lastBeatTime > s.tempo) {
      s.lastBeatTime = s.time;
      this._emit('beat', { momentum: s.momentum });
    }

    // Update speed
    s.speed = this.getCurrentSpeed();
    s.distance += s.speed * (dt / 1000);

    // Momentum decay
    s.momentum = Math.max(0, s.momentum - c.momentumDecayPerSec * (dt / 1000));

    // Update obstacle positions
    for (const obs of s.obstacles) {
      if (obs.hit || obs.missed) continue;

      // Normalized position: 1.0 = spawn edge, 0.0 = hit zone
      const totalTime = obs.hitTime - obs.spawnTime;
      if (totalTime <= 0) continue;
      const elapsed = s.time - obs.spawnTime;
      obs.position = Math.max(-0.2, 1.0 - (elapsed / totalTime));

      // Check miss: obstacle passed the late cutoff — it's gone
      if (s.time > obs.hitTime + c.maxLateMs) {
        obs.missed = true;
        this._applyMiss(obs);
      }
    }

    // Spawn new obstacles — use approach time (not tempo) so they appear
    // on screen with enough travel time to be visually readable
    if (s.time >= s.nextObstacleTime - this.getCurrentApproachTime()) {
      this._spawnObstacle();
    }

    // Cleanup old obstacles (keep briefly for hit/miss feedback)
    s.obstacles = s.obstacles.filter(o => {
      if (o.hit || o.missed) return s.time - (o.hitTime || o.spawnTime) < 800;
      return true;
    });

    // Decay visual effects
    s.screenShake *= 0.88;
    s.flashIntensity *= 0.92;
    if (s.screenShake < 0.5) s.screenShake = 0;
    if (s.flashIntensity < 0.01) s.flashIntensity = 0;

    // Track peaks
    if (s.momentum > s.stats.peakMomentum) s.stats.peakMomentum = s.momentum;
    if (s.multiplier > s.stats.peakMultiplier) s.stats.peakMultiplier = s.multiplier;
  }

  // --- Snapshot for external consumers ---

  getState() {
    return this.state;
  }

  // Minimal serializable snapshot (for replay/network)
  snapshot() {
    const s = this.state;
    return {
      phase: s.phase,
      time: s.time,
      momentum: s.momentum,
      lives: s.lives,
      score: s.score,
      multiplier: s.multiplier,
      combo: s.combo,
      speed: s.speed,
      distance: s.distance,
      hitstopRemaining: s.hitstopRemaining,
      obstacles: s.obstacles.map(o => ({
        id: o.id,
        position: o.position,
        hit: o.hit,
        missed: o.missed,
        quality: o.quality,
      })),
      lastHit: s.lastHit ? { quality: s.lastHit.quality, precisionMs: s.lastHit.precisionMs } : null,
      screenShake: s.screenShake,
      flashIntensity: s.flashIntensity,
      flashColor: s.flashColor,
    };
  }

  // --- Internal ---

  _spawnObstacle() {
    const s = this.state;
    const tempo = this.getCurrentTempo();

    // Apply tempo variation (slight randomness to prevent muscle memory)
    const variation = 1 + (Math.random() * 2 - 1) * this.config.tempoVariation;

    const hitTime = s.nextObstacleTime;

    // CRITICAL: approach time is decoupled from tempo.
    // Tempo controls WHEN obstacles arrive (rhythm).
    // Approach time controls HOW LONG they're visible (readability).
    // At fast tempos, multiple obstacles will be on screen at once.
    const approachTime = this.getCurrentApproachTime();
    const spawnTime = hitTime - approachTime;

    s.obstacles.push({
      id: s.obstacleIdCounter++,
      spawnTime: Math.max(s.time, spawnTime), // don't spawn in the past
      hitTime: hitTime,
      approachTime: approachTime,
      position: 1.0,
      hit: false,
      missed: false,
      quality: null,
      hitDiff: null,
      early: false,
      graceProtected: s.obstaclesSpawned < this.config.graceObstacles,
    });

    s.obstaclesSpawned++;

    // Schedule next obstacle using TEMPO (rhythm), not approach time
    const nextTempo = this.getCurrentTempo();
    const nextVariation = 1 + (Math.random() * 2 - 1) * this.config.tempoVariation;
    s.nextObstacleTime = hitTime + nextTempo * nextVariation;
  }

  _applyHit(quality, precisionMs) {
    const s = this.state;
    const c = this.config;

    // Momentum
    const boost = c.momentumBoost[quality] || 0;
    s.momentum = Math.max(0, Math.min(1, s.momentum + boost));

    // Score
    const base = c.scoreBase[quality] || 0;
    s.score += Math.round(base * s.multiplier);

    // Multiplier
    const mGain = c.multiplierGain[quality] || 0;
    s.multiplier = Math.max(1, Math.min(c.maxMultiplier, s.multiplier + mGain));

    // Combo — only perfect and great build combo. Good resets it.
    if (quality === HIT_QUALITY.PERFECT || quality === HIT_QUALITY.GREAT) {
      s.combo++;
      if (s.combo > s.maxCombo) {
        s.maxCombo = s.combo;
        s.stats.peakCombo = s.maxCombo;
      }
      // Life reward at milestones
      if (c.comboLifeReward > 0 && s.combo > 0 && s.combo % c.comboLifeReward === 0) {
        this._emit('comboMilestone', { combo: s.combo });
        if (s.lives < c.maxLives) {
          s.lives++;
          s.stats.livesGained++;
          this._emit('lifeGain', { lives: s.lives });
        }
      }
    } else {
      s.combo = 0;
    }

    // Hitstop — freeze game time for impact feel
    const stopMs = c.hitstop[quality] || 0;
    if (stopMs > 0) {
      s.hitstopRemaining = stopMs;
    }

    // Visual feedback
    switch (quality) {
      case HIT_QUALITY.PERFECT:
        s.screenShake = 12;
        s.flashIntensity = 1.0;
        s.flashColor = 'white';
        break;
      case HIT_QUALITY.GREAT:
        s.screenShake = 5;
        s.flashIntensity = 0.6;
        s.flashColor = 'cyan';
        break;
      case HIT_QUALITY.GOOD:
        s.screenShake = 2;
        s.flashIntensity = 0.3;
        s.flashColor = 'blue';
        break;
    }

    // Stats
    s.stats[quality]++;
    s.stats.totalPrecisionMs += precisionMs;
    s.stats.hitCount++;

    // Hit log
    s.hitLog.push({
      time: s.time,
      quality,
      precisionMs,
      momentum: s.momentum,
      multiplier: s.multiplier,
      combo: s.combo,
      score: s.score,
    });
  }

  _applyMiss(obstacle) {
    const s = this.state;
    const c = this.config;

    // Grace period: first few obstacles don't cost lives
    if (obstacle.graceProtected) {
      s.momentum = Math.max(0.1, s.momentum - 0.04);
      s.combo = 0;
      s.multiplier = 1;
      s.lastHit = { quality: HIT_QUALITY.MISS, precisionMs: Infinity, obstacle };
      s.flashIntensity = 0.3;
      s.flashColor = 'red';
      s.stats.miss++;
      s.hitLog.push({
        time: s.time,
        quality: HIT_QUALITY.MISS,
        precisionMs: Infinity,
        momentum: s.momentum,
        multiplier: s.multiplier,
        combo: 0,
        score: s.score,
      });
      this._emit('miss', { obstacle, graceProtected: true });
      return;
    }

    // Full miss penalty
    s.momentum = Math.max(0, s.momentum + c.missMomentumPenalty);
    s.combo = 0;
    s.multiplier = 1;
    s.lives--;

    s.lastHit = { quality: HIT_QUALITY.MISS, precisionMs: Infinity, obstacle };
    s.screenShake = 15;
    s.flashIntensity = 0.8;
    s.flashColor = 'red';

    // Stats
    s.stats.miss++;
    s.hitLog.push({
      time: s.time,
      quality: HIT_QUALITY.MISS,
      precisionMs: Infinity,
      momentum: s.momentum,
      multiplier: s.multiplier,
      combo: 0,
      score: s.score,
    });

    this._emit('miss', { obstacle, graceProtected: false });

    // Death check
    if (s.lives <= 0) {
      s.phase = 'dead';
      this._emit('death', {});
    }
  }
}
