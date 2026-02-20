// audio.js — Procedural audio. No sample files needed.
// All sounds generated with Web Audio API oscillators and noise.

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.droneGain = null;
    this.droneOsc = null;
    this.droneLfo = null;
    this.initialized = false;
    this.muted = false;
  }

  // Must be called from a user gesture (tap/click)
  init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);

      this._initDrone();
      this.initialized = true;
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.1);
    }
  }

  // --- Ambient drone that rises with momentum ---

  _initDrone() {
    const ctx = this.ctx;

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.masterGain);

    // Base tone
    this.droneOsc = ctx.createOscillator();
    this.droneOsc.type = 'sine';
    this.droneOsc.frequency.value = 55; // A1

    // Sub harmonics with filtering
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 2;

    this.droneOsc.connect(filter);
    filter.connect(this.droneGain);

    // LFO for subtle wobble
    this.droneLfo = ctx.createOscillator();
    this.droneLfo.type = 'sine';
    this.droneLfo.frequency.value = 0.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3;
    this.droneLfo.connect(lfoGain);
    lfoGain.connect(this.droneOsc.frequency);

    this.droneOsc.start();
    this.droneLfo.start();

    this.droneFilter = filter;
  }

  // Call every frame to update drone based on momentum
  updateDrone(momentum) {
    if (!this.initialized || !this.droneGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Volume scales with momentum
    const vol = momentum * 0.12;
    this.droneGain.gain.setTargetAtTime(vol, now, 0.1);

    // Pitch rises with momentum (A1 → A2 → E3)
    const freq = 55 + momentum * 110;
    this.droneOsc.frequency.setTargetAtTime(freq, now, 0.2);

    // Filter opens up with momentum
    this.droneFilter.frequency.setTargetAtTime(200 + momentum * 600, now, 0.2);

    // LFO speed increases
    this.droneLfo.frequency.setTargetAtTime(0.5 + momentum * 3, now, 0.3);
  }

  // --- Beat tick (subtle metronome click) ---

  playBeat(momentum) {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04 + momentum * 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    gain.connect(this.masterGain);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800 + momentum * 400, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // --- Hit sounds ---

  playHit(quality, momentum) {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    switch (quality) {
      case 'perfect':
        this._playPerfectHit(now, momentum);
        break;
      case 'great':
        this._playGreatHit(now, momentum);
        break;
      case 'good':
        this._playGoodHit(now, momentum);
        break;
      case 'ok':
        this._playOkHit(now);
        break;
    }
  }

  _playPerfectHit(now, momentum) {
    const ctx = this.ctx;

    // Crispy snare-like burst
    const noiseLen = 0.08;
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen);

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + noiseLen);

    // Shimmer tone (ascending)
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.15, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    shimmerGain.connect(this.masterGain);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(880 + momentum * 440, now);
    shimmer.frequency.exponentialRampToValueAtTime(1760 + momentum * 440, now + 0.15);
    shimmer.connect(shimmerGain);
    shimmer.start(now);
    shimmer.stop(now + 0.3);

    // Second harmonic for richness
    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(1320 + momentum * 660, now);
    harm.frequency.exponentialRampToValueAtTime(2640, now + 0.1);
    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.06, now);
    harmGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    harm.connect(harmGain);
    harmGain.connect(this.masterGain);
    harm.start(now);
    harm.stop(now + 0.15);
  }

  _playGreatHit(now, momentum) {
    const ctx = this.ctx;

    // Lighter snap
    const snapLen = 0.05;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * snapLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + snapLen);
    src.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + snapLen);

    // Tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660 + momentum * 220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.1, now);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(toneGain);
    toneGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  _playGoodHit(now, momentum) {
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440 + momentum * 110, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  _playOkHit(now) {
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // --- Miss sound ---

  playMiss() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Harsh low buzz
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  // --- Death sound ---

  playDeath() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Descending sweep
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.8);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.6);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.0);

    // Impact noise
    const noiseLen = 0.3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen);
    noise.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + noiseLen);

    // Kill the drone
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0, now, 0.3);
    }
  }

  // --- Combo milestone ---

  playComboMilestone() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Ascending arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = now + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  // --- Life gained ---

  playLifeGain() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1760, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }
}
