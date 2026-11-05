/**
 * Lunar OS — motor de áudio.
 *
 * Todo som do sistema é SINTETIZADO em tempo real com a Web Audio API.
 * Não existe nenhum .mp3/.wav no projeto: apenas osciladores, ruído gerado
 * por buffer e filtros. Isso mantém o pacote minúsculo e permite que cada
 * evento da interface tenha uma assinatura sonora própria.
 *
 * Observação: navegadores bloqueiam áudio antes de um gesto do usuário.
 * O boot chama `unlock()` em qualquer gesto (ou tenta direto) e, quando o
 * contexto segue suspenso, o som é silenciosamente dispensado.
 */

export class AudioEngine {
  constructor({ volume = 0.55 } = {}) {
    this.supported = Boolean(window.AudioContext || window.webkitAudioContext);
    this.enabled = true;      // preferência do usuário (somente em memória)
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.volume = volume;
    this._unlockBound = false;
  }

  /** Cria (uma única vez) o grafo de áudio: master gain → compressor → saída. */
  ensure() {
    if (!this.supported) return null;

    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;

      // Um compressor de segurança evita clipping quando o acorde de boot
      // soma várias vozes simultâneas.
      this.compressor = this.ctx.createDynamicsCompressor?.() ?? null;
      if (this.compressor) {
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 22;
        this.compressor.ratio.value = 3.5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.22;
        this.master.connect(this.compressor).connect(this.ctx.destination);
      } else {
        this.master.connect(this.ctx.destination);
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /** Pronto para tocar AGORA? (contexto existente, habilitado e rodando) */
  get ready() {
    return Boolean(this.enabled && this.ctx && this.ctx.state === 'running');
  }

  get state() {
    if (!this.supported) return 'unsupported';
    if (!this.ctx) return 'idle';
    return this.ctx.state; // 'running' | 'suspended' | 'closed'
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        now,
        0.05
      );
    }
    return this.enabled;
  }

