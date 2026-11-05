/**
 * Lunar OS — FASE 1
 * Controlador da tela de boot.
 *
 * Responsabilidades:
 *   • conduzir o progresso (curva com pequenas pausas, como um boot real);
 *   • só chegar a 100% quando os recursos críticos estiverem prontos
 *     (fonte + logo + primeiro frame), sem "barra falsa";
 *   • disparar o som de boot sintetizado no fim;
 *   • fazer o fade-out elegante revelando a área de trabalho.
 */

import { MoonProgress } from './moon-progress.js';
import { audio } from '../core/audio.js';
import { clamp, easeInOutSine, prefersReducedMotion, smoothstep } from '../core/ease.js';

/**
 * Curva do progresso em função do tempo normalizado.
 * Os trechos quase verticais/planos imitam as pausas de I/O de um boot real.
 */
const CURVE = [
  { t: 0.0, v: 0.0 },
  { t: 0.07, v: 0.07 },
  { t: 0.19, v: 0.27 },
  { t: 0.27, v: 0.29 },
  { t: 0.43, v: 0.53 },
  { t: 0.53, v: 0.56 },
  { t: 0.69, v: 0.78 },
  { t: 0.79, v: 0.81 },
  { t: 0.9, v: 0.94 },
  { t: 1.0, v: 1.0 },
];

