// ============================================================================
// CRITTER PAC-MAZE WEBAUDIO SYNTHESIZER & BGM CONTROLLER
// ============================================================================

class PacSoundManager {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.wakaToggle = false;
    this.bgm = new Audio('music/voxel_village.mp3');
    this.bgm.loop = true;
    this.bgm.volume = 0.34;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  startMusic() {
    if (!this.musicOn) return;
    this.bgm.play().catch(() => {});
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicOn) {
      this.startMusic();
    } else {
      this.bgm.pause();
    }
    return this.musicOn;
  }

  toggleSfx() {
    this.sfxOn = !this.sfxOn;
    return this.sfxOn;
  }

  tone(freq, endFreq, dur = 0.08, type = 'triangle', gainVal = 0.14, delay = 0) {
    if (!this.sfxOn) return;
    this.ensureCtx();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
    }
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  waka() {
    this.wakaToggle = !this.wakaToggle;
    if (this.wakaToggle) {
      this.tone(330, 490, 0.065, 'triangle', 0.13);
    } else {
      this.tone(460, 310, 0.065, 'triangle', 0.13);
    }
  }

  powerPellet() {
    this.tone(440, 660, 0.10, 'sine', 0.18, 0);
    this.tone(660, 880, 0.12, 'sine', 0.18, 0.08);
    this.tone(880, 1175, 0.16, 'triangle', 0.18, 0.16);
  }

  eatGhost() {
    this.tone(300, 920, 0.18, 'sawtooth', 0.16, 0);
    this.tone(580, 1240, 0.16, 'triangle', 0.16, 0.10);
  }

  skill() {
    this.tone(523.25, 783.99, 0.11, 'sine', 0.18, 0);
    this.tone(659.25, 1046.5, 0.15, 'triangle', 0.18, 0.09);
  }

  fruit() {
    this.tone(587.33, 880, 0.11, 'sine', 0.18, 0);
    this.tone(880, 1318.5, 0.15, 'sine', 0.18, 0.09);
  }

  hurt() {
    this.tone(440, 180, 0.22, 'sawtooth', 0.18, 0);
    this.tone(260, 110, 0.26, 'sawtooth', 0.18, 0.18);
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.tone(n, n * 1.02, 0.16, 'triangle', 0.18, i * 0.11);
    });
  }

  click() {
    this.tone(620, 760, 0.045, 'sine', 0.11);
  }
}

export const sound = new PacSoundManager();