  /**
   * Tenta destravar o áudio. Deve ser chamada dentro de um gesto do usuário.
   * @returns {Promise<boolean>} true se o contexto ficou 'running'.
   */
  async unlock() {
    const ctx = this.ensure();
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      // ARMADILHA: sem gesto do usuário, o Chrome bloqueia o autoplay e
      // `ctx.resume()` NÃO rejeita — a Promise simplesmente nunca resolve.
      // Qualquer `await` nela trava quem chamou para sempre. Foi assim que o
      // boot ficava preso em "Pronto" sem nunca revelar o desktop.
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, 700)),
      ]);
    } catch {
      /* ignorado */
    }
    return ctx.state === 'running';
  }

  /** Instala um único listener global que destrava o áudio no primeiro gesto. */
  armUnlockOnFirstGesture() {
    if (this._unlockBound || !this.supported) return;
    this._unlockBound = true;
    const handler = () => {
      this.unlock();
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('touchstart', handler, true);
    };
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
    window.addEventListener('touchstart', handler, true);
  }

  // --------------------------------------------------------------- helpers --
  _now() {
    return this.ctx.currentTime;
  }

  /**
   * Cria uma voz com envelope ADSR simples e devolve o ganho para conectar.
   * attack/release em segundos, decay em segundos.
   */
  _voice({
    start = 0,
    duration = 1,
    attack = 0.01,
    decay = 0.2,
    peak = 0.2,
    release = 0.4,
    hold = true,
  } = {}) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const t0 = start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);

    if (hold) {
      const sustainEnd = Math.max(t0 + attack + 0.001, t0 + duration);
      gain.gain.setTargetAtTime(peak * 0.72, t0 + attack, Math.max(decay, 0.001) / 3);
      gain.gain.setTargetAtTime(0.0001, sustainEnd, Math.max(release, 0.001) / 3.5);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    }

    return gain;
  }

  _osc(type, frequency, detune = 0) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    if (detune) osc.detune.value = detune;
    return osc;
  }

  // ------------------------------------------------------------ sons ------ *

  /**
   * SOM DE BOOT — acorde crescente, futurista e limpo.
   *
   * Camadas:
   *  1. Sub/pad que "sobe" de frequência (glissando) — sensação de partida.
   *  2. Acorde em quinta + nona (Dó maior add9) aberto em arpejo.
   *  3. Sino cristalino no topo, com decaimento longo.
   *
   * Tudo passa por um lowpass que abre junto com o acorde: o som nasce
   * abafado e termina aberto e luminoso.
   */
  async playBootSequence() {
    const ctx = this.ensure();
    if (!ctx) return false;

    if (ctx.state !== 'running') {
      const unlocked = await this.unlock();
      if (!unlocked) return false;
    }
    if (!this.enabled) return false;

    const t0 = this._now() + 0.05;
    const out = this.ctx.createGain();
    out.gain.value = 1;

    // Filtro ascendente compartilhado (o "abrir" do acorde)
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.9;
    lowpass.frequency.setValueAtTime(420, t0);
    lowpass.frequency.exponentialRampToValueAtTime(5200, t0 + 1.5);
    lowpass.frequency.setTargetAtTime(3200, t0 + 1.6, 1.1);

    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 55;

    out.connect(highpass).connect(lowpass).connect(this.master);

    // --- 1. Pad que sobe -----------------------------------------------------
    const padNotes = [130.81, 196.0, 261.63]; // C3, G3, C4
    padNotes.forEach((freq, index) => {
      const start = t0 + index * 0.06;
      const gain = this._voice({
        start,
        duration: 1.55,
        attack: 0.5,
        peak: 0.085,
        release: 0.85,
      });
      // Glissando sutil para cima: dá a sensação de "crescendo".
      const osc = this._osc('triangle', freq * 0.985, -4);
      osc.frequency.setValueAtTime(freq * 0.985, start);
      osc.frequency.exponentialRampToValueAtTime(freq, start + 1.1);

      const shimmer = this._osc('sine', freq * 2.005, 6);
      const shimmerGain = this.ctx.createGain();
      shimmerGain.gain.value = 0.16;

      osc.connect(gain);
      shimmer.connect(shimmerGain).connect(gain);
      gain.connect(out);

      osc.start(start);
      shimmer.start(start);
      osc.stop(start + 2.7);
      shimmer.stop(start + 2.7);
    });

    // --- 2. Acorde em arpejo (add9) -----------------------------------------
    // Dó maior com nona: C4, E4, G4, D5 — brilho "espacial" sem dissonância.
    const arp = [261.63, 329.63, 392.0, 587.33];
    arp.forEach((freq, index) => {
      const start = t0 + 0.16 + index * 0.105;
      const gain = this._voice({
        start,
        duration: 0.95,
        attack: 0.045,
        peak: 0.14,
        release: 1.05,
      });
      const osc = this._osc('sine', freq, index % 2 ? 4 : -4);
      const partial = this._osc('triangle', freq * 2, index % 2 ? -6 : 6);
      const partialGain = this.ctx.createGain();
      partialGain.gain.value = 0.1;

      osc.connect(gain);
      partial.connect(partialGain).connect(gain);
      gain.connect(out);

      osc.start(start);
      partial.start(start);
      osc.stop(start + 2.3);
      partial.stop(start + 2.3);
    });

    // --- 3. Sino cristalino --------------------------------------------------
    const bellStart = t0 + 0.62;
    [1046.5, 1567.98, 2093.0].forEach((freq, index) => {
      const gain = this._voice({
        start: bellStart + index * 0.045,
        duration: 0.05,
        attack: 0.012,
        decay: 1.6 - index * 0.35,
        peak: 0.055 - index * 0.012,
        hold: false,
      });
      const osc = this._osc('sine', freq);
      osc.connect(gain).connect(out);
      osc.start(bellStart + index * 0.045);
      osc.stop(bellStart + index * 0.045 + 2.9);
    });

    // --- 4. Sopro de ruído filtrado (o "ar" do boot) -------------------------
    const noiseDur = 1.5;
    const noiseBuffer = this.ctx.createBuffer(
      1,
      Math.ceil(this.ctx.sampleRate * noiseDur),
      this.ctx.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);
    // Ruído suavizado por um filtro de um polo = textura de "ar", não de chiado.
    let smoothed = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      smoothed += (white - smoothed) * 0.06;
      data[i] = smoothed * 2.4;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 0.8;
    noiseFilter.frequency.setValueAtTime(700, t0);
    noiseFilter.frequency.exponentialRampToValueAtTime(4200, t0 + 1.4);
    const noiseGain = this._voice({
      start: t0,
      duration: noiseDur,
      attack: 0.55,
      peak: 0.03,
      release: 0.6,
    });
    noise.connect(noiseFilter).connect(noiseGain).connect(out);
    noise.start(t0);
    noise.stop(t0 + noiseDur + 0.6);

    return true;
  }

  /**
   * Bipe curto de interface (usado nas próximas fases e no botão "Testar som").
   * Um par de senoides com envelope rápido — "tick" limpo, nunca estridente.
   */
  playUiTick({ frequency = 880, duration = 0.09, peak = 0.08 } = {}) {
    if (!this.enabled) return false;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return false;

    const t0 = this._now() + 0.01;
    const gain = this._voice({
      start: t0,
      duration: 0.02,
      attack: 0.006,
      decay: duration,
      peak,
      hold: false,
    });
    const osc = this._osc('sine', frequency);
    const sparkle = this._osc('sine', frequency * 2.5);
    const sparkleGain = this.ctx.createGain();
    sparkleGain.gain.value = 0.22;

    osc.connect(gain);
    sparkle.connect(sparkleGain).connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    sparkle.start(t0);
    osc.stop(t0 + duration + 0.12);
    sparkle.stop(t0 + duration + 0.12);
    return true;
  }

  /** Assinatura sonora do desktop: dois toques ascendentes (confirmação). */
  playChime() {
    if (!this.enabled) return false;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return false;

    const t0 = this._now() + 0.02;
    [
      { freq: 659.25, at: 0 },   // E5
      { freq: 987.77, at: 0.14 }, // B5
    ].forEach(({ freq, at }, index) => {
      const start = t0 + at;
      const gain = this._voice({
        start,
        duration: 0.05,
        attack: 0.012,
        decay: 0.9 - index * 0.2,
        peak: 0.11,
        hold: false,
      });
      const osc = this._osc('sine', freq);
      const body = this._osc('triangle', freq / 2);
      const bodyGain = this.ctx.createGain();
      bodyGain.gain.value = 0.25;
      osc.connect(gain);
      body.connect(bodyGain).connect(gain);
      gain.connect(this.master);
      osc.start(start);
      body.start(start);
      osc.stop(start + 1.2);
      body.stop(start + 1.2);
    });
    return true;
  }
}

// Instância única compartilhada por todo o OS.
export const audio = new AudioEngine();
