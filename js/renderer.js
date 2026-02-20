// renderer.js — Concentric ring renderer. Core orb + closing rings.
// Reads engine state, draws everything beautiful.

import { HIT_QUALITY } from './engine.js';

// Color palette — shifts with momentum
const PALETTE = {
  bg: [8, 8, 22],            // deep void
  bgHigh: [18, 5, 30],       // purple-tinted at high momentum

  // Momentum-based core color gradient
  coreLow: [60, 180, 255],     // cool cyan
  coreMid: [180, 60, 255],     // electric purple
  coreHigh: [255, 60, 120],    // hot pink
  coreMax: [255, 230, 200],    // white-hot

  // Ring colors
  ringFar: [80, 50, 160],      // soft purple when distant
  ringClose: [255, 220, 255],  // bright white-pink when near

  // Hit quality colors
  perfect: [255, 255, 255],
  great: [0, 255, 230],
  good: [80, 140, 255],
  ok: [255, 160, 40],
  miss: [255, 40, 40],
};

// Particle types
const PARTICLE_TYPES = {
  HIT_SPARK: 'hit_spark',
  HIT_RING: 'hit_ring',
  SHATTER: 'shatter',
  DEATH: 'death',
  AMBIENT: 'ambient',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.hitTextQueue = [];
    this.lastBeatTime = 0;
    this.beatPulse = 0;
    this.bgStars = [];
    this.ambientParticles = [];
    this.geometryRotation = 0;
    this.coreDamageFlash = 0;  // red flash on core when hit by miss

    // Center coords (set in _resize)
    this.cx = 0;
    this.cy = 0;

    this._initStars();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.maxRingRadius = Math.min(this.width, this.height) * 0.55;
  }

  _initStars() {
    this.bgStars = [];
    for (let i = 0; i < 120; i++) {
      this.bgStars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.5 + 0.3,
        brightness: Math.random() * 0.5 + 0.2,
      });
    }
  }

  // --- Main render ---

  render(engineState, dt) {
    const ctx = this.ctx;
    const s = engineState;
    const intensity = Math.min(1, s.momentum * 0.7 + (s.combo / 80) * 0.3);

    // Apply screen shake
    ctx.save();
    if (s.screenShake > 0.5) {
      const shakeX = (Math.random() - 0.5) * s.screenShake * 2;
      const shakeY = (Math.random() - 0.5) * s.screenShake * 2;
      ctx.translate(shakeX, shakeY);
    }

    // Background
    this._drawBackground(ctx, s, intensity, dt);

    // Background geometry (at higher momentum)
    if (intensity > 0.3) {
      this._drawBackgroundGeometry(ctx, s, intensity, dt);
    }

    // Radial speed lines
    this._drawRadialSpeedLines(ctx, s, intensity, dt);

    // Target ring (hit zone indicator)
    this._drawTargetRing(ctx, s, intensity);

    // Rings (obstacles closing in)
    this._drawRings(ctx, s, intensity);

    // Core orb
    this._drawCore(ctx, s, intensity, dt);

    // Ambient orbiting particles
    this._updateAmbientParticles(ctx, s, intensity, dt);

    // Particles (hit/miss/death effects)
    this._updateAndDrawParticles(ctx, dt);

    // Hit text feedback
    this._drawHitText(ctx, s, dt);

    // Flash overlay
    if (s.flashIntensity > 0.01) {
      this._drawFlash(ctx, s);
    }

    // Danger vignette when lives are low
    if (s.lives <= 2 && s.phase === 'running') {
      this._drawDangerVignette(ctx, s);
    }

    ctx.restore();

    // HUD (not affected by screen shake)
    this._drawHUD(ctx, s, intensity);

    // Decay core damage flash
    this.coreDamageFlash *= 0.93;
    if (this.coreDamageFlash < 0.01) this.coreDamageFlash = 0;

    // Beat pulse
    this._updateBeatPulse(s, dt);
  }

  // --- Background ---

  _drawBackground(ctx, s, intensity, dt) {
    const bg = PALETTE.bg;
    const bgH = PALETTE.bgHigh;
    const t = intensity;

    const r = Math.round(bg[0] + (bgH[0] - bg[0]) * t);
    const g = Math.round(bg[1] + (bgH[1] - bg[1]) * t);
    const b = Math.round(bg[2] + (bgH[2] - bg[2]) * t);

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, this.width, this.height);

    // Radial gradient from core
    const gradR = this.maxRingRadius * (0.6 + intensity * 0.5);
    const coreCol = this._getMomentumColor(s.momentum);
    const grad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, gradR);
    grad.addColorStop(0, `rgba(${coreCol.join(',')}, ${0.04 + intensity * 0.06})`);
    grad.addColorStop(0.5, `rgba(${coreCol.join(',')}, ${0.01 + intensity * 0.02})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars
    for (const star of this.bgStars) {
      const twinkle = Math.sin((s.time || 0) / 800 + star.x * 20) * 0.2 + 0.7;
      ctx.globalAlpha = Math.min(1, star.brightness * twinkle);
      ctx.fillStyle = 'rgba(200, 200, 255, 1)';
      ctx.beginPath();
      ctx.arc(star.x * this.width, star.y * this.height, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Background geometry (subtle rotating shapes at high momentum) ---

  _drawBackgroundGeometry(ctx, s, intensity, dt) {
    const alpha = (intensity - 0.3) * 0.15;
    if (alpha <= 0) return;

    this.geometryRotation += (dt / 1000) * 0.3 * intensity;
    const coreCol = this._getMomentumColor(s.momentum);

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.geometryRotation);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(${coreCol.join(',')}, 0.5)`;
    ctx.lineWidth = 1;

    // Hexagon
    const hexR = this.maxRingRadius * 0.85;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const x = Math.cos(angle) * hexR;
      const y = Math.sin(angle) * hexR;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Inner triangle (counter-rotate)
    if (intensity > 0.5) {
      ctx.rotate(-this.geometryRotation * 2);
      const triR = this.maxRingRadius * 0.6;
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const angle = (Math.PI * 2 * i) / 3 - Math.PI / 2;
        const x = Math.cos(angle) * triR;
        const y = Math.sin(angle) * triR;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --- Radial speed lines (emanating from center) ---

  _drawRadialSpeedLines(ctx, s, intensity, dt) {
    if (intensity < 0.15) return;

    const alpha = Math.min(0.3, (intensity - 0.15) * 0.4);
    const lineCount = 20 + Math.floor(intensity * 30);
    const time = s.time || 0;

    ctx.save();
    ctx.translate(this.cx, this.cy);

    for (let i = 0; i < lineCount; i++) {
      const baseAngle = (Math.PI * 2 * i) / lineCount;
      const angle = baseAngle + Math.sin(time / 2000 + i) * 0.05;

      const innerR = this.maxRingRadius * (0.3 + Math.sin(time / 300 + i * 0.7) * 0.1);
      const outerR = innerR + 20 + intensity * 40;

      const lineAlpha = alpha * (0.3 + Math.sin(time / 200 + i * 1.3) * 0.3);
      if (lineAlpha < 0.01) continue;

      ctx.globalAlpha = lineAlpha;
      ctx.strokeStyle = `rgba(200, 180, 255, 1)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
      ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --- Target ring (hit zone indicator) ---

  _drawTargetRing(ctx, s, intensity) {
    const cx = this.cx;
    const cy = this.cy;
    const coreR = this._coreRadius || 35;
    const time = s.time || 0;

    // Pulsing target ring sits just outside the core — "tap when rings reach here"
    const targetR = coreR + 6;
    const pulse = Math.sin(time / 300) * 0.15 + 0.85;

    ctx.save();

    // Dashed circle
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -time / 50; // slowly rotating dash
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * pulse + intensity * 0.1})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, targetR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Soft glow behind the target ring
    const glowGrad = ctx.createRadialGradient(cx, cy, coreR, cx, cy, targetR + 15);
    glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glowGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.04 * pulse})`);
    glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, targetR + 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // --- Core orb ---

  _drawCore(ctx, s, intensity, dt) {
    const cx = this.cx;
    const cy = this.cy;
    const time = s.time || 0;

    // Breathing
    const breathe = Math.sin(time / 400) * 3;

    // Beat bounce
    const beatScale = this.beatPulse * 12;

    // Core radius: 30 base + momentum growth + breathe + beat
    const coreRadius = 30 + s.momentum * 15 + breathe + beatScale;

    const col = this._getMomentumColor(s.momentum);

    // Outer aura glow
    const auraR = coreRadius * 3 + intensity * 20;
    const auraGrad = ctx.createRadialGradient(cx, cy, coreRadius * 0.5, cx, cy, auraR);
    auraGrad.addColorStop(0, `rgba(${col.join(',')}, ${0.2 + intensity * 0.15})`);
    auraGrad.addColorStop(0.4, `rgba(${col.join(',')}, ${0.05 + intensity * 0.05})`);
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Damage flash — blend toward red when hit by miss
    const dmg = this.coreDamageFlash;
    const drawCol = dmg > 0.05
      ? this._lerpColor(col, PALETTE.miss, dmg)
      : col;

    // Damage flicker — core jitters when damaged
    const flickerX = dmg > 0.1 ? (Math.random() - 0.5) * dmg * 6 : 0;
    const flickerY = dmg > 0.1 ? (Math.random() - 0.5) * dmg * 6 : 0;

    // Main orb
    ctx.shadowColor = `rgb(${drawCol.join(',')})`;
    ctx.shadowBlur = 15 + intensity * 25;

    const orbGrad = ctx.createRadialGradient(
      cx + flickerX - coreRadius * 0.2, cy + flickerY - coreRadius * 0.2, 0,
      cx + flickerX, cy + flickerY, coreRadius
    );
    orbGrad.addColorStop(0, `rgba(255, 255, 255, ${0.6 + intensity * 0.3})`);
    orbGrad.addColorStop(0.4, `rgb(${drawCol.join(',')})`);
    orbGrad.addColorStop(1, `rgba(${drawCol.map(c => Math.floor(c * 0.5)).join(',')}, 0.8)`);

    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(cx + flickerX, cy + flickerY, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // Red damage ring on core surface
    if (dmg > 0.05) {
      ctx.strokeStyle = `rgba(255, 40, 40, ${dmg * 0.8})`;
      ctx.lineWidth = 2 + dmg * 4;
      ctx.beginPath();
      ctx.arc(cx + flickerX, cy + flickerY, coreRadius + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bright inner core
    const innerR = coreRadius * 0.4;
    const innerAlpha = dmg > 0.1
      ? 0.3 + Math.random() * 0.3  // flicker when damaged
      : 0.4 + intensity * 0.3 + this.beatPulse * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${innerAlpha})`;
    ctx.beginPath();
    ctx.arc(cx + flickerX, cy + flickerY, innerR, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Store for other systems
    this._coreRadius = coreRadius;
  }

  // --- Rings (obstacles) ---

  _drawRings(ctx, s, intensity) {
    const cx = this.cx;
    const cy = this.cy;
    const coreR = this._coreRadius || 30;
    const maxR = this.maxRingRadius;

    for (const obs of s.obstacles) {
      if (obs.hit) {
        // Shatter effect — spawn particles on first frame of hit
        if (!obs._shattered) {
          obs._shattered = true;
          // Ring radius at time of hit
          const hitR = coreR + (maxR - coreR) * Math.max(0, obs.position);
          this._spawnRingHitParticles(cx, cy, hitR, obs.quality);
        }
        continue;
      }

      if (obs.missed) {
        // Dramatic miss: ring slams into core then red shockwave out
        if (!obs._missAnimated) {
          obs._missAnimated = true;
          // Trigger core damage flash
          this.coreDamageFlash = 1.0;
          // Spawn inward-collapsing shockwave
          this.particles.push({
            type: PARTICLE_TYPES.HIT_RING,
            x: cx, y: cy,
            radius: coreR + 5,
            maxRadius: coreR + 60,
            life: 1,
            decay: 0.04,
            color: [...PALETTE.miss],
            lineWidth: 3,
          });
        }

        const timeSinceMiss = s.time - obs.hitTime;

        // Phase 1 (0-150ms): ring rapidly collapses into core
        if (timeSinceMiss < 150) {
          const t = timeSinceMiss / 150;
          const collapseR = coreR * (1.2 - t * 1.0); // shrinks from just outside to inside
          const alpha = 1 - t * 0.3;
          const thickness = 4 + (1 - t) * 3;

          ctx.globalAlpha = alpha;
          ctx.shadowColor = `rgb(${PALETTE.miss.join(',')})`;
          ctx.shadowBlur = 15;
          ctx.strokeStyle = `rgb(${PALETTE.miss.join(',')})`;
          ctx.lineWidth = thickness;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(5, collapseR), 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
        // Phase 2 (150-600ms): red flash fades out
        else if (timeSinceMiss < 600) {
          const t = (timeSinceMiss - 150) / 450;
          const fade = 1 - t;
          ctx.globalAlpha = fade * 0.4;
          ctx.fillStyle = `rgba(${PALETTE.miss.join(',')}, 1)`;
          ctx.beginPath();
          ctx.arc(cx, cy, coreR + 10 * (1 - t), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }

      // Active ring
      const pos = Math.max(0, obs.position);
      const ringR = coreR + (maxR - coreR) * pos;
      const proximity = 1 - pos; // 0 = far, 1 = at core

      // Ring color: soft purple far → bright white close → red warning if about to miss
      const isInDanger = pos < 0.08; // very close to core, about to miss
      const dangerT = isInDanger ? 1 - (pos / 0.08) : 0; // 0→1 as it approaches miss
      let col = this._lerpColor(PALETTE.ringFar, PALETTE.ringClose, proximity);
      if (dangerT > 0) {
        col = this._lerpColor(col, PALETTE.miss, dangerT * 0.7);
      }

      // Thickness: visible from far, thick up close
      const thickness = 2.5 + proximity * 4;

      // Glow — visible from spawn, brighter as it approaches
      const urgency = Math.max(0, proximity - 0.65) / 0.35;
      const glowAlpha = 0.6 + proximity * 0.3 + urgency * 0.1;

      // Urgency pulse in final 35% + danger flash when about to miss
      let urgencyPulse = urgency > 0 ? Math.sin((s.time || 0) / 100) * urgency * 0.2 : 0;
      if (dangerT > 0) {
        urgencyPulse += Math.sin((s.time || 0) / 50) * dangerT * 0.3; // faster flash
      }

      ctx.globalAlpha = Math.min(1, glowAlpha + urgencyPulse);

      // Ring glow (outer bloom)
      if (proximity > 0.3) {
        ctx.shadowColor = `rgb(${col.join(',')})`;
        ctx.shadowBlur = 5 + proximity * 15;
      }

      ctx.strokeStyle = `rgb(${col.join(',')})`;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  // --- Ring hit effects ---

  _spawnRingHitParticles(cx, cy, ringRadius, quality) {
    const color = PALETTE[quality] || PALETTE.good;
    const count = quality === 'perfect' ? 40 : quality === 'great' ? 25 : 14;

    // Radial sparks outward from ring
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const r = ringRadius + (Math.random() - 0.5) * 10;
      const speed = 2 + Math.random() * 5 * (quality === 'perfect' ? 1.5 : 1);
      // Both inward and outward bursts
      const dir = Math.random() > 0.4 ? 1 : -0.5;
      this.particles.push({
        type: PARTICLE_TYPES.HIT_SPARK,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed * dir,
        life: 1,
        decay: 0.015 + Math.random() * 0.02,
        color: [...color],
        size: 2 + Math.random() * 3,
      });
    }

    // Shockwave ring expanding outward
    if (quality === 'perfect' || quality === 'great') {
      this.particles.push({
        type: PARTICLE_TYPES.HIT_RING,
        x: cx,
        y: cy,
        radius: ringRadius,
        maxRadius: ringRadius + (quality === 'perfect' ? 80 : 50),
        life: 1,
        decay: 0.03,
        color: [...color],
        lineWidth: quality === 'perfect' ? 3 : 2,
      });
    }

    // Shatter fragments (arc segments of the broken ring)
    const shardCount = quality === 'perfect' ? 10 : quality === 'great' ? 6 : 3;
    for (let i = 0; i < shardCount; i++) {
      const angle = (Math.PI * 2 * i) / shardCount + Math.random() * 0.3;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        type: PARTICLE_TYPES.SHATTER,
        x: cx + Math.cos(angle) * ringRadius,
        y: cy + Math.sin(angle) * ringRadius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: angle,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        life: 1,
        decay: 0.012 + Math.random() * 0.01,
        color: [...color],
        width: 3 + Math.random() * 6,
        height: 8 + Math.random() * 15,
      });
    }

    // Hit quality text
    this.hitTextQueue.push({
      text: quality.toUpperCase() + '!',
      x: cx,
      y: cy - 60 - (this._coreRadius || 30),
      color: [...color],
      time: 0,
      duration: 800,
    });
  }

  // --- Miss particles (called from main.js) ---

  spawnMissParticles(x, y) {
    const coreR = this._coreRadius || 35;

    // Outward explosion of red sparks from core surface (ring crashed into it)
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20 + (Math.random() - 0.5) * 0.3;
      const speed = 2 + Math.random() * 5;
      this.particles.push({
        type: PARTICLE_TYPES.HIT_SPARK,
        x: x + Math.cos(angle) * coreR,
        y: y + Math.sin(angle) * coreR,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.015,
        color: [255, 40 + Math.random() * 60, 20 + Math.random() * 30],
        size: 2 + Math.random() * 3,
      });
    }

    // Red shatter fragments (the ring broke against the core)
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        type: PARTICLE_TYPES.SHATTER,
        x: x + Math.cos(angle) * (coreR + 5),
        y: y + Math.sin(angle) * (coreR + 5),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: angle,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        color: [...PALETTE.miss],
        width: 2 + Math.random() * 4,
        height: 6 + Math.random() * 12,
      });
    }

    this.hitTextQueue.push({
      text: 'MISS',
      x, y: y - 60 - coreR,
      color: [...PALETTE.miss],
      time: 0,
      duration: 600,
    });
  }

  // --- Death particles (called from main.js) ---

  spawnDeathParticles(x, y) {
    // Core implodes then explodes
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 * i) / 60;
      const speed = 1 + Math.random() * 8;
      this.particles.push({
        type: PARTICLE_TYPES.DEATH,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.008 + Math.random() * 0.008,
        color: [255, 100 + Math.random() * 100, 50 + Math.random() * 50],
        size: 2 + Math.random() * 5,
      });
    }
  }

  // --- Ambient orbiting particles ---

  _updateAmbientParticles(ctx, s, intensity, dt) {
    if (intensity < 0.4) {
      this.ambientParticles = [];
      return;
    }

    const time = s.time || 0;
    const targetCount = Math.floor((intensity - 0.4) * 30);

    // Spawn new ambient particles
    while (this.ambientParticles.length < targetCount) {
      this.ambientParticles.push({
        angle: Math.random() * Math.PI * 2,
        dist: (this._coreRadius || 30) * (1.5 + Math.random() * 2),
        speed: 0.5 + Math.random() * 1.5,
        size: 1 + Math.random() * 2,
        brightness: 0.3 + Math.random() * 0.5,
      });
    }
    while (this.ambientParticles.length > targetCount) {
      this.ambientParticles.pop();
    }

    const coreCol = this._getMomentumColor(s.momentum);

    for (const p of this.ambientParticles) {
      p.angle += p.speed * (dt / 1000);
      const wobble = Math.sin(time / 500 + p.angle * 3) * 5;
      const x = this.cx + Math.cos(p.angle) * (p.dist + wobble);
      const y = this.cy + Math.sin(p.angle) * (p.dist + wobble);

      ctx.globalAlpha = p.brightness * (intensity - 0.3);
      ctx.fillStyle = `rgb(${coreCol.join(',')})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Particle update & draw ---

  _updateAndDrawParticles(ctx, dt) {
    const dtFactor = dt / 16.67;

    this.particles = this.particles.filter(p => {
      p.life -= p.decay * dtFactor;
      if (p.life <= 0) return false;

      switch (p.type) {
        case PARTICLE_TYPES.HIT_SPARK:
        case PARTICLE_TYPES.DEATH:
          p.x += p.vx * dtFactor;
          p.y += p.vy * dtFactor;
          p.vx *= 0.98;
          p.vy *= 0.98;
          ctx.globalAlpha = p.life;
          ctx.fillStyle = `rgb(${p.color.join(',')})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
          break;

        case PARTICLE_TYPES.HIT_RING:
          p.radius += (p.maxRadius - p.radius) * 0.1 * dtFactor;
          ctx.globalAlpha = p.life * 0.6;
          ctx.strokeStyle = `rgb(${p.color.join(',')})`;
          ctx.lineWidth = p.lineWidth * p.life;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.stroke();
          break;

        case PARTICLE_TYPES.SHATTER:
          p.x += p.vx * dtFactor;
          p.y += p.vy * dtFactor;
          p.rotation += p.rotSpeed * dtFactor;
          ctx.globalAlpha = p.life * 0.8;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = `rgb(${p.color.join(',')})`;
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
          ctx.restore();
          break;
      }

      return true;
    });

    ctx.globalAlpha = 1;
  }

  // --- Hit text ---

  _drawHitText(ctx, s, dt) {
    this.hitTextQueue = this.hitTextQueue.filter(ht => {
      ht.time += dt;
      if (ht.time >= ht.duration) return false;

      const progress = ht.time / ht.duration;
      const alpha = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
      const yOffset = -progress * 40;
      const scale = progress < 0.15 ? 0.5 + (progress / 0.15) * 0.7 : 1.2 - progress * 0.2;

      ctx.save();
      ctx.translate(ht.x, ht.y + yOffset);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = `rgb(${ht.color.join(',')})`;
      ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = `rgb(${ht.color.join(',')})`;
      ctx.shadowBlur = 10;
      ctx.fillText(ht.text, 0, 0);
      ctx.shadowBlur = 0;

      ctx.restore();
      ctx.globalAlpha = 1;
      return true;
    });
  }

  // --- Flash overlay ---

  _drawFlash(ctx, s) {
    const col = PALETTE[s.lastHit?.quality] || [255, 255, 255];
    ctx.fillStyle = `rgba(${col.join(',')}, ${s.flashIntensity * 0.2})`;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // --- Danger vignette (lives ≤ 2) ---

  _drawDangerVignette(ctx, s) {
    const dangerLevel = s.lives === 1 ? 1.0 : 0.5; // stronger at 1 life
    const time = s.time || 0;
    const pulse = Math.sin(time / 300) * 0.15 + 0.85;
    const alpha = dangerLevel * 0.35 * pulse;

    // Red gradient from edges inward
    const cx = this.cx;
    const cy = this.cy;
    const outerR = Math.max(this.width, this.height) * 0.8;
    const innerR = Math.min(this.width, this.height) * 0.25;

    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
    grad.addColorStop(0.6, 'rgba(255, 0, 0, 0)');
    grad.addColorStop(1, `rgba(200, 0, 0, ${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // At 1 life, add pulsing red border
    if (s.lives === 1) {
      const borderAlpha = 0.15 + Math.sin(time / 200) * 0.1;
      ctx.strokeStyle = `rgba(255, 40, 40, ${borderAlpha})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, this.width - 4, this.height - 4);
    }
  }

  // --- HUD ---

  _drawHUD(ctx, s, intensity) {
    ctx.save();

    // Score — top center
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 36px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(Math.floor(s.score).toLocaleString(), this.width / 2, 20);

    // Multiplier badge
    if (s.multiplier > 1) {
      const mText = `x${s.multiplier.toFixed(1)}`;
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      const mCol = this._getMomentumColor(Math.min(1, s.multiplier / 16));
      ctx.fillStyle = `rgb(${mCol.join(',')})`;
      ctx.fillText(mText, this.width / 2, 62);
    }

    // Combo
    if (s.combo > 2) {
      ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(`${s.combo} COMBO`, this.width / 2, 85);
    }

    // Lives — glowing dots in arc near core
    const coreR = this._coreRadius || 30;
    const livesArcR = coreR + 25;
    const livesSpread = 0.15; // radians between each dot
    const livesBaseAngle = -Math.PI / 2; // top of core
    const totalLivesWidth = (s.lives - 1) * livesSpread;
    const livesStartAngle = livesBaseAngle - totalLivesWidth / 2;

    for (let i = 0; i < s.lives; i++) {
      const angle = livesStartAngle + i * livesSpread;
      const lx = this.cx + Math.cos(angle) * livesArcR;
      const ly = this.cy + Math.sin(angle) * livesArcR;
      const dotR = 4;

      // Glow
      const dotCol = s.lives <= 1 ? PALETTE.miss : PALETTE.coreLow;
      ctx.shadowColor = `rgb(${dotCol.join(',')})`;
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgb(${dotCol.join(',')})`;
      ctx.beginPath();
      ctx.arc(lx, ly, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // BPM indicator — bottom right (subtle)
    if (s.phase === 'running') {
      ctx.textAlign = 'right';
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      const tempo = 720 * Math.pow(0.55, s.momentum);
      const bpm = Math.round(60000 / tempo);
      ctx.fillText(`${bpm} BPM`, this.width - 20, this.height - 20);
    }

    ctx.restore();
  }

  // --- Beat pulse ---

  _updateBeatPulse(s, dt) {
    if (s.phase !== 'running') {
      this.beatPulse *= 0.9;
      return;
    }

    const tempo = 720 * Math.pow(0.55, s.momentum);
    const beatPhase = (s.time % tempo) / tempo;

    if (beatPhase < 0.1 && s.time - this.lastBeatTime > tempo * 0.5) {
      this.beatPulse = 0.8;
      this.lastBeatTime = s.time;
    }

    this.beatPulse *= 0.92;
    if (this.beatPulse < 0.01) this.beatPulse = 0;
  }

  // --- Death screen overlay ---

  renderDeathScreen(ctx, s, deathTime) {
    const elapsed = deathTime;
    const fadeIn = Math.min(1, elapsed / 800);

    // Dark overlay
    ctx.fillStyle = `rgba(0, 0, 0, ${fadeIn * 0.7})`;
    ctx.fillRect(0, 0, this.width, this.height);

    if (fadeIn < 0.3) return;

    const textAlpha = Math.min(1, (fadeIn - 0.3) / 0.5);
    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = 'center';

    // Score
    ctx.fillStyle = 'white';
    ctx.font = 'bold 48px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(Math.floor(s.score).toLocaleString(), this.width / 2, this.height * 0.3);

    ctx.font = '16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('SCORE', this.width / 2, this.height * 0.3 - 40);

    // Stats
    const statsY = this.height * 0.45;
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';

    const statLines = [
      `Best Combo: ${s.maxCombo}`,
      `Perfect: ${s.stats.perfect}  Great: ${s.stats.great}  Good: ${s.stats.good}  Miss: ${s.stats.miss}`,
      `Avg Precision: ${s.stats.hitCount > 0 ? (s.stats.totalPrecisionMs / s.stats.hitCount).toFixed(1) : 0}ms`,
      `Survived: ${(s.stats.survivalTime / 1000).toFixed(1)}s`,
    ];

    statLines.forEach((line, i) => {
      ctx.fillText(line, this.width / 2, statsY + i * 24);
    });

    // Retry prompt
    if (elapsed > 1200) {
      const blink = Math.sin(elapsed / 400) > 0 ? 0.8 : 0.4;
      ctx.globalAlpha = blink;
      ctx.fillStyle = 'white';
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('TAP TO RETRY', this.width / 2, this.height * 0.72);
    }

    ctx.restore();
  }

  // --- Start screen ---

  renderStartScreen(ctx, time) {
    // Background
    const bgPulse = Math.sin(time / 1000) * 0.03;
    ctx.fillStyle = `rgb(${8 + bgPulse * 100}, ${8 + bgPulse * 50}, ${22 + bgPulse * 100})`;
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars
    for (const star of this.bgStars) {
      const twinkle = Math.sin(time / 500 + star.x * 10) * 0.3 + 0.5;
      ctx.globalAlpha = star.brightness * twinkle;
      ctx.fillStyle = 'rgba(200, 200, 255, 1)';
      ctx.beginPath();
      ctx.arc(star.x * this.width, star.y * this.height, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const cx = this.cx;
    const cy = this.cy;

    // Breathing core orb
    const breathe = Math.sin(time / 500) * 5;
    const coreR = 35 + breathe;
    const col = PALETTE.coreLow;

    // Aura
    const auraR = coreR * 3;
    const auraGrad = ctx.createRadialGradient(cx, cy, coreR * 0.3, cx, cy, auraR);
    auraGrad.addColorStop(0, `rgba(${col.join(',')}, 0.15)`);
    auraGrad.addColorStop(0.5, `rgba(${col.join(',')}, 0.03)`);
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Orb
    ctx.shadowColor = `rgb(${col.join(',')})`;
    ctx.shadowBlur = 20 + Math.sin(time / 600) * 8;

    const orbGrad = ctx.createRadialGradient(
      cx - coreR * 0.2, cy - coreR * 0.2, 0,
      cx, cy, coreR
    );
    orbGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    orbGrad.addColorStop(0.4, `rgb(${col.join(',')})`);
    orbGrad.addColorStop(1, `rgba(${col.map(c => Math.floor(c * 0.4)).join(',')}, 0.8)`);

    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Demo ring — slowly closing in on the core to show the mechanic
    const demoPos = ((time / 3000) % 1); // 0→1 loop every 3s
    const demoR = coreR + (this.maxRingRadius * 0.6 - coreR) * (1 - demoPos);
    const demoAlpha = demoPos < 0.1 ? demoPos / 0.1 : demoPos > 0.85 ? (1 - demoPos) / 0.15 : 0.6;
    const demoCol = this._lerpColor(PALETTE.ringFar, PALETTE.ringClose, demoPos);
    ctx.globalAlpha = demoAlpha;
    ctx.strokeStyle = `rgb(${demoCol.join(',')})`;
    ctx.lineWidth = 2 + demoPos * 3;
    ctx.beginPath();
    ctx.arc(cx, cy, demoR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Target ring hint (dashed)
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -time / 60;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Title above core
    ctx.textAlign = 'center';
    const titleY = cy - coreR - 70;

    ctx.save();
    ctx.translate(cx, titleY);

    ctx.shadowColor = 'rgba(180, 60, 255, 0.8)';
    ctx.shadowBlur = 30 + Math.sin(time / 600) * 10;
    ctx.fillStyle = 'white';
    ctx.font = 'bold 56px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WEIRD', 0, 0);
    ctx.shadowBlur = 0;

    // Subtitle
    ctx.fillStyle = 'rgba(180, 120, 255, 0.7)';
    ctx.font = '16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PULSE', 0, 36);
    ctx.restore();

    // Instructions (below core)
    const instrY = cy + coreR + 60;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Tap when rings reach the core', cx, instrY);

    // Tap to start
    const startY = instrY + 40;
    const blink = Math.sin(time / 500) > 0 ? 0.9 : 0.4;
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('TAP TO START', cx, startY);
    ctx.globalAlpha = 1;
  }

  // --- Utilities ---

  _getMomentumColor(m) {
    if (m < 0.33) {
      return this._lerpColor(PALETTE.coreLow, PALETTE.coreMid, m / 0.33);
    } else if (m < 0.66) {
      return this._lerpColor(PALETTE.coreMid, PALETTE.coreHigh, (m - 0.33) / 0.33);
    } else {
      return this._lerpColor(PALETTE.coreHigh, PALETTE.coreMax, (m - 0.66) / 0.34);
    }
  }

  _lerpColor(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }
}
