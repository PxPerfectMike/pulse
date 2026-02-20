// main.js — Glue layer. Connects engine, renderer, audio, and input.

import { GameEngine } from './engine.js';
import { Renderer } from './renderer.js';
import { AudioSystem } from './audio.js';

const canvas = document.getElementById('game');
const engine = new GameEngine();
const renderer = new Renderer(canvas);
const audio = new AudioSystem();

let lastRAFTimestamp = 0;  // performance.now() of last frame
let deathTimestamp = 0;
let deathElapsed = 0;
let startScreenTime = 0;
let retryReady = false;

// --- Engine event subscriptions ---

engine.on('beat', ({ momentum }) => {
  audio.playBeat(momentum);
  renderer.onBeat();
});

engine.on('hit', (result) => {
  audio.playHit(result.quality, engine.state.momentum);
});

engine.on('miss', ({ obstacle, graceProtected }) => {
  if (!graceProtected) {
    renderer.spawnMissParticles(renderer.cx, renderer.cy);
    audio.playMiss();
  }
});

engine.on('comboMilestone', () => {
  audio.playComboMilestone();
});

engine.on('lifeGain', () => {
  audio.playLifeGain();
});

engine.on('death', () => {
  // Death handled in game loop (needs RAF timestamp)
});

// --- Precise tap timing ---
// The engine tracks its own cumulative time. When a tap arrives between frames,
// we compute the precise engine-time by adding the delta since the last frame.

function getEngineTapTime() {
  const now = performance.now();
  const sinceLastFrame = now - lastRAFTimestamp;
  // Clamp to reasonable range (don't let tab-switch cause huge offsets)
  const clamped = Math.min(sinceLastFrame, 50);
  return engine.state.time + clamped;
}

// --- Input handling ---

function handleTap() {
  const s = engine.state;

  if (s.phase === 'ready') {
    audio.init();
    audio.resume();
    engine.start();
    lastRAFTimestamp = performance.now();
    return;
  }

  if (s.phase === 'dead') {
    if (retryReady) {
      engine.reset();
      renderer.reset();
      deathTimestamp = 0;
      deathElapsed = 0;
      retryReady = false;
      engine.start();
      lastRAFTimestamp = performance.now();
      audio.resume();
    }
    return;
  }

  if (s.phase === 'running') {
    audio.resume();
    engine.tap(getEngineTapTime());
  }
}

// Mouse / touch
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleTap();
});
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleTap();
}, { passive: false });

// Keyboard: space, enter, Z, X
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyZ' || e.code === 'KeyX') {
    e.preventDefault();
    handleTap();
  }
  // Mute toggle
  if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
  }
});

// --- Game loop ---

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  if (!lastRAFTimestamp) lastRAFTimestamp = timestamp;
  let dt = timestamp - lastRAFTimestamp;
  lastRAFTimestamp = timestamp;

  // Cap dt to prevent spiral of death on tab-switch
  if (dt > 100) dt = 16.67;

  const s = engine.state;

  if (s.phase === 'ready') {
    startScreenTime += dt;
    renderer.renderStartScreen(renderer.ctx, startScreenTime);
    return;
  }

  if (s.phase === 'running') {
    engine.update(dt);
    audio.updateDrone(s.momentum);
  }

  if (s.phase === 'dead') {
    if (!deathTimestamp) {
      deathTimestamp = timestamp;
      audio.playDeath();
      renderer.spawnDeathParticles(renderer.cx, renderer.cy);
    }
    deathElapsed = timestamp - deathTimestamp;
    if (deathElapsed > 1200) retryReady = true;
  }

  // Render
  renderer.render(s, dt);

  if (s.phase === 'dead') {
    renderer.renderDeathScreen(renderer.ctx, s, deathElapsed);
  }
}

// Start loop
requestAnimationFrame(gameLoop);
