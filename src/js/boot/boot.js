/**
 * Lunar OS — FASE 1
 * Controlador da tela de boot.
 *
 * Responsabilidades:
 *   • manter as bolinhas girando enquanto o sistema carrega;
 *   • só terminar quando os recursos críticos estiverem prontos
 *     (fonte + ícone), sem encerrar por tempo e revelar tela quebrada;
 *   • disparar o som de boot sintetizado no fim;
 *   • fechar o anel de bolinhas e fazer o fade-out revelando a área de trabalho.
 *
 * O progresso continua existindo internamente (0 → 1) para alimentar os
 * estados de texto, mas não há mais barra, percentual nem lua desenhada.
 */

import { SpinnerDots } from './spinner-dots.js';
import { audio } from '../core/audio.js';
import { clamp, prefersReducedMotion, smoothstep } from '../core/ease.js';

/**
 * Curva de carga em função do tempo normalizado.
 * Os trechos quase planos imitam as pausas de I/O de um boot real; como agora
 * não existe barra, ela serve apenas para trocar a mensagem de status.
 */
const CURVE = [
  { t: 0.0, v: 0.0 },
  { t: 0.1, v: 0.12 },
  { t: 0.26, v: 0.3 },
  { t: 0.36, v: 0.33 },
  { t: 0.52, v: 0.55 },
  { t: 0.63, v: 0.58 },
  { t: 0.8, v: 0.8 },
  { t: 0.9, v: 0.84 },
  { t: 1.0, v: 1.0 },
];

const STEPS = [
  { at: 0.0, label: 'Iniciando' },
  { at: 0.2, label: 'Carregando recursos' },
  { at: 0.5, label: 'Preparando a área de trabalho' },
  { at: 0.82, label: 'Quase lá' },
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
    this.logo = document.getElementById('boot-logo');
    this.spinnerCanvas = document.getElementById('boot-spinner');
    this.statusEl = document.getElementById('boot-status');
    this.skipBtn = document.getElementById('boot-skip');
    this.soundBtn = document.getElementById('boot-sound');
    this.soundLabel = document.getElementById('boot-sound-label');
    this.desktop = document.getElementById('desktop');

    this.spinner = this.spinnerCanvas ? new SpinnerDots(this.spinnerCanvas) : null;

    this.state = 'idle'; // idle | running | completing | revealing | done
    this._revealTimer = null;
    this.startTime = 0;
    this.progress = 0;
    this._progressRaf = null;
    this.lastStep = -1;
    this.assetsReady = false;
    this.waitingForGesture = false;
    this._gestureResolve = null;
    this._timings = {
      load: this.reduceMotion ? 1500 : 3200,
      settle: this.reduceMotion ? 320 : 1900,
      fade: this.reduceMotion ? 260 : 900,
    };

    this._updateProgress = this._updateProgress.bind(this);
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
    this.progress = 0;
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

    this._releaseGestureWait();

    this.desktop?.classList.remove('is-visible');
    this.desktop?.setAttribute('aria-hidden', 'true');

    this.setStatus(STEPS[0].label);
    this.spinner?.reset();
    this.spinner?.start();

    // O texto de status só avança quando os recursos estiverem prontos.
    this._waitForAssets();
    this._progressRaf = requestAnimationFrame(this._updateProgress);
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

    // Pausa a animação quando a aba fica oculta (economia real de bateria).
    document.addEventListener('visibilitychange', () => {
      if (this.state !== 'running' && this.state !== 'completing') return;
      if (document.hidden) {
        this.spinner?.stop();
      } else {
        this.spinner?.start();
      }
    });

    audio.armUnlockOnFirstGesture();
    this._syncSoundButton();
  }

  /** Espera fonte, ícone e um frame — para encerrar só quando estiver tudo lá. */
  async _waitForAssets() {
    const jobs = [];

    if (document.fonts?.ready) {
      jobs.push(Promise.race([document.fonts.ready, wait(2600)]).catch(() => {}));
    }

    jobs.push(
      Promise.race([
        document.fonts?.load?.('500 16px "Plus Jakarta Sans"').catch(() => {}),
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

  /** Mantém a curva interna de carga e troca a mensagem de status. */
  _updateProgress(now) {
    if (this.state !== 'running') return;

    const elapsed = now - this.startTime;
    const t = clamp(elapsed / this._timings.load, 0, 1);
    const curve = sampleCurve(t);
    this.progress = this.assetsReady ? curve : Math.min(curve, 0.88);

    const step = this._stepFor(this.progress);
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.setStatus(STEPS[step].label);
    }

    if (t >= 1 && this.assetsReady) {
      this._progressRaf = null;
      this._complete();
      return;
    }

    this._progressRaf = requestAnimationFrame(this._updateProgress);
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
    this.setStatus('Pronto');
    // Fecha o anel de bolinhas e desacelera até parar.
    this.spinner?.complete();

    await this._playBootSound();
    if (this.state !== 'completing') return; // pode ter sido pulado/reiniciado

    await wait(this.reduceMotion ? 120 : 320);
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
    this.setStatus('Pronto');

    this.el.classList.add('is-leaving');
    this.desktop?.classList.add('is-visible');
    this.desktop?.removeAttribute('aria-hidden');

    const finish = () => {
      if (this.state !== 'revealing') return;
      this.el.classList.add('is-gone');
      this.el.setAttribute('aria-hidden', 'true');
      this.spinner?.stop();
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

    if (this._progressRaf) cancelAnimationFrame(this._progressRaf);
    this._progressRaf = null;
    this.assetsReady = true;

    if (this.state === 'running') {
      this.progress = 1;
      this.startTime = performance.now() - this._timings.load;
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
    if (this._progressRaf) cancelAnimationFrame(this._progressRaf);
    this.spinner?.destroy();
  }

  // -------------------------------------------------------------- helpers ---

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