const STEPS = [
  { at: 0.0, label: 'Inicializando núcleo Lunar' },
  { at: 0.18, label: 'Montando sistema de arquivos virtual em tmp/' },
  { at: 0.38, label: 'Carregando tipografia e recursos' },
  { at: 0.55, label: 'Calibrando áudio sintetizado' },
  { at: 0.7, label: 'Sincronizando relógio orbital' },
  { at: 0.85, label: 'Preparando a área de trabalho' },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sampleCurve(t) {
  const time = clamp(t, 0, 1);
  for (let i = 1; i < CURVE.length; i += 1) {
    const prev = CURVE[i - 1];
    const next = CURVE[i];
    if (time <= next.t) {
      const local = smoothstep(prev.t, next.t, time);
      return prev.v + (next.v - prev.v) * local;
    }
  }
  return 1;
}

export class BootSequence {
  constructor({ onReveal } = {}) {
    this.onReveal = onReveal ?? (() => {});
    this.reduceMotion = prefersReducedMotion();

    this.el = document.getElementById('boot');
    this.orbit = document.getElementById('boot-orbit');
    this.canvas = document.getElementById('boot-canvas');
    this.logo = document.getElementById('boot-logo');
    this.flashEl = document.getElementById('boot-flash');
    this.percentEl = document.getElementById('boot-percent');
    this.trackEl = document.getElementById('boot-track');
    this.fillEl = document.getElementById('boot-fill');
    this.statusEl = document.getElementById('boot-status');
    this.skipBtn = document.getElementById('boot-skip');
    this.soundBtn = document.getElementById('boot-sound');
    this.soundLabel = document.getElementById('boot-sound-label');
    this.desktop = document.getElementById('desktop');

    this.moon = this.canvas ? new MoonProgress(this.canvas) : null;

    this.state = 'idle'; // idle | running | completing | revealing | done
    this._revealTimer = null;
    this.startTime = 0;
    this.rafId = null;
    this.lastPercent = -1;
    this.lastStep = -1;
    this.assetsReady = false;
    this.waitingForGesture = false;
    this._gestureResolve = null;
    this._timings = {
      load: this.reduceMotion ? 1500 : 3400,
      settle: this.reduceMotion ? 320 : 1900,
      fade: this.reduceMotion ? 260 : 900,
    };

    this._tick = this._tick.bind(this);
    this._bind();
  }

  // --------------------------------------------------------------- ciclo ----

  async start() {
    if (!this.el) return;
    clearTimeout(this._revealTimer);
    this._revealTimer = null;
    this.state = 'running';
    this.assetsReady = false;
    this.startTime = performance.now();
    this.lastPercent = -1;
    this.lastStep = -1;

    this.el.classList.remove(
      'is-leaving',
      'is-gone',
      'is-complete',
      'is-awaiting-gesture'
    );
    this.el.classList.add('is-entered');
    this.el.removeAttribute('aria-hidden');
    this.el.inert = false;
    document.body.classList.add('is-booting');

    this.flashEl?.classList.remove('is-firing');
    this._releaseGestureWait();

    this.desktop?.classList.remove('is-visible');
    this.desktop?.setAttribute('aria-hidden', 'true');

    this.fillEl.style.width = '0%';
    this.trackEl.setAttribute('aria-valuenow', '0');
    this.setPercentText(0);
    this.setStatus(STEPS[0].label);

    this.moon?.setProgress(0, { immediate: true });
    this.moon?.start();

    // O progresso nunca passa de 88% antes dos recursos estarem prontos.
    this._waitForAssets();

    this.rafId = requestAnimationFrame(this._tick);
  }

  _bind() {
    this.skipBtn?.addEventListener('click', () => this.skip());

    this.soundBtn?.addEventListener('click', async () => {
      const running = await audio.unlock();
      if (!running) return;
      // Se o áudio ainda estava bloqueado, o clique serve para LIGAR o som.
      const wasPending = this.soundBtn?.dataset.state === 'pending';
      audio.setEnabled(wasPending ? true : !audio.enabled);
      if (audio.enabled) audio.playUiTick({ frequency: 1320, peak: 0.05 });
      this._syncSoundButton();
      this._releaseGestureWait();
    });

    // Qualquer gesto na tela de boot destrava o áudio (política dos navegadores).
    const unlockOnGesture = async () => {
      const wasBlocked = audio.state !== 'running';
      await audio.unlock();
      this._syncSoundButton();
      if (wasBlocked && audio.state === 'running') this._releaseGestureWait();
    };
    this.el?.addEventListener('pointerdown', unlockOnGesture);
    window.addEventListener('keydown', unlockOnGesture, { once: true });

    // Pausa o loop do canvas quando a aba fica oculta (economia real de bateria).
    document.addEventListener('visibilitychange', () => {
      if (this.state !== 'running' && this.state !== 'completing') return;
      if (document.hidden) {
        this.moon?.stop();
      } else {
        this.moon?.start();
      }
    });

    audio.armUnlockOnFirstGesture();
    this._syncSoundButton();
  }

  /** Espera fonte, logo e um frame — para o 100% ser verdadeiro. */
  async _waitForAssets() {
    const jobs = [];

    if (document.fonts?.ready) {
      jobs.push(
        Promise.race([
          document.fonts.ready,
          wait(2600),
        ]).catch(() => {})
      );
    }

    jobs.push(
      Promise.race([
        document.fonts?.load?.('600 16px "Plus Jakarta Sans"').catch(() => {}),
        wait(2000),
      ])
    );

    if (this.logo) {
      jobs.push(
        new Promise((resolve) => {
          if (this.logo.complete && this.logo.naturalWidth > 0) return resolve();
          this.logo.addEventListener('load', () => resolve(), { once: true });
          this.logo.addEventListener('error', () => resolve(), { once: true });
          setTimeout(resolve, 2600);
        })
      );
    }

    jobs.push(new Promise((resolve) => requestAnimationFrame(() => resolve())));

    await Promise.all(jobs);
    this.assetsReady = true;
  }

  _tick(now) {
    if (this.state !== 'running') return;

    const elapsed = now - this.startTime;
    const t = clamp(elapsed / this._timings.load, 0, 1);
    const curve = sampleCurve(t);

    // Trava em 88% até os recursos estarem prontos.
    const capped = this.assetsReady ? curve : Math.min(curve, 0.88);
    const progress = clamp(capped, 0, 1);

    this.moon?.setProgress(progress);

    const percent = Math.round(progress * 100);
    if (percent !== this.lastPercent) {
      this.lastPercent = percent;
      this.setPercentText(percent);
      this.fillEl.style.width = `${progress * 100}%`;
      this.trackEl.setAttribute('aria-valuenow', String(percent));
    }

    const step = this._stepFor(progress);
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.setStatus(STEPS[step].label);
    }

    if (t >= 1 && this.assetsReady) {
      this.rafId = null;
      this._complete();
      return;
    }

    this.rafId = requestAnimationFrame(this._tick);
  }

  _stepFor(progress) {
    let index = 0;
    for (let i = 0; i < STEPS.length; i += 1) {
      if (progress >= STEPS[i].at) index = i;
    }
    return index;
  }

  // ---------------------------------------------------------- conclusão -----

  async _complete() {
    if (this.state !== 'running') return;
    this.state = 'completing';

    this.el.classList.add('is-complete');
    this.moon?.setProgress(1);
    this.moon?.pulse(1);
    this.flashEl?.classList.add('is-firing');
    this.fillEl.style.width = '100%';
    this.trackEl.setAttribute('aria-valuenow', '100');
    this.setPercentText(100);
    this.setStatus('Sistema pronto');

    await this._playBootSound();
    if (this.state !== 'completing') return; // pode ter sido pulado/reiniciado

    await wait(this.reduceMotion ? 120 : 260);
    this._reveal();
  }

  /**
   * Toca o acorde de boot. Se o navegador ainda estiver bloqueando áudio
   * (nenhum gesto do usuário), aguarda um gesto por até ~4s — assim o
   * usuário não perde a assinatura sonora sem entender o motivo.
   */
  async _playBootSound() {
    if (!audio.enabled) return;

    const unlocked = await audio.unlock();
    if (this.state !== 'completing') return;

    if (unlocked) {
      const played = await audio.playBootSequence();
      if (this.state !== 'completing') return;
      if (played) {
        this.setStatus('Reproduzindo assinatura sonora');
        await wait(this.reduceMotion ? 600 : this._timings.settle);
        return;
      }
    }

    // Bloqueado: oferece o gesto e segue em frente de qualquer forma.
    this.waitingForGesture = true;
    this.setStatus('Toque na tela para ouvir o som de boot');
    this.el.classList.add('is-awaiting-gesture');

    const gesture = await this._waitForGesture(this.reduceMotion ? 1200 : 4200);
    this.waitingForGesture = false;
    this.el.classList.remove('is-awaiting-gesture');
    if (this.state !== 'completing') return;

    if (gesture && audio.enabled) {
      const played = await audio.playBootSequence();
      if (this.state !== 'completing') return;
      if (played) {
        this.setStatus('Reproduzindo assinatura sonora');
        await wait(this.reduceMotion ? 600 : this._timings.settle);
        return;
      }
    }

    await wait(this.reduceMotion ? 200 : 700);
  }

  _waitForGesture(timeout) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        clearTimeout(timer);
        this._gestureResolve = null;
        resolve(value);
      };
      const onGesture = () => {
        // Deixa o unlock() assíncrono terminar antes de responder.
        setTimeout(() => finish(true), 60);
      };
      const timer = setTimeout(() => finish(false), timeout);

      this._gestureResolve = finish;
      window.addEventListener('pointerdown', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
    });
  }

  _releaseGestureWait() {
    this._gestureResolve?.(true);
  }

  // ------------------------------------------------------------- revelar ----

  _reveal() {
    this.state = 'revealing';
    this.moon?.stop();
    this.setStatus('Sistema pronto');

    this.el.classList.add('is-leaving');
    this.desktop?.classList.add('is-visible');
    this.desktop?.removeAttribute('aria-hidden');

    const finish = () => {
      if (this.state !== 'revealing') return;
      this.el.classList.add('is-gone');
      this.el.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('is-booting');
      this.state = 'done';
      this.onReveal();
      document.title = 'Lunar OS — Área de trabalho';
      this.desktop?.focus?.({ preventScroll: true });
    };

    if (this.reduceMotion) {
      finish();
      return;
    }
    this._revealTimer = setTimeout(finish, this._timings.fade);
  }

  /** Pula direto para o fim do carregamento (não pula o som, se possível). */
  skip() {
    // Já revelado: nada a fazer.
    if (this.state === 'done' || this.state === 'revealing') return;

    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.assetsReady = true;

    if (this.state === 'running') {
      this.startTime = performance.now() - this._timings.load;
      this.moon?.setProgress(1, { immediate: true });
      this.setPercentText(100);
      this.setStatus('Sistema pronto');
      this._complete();
      return;
    }

    // Estava tocando o som ou esperando um gesto: revela imediatamente.
    if (this.state === 'completing') {
      this._releaseGestureWait();
      this._reveal();
    }
  }

  destroy() {
    clearTimeout(this._revealTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.moon?.destroy();
  }

  // -------------------------------------------------------------- helpers ---

  setPercentText(value) {
    if (!this.percentEl) return;
    this.percentEl.innerHTML = `${value}<span class="boot__percent-sign">%</span>`;
  }

  setStatus(text) {
    if (!this.statusEl || this.statusEl.textContent === text) return;
    this.statusEl.textContent = text;
  }

  _syncSoundButton() {
    if (!this.soundBtn) return;
    const state =
      !audio.supported || !audio.enabled
        ? 'off'
        : audio.state === 'running'
          ? 'on'
          : 'pending';

    this.soundBtn.dataset.state = state;
    const labels = {
      on: 'Som: ativado',
      off: 'Som: desativado',
      pending: 'Som: aguardando gesto',
    };
    if (this.soundLabel) this.soundLabel.textContent = labels[state];
    this.soundBtn.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
  }
}
