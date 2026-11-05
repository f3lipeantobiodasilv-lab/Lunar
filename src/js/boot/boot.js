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

// Rede de segurança: se algo travar (aba em segundo plano, timer suspenso),
// o boot nunca fica preso — revela o desktop assim que possível.
const MAX_BOOT_TIME = 15000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Corrida com prazo. Uma Promise que não resolve (áudio bloqueado pelo
 * autoplay, decodificador travado, fonte que nunca chega) não pode segurar o
 * boot: passado o prazo, seguimos em frente de qualquer forma.
 */
const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, wait(ms).then(() => fallback)]);

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
    this.dots = document.getElementById('boot-dots');
    this.statusEl = document.getElementById('boot-status');
    this.skipBtn = document.getElementById('boot-skip');
    this.soundBtn = document.getElementById('boot-sound');
    this.soundLabel = document.getElementById('boot-sound-label');
    this.desktop = document.getElementById('desktop');

    this.state = 'idle'; // idle | running | completing | revealing | done
    this._revealTimer = null;
    this._watchdog = null;
    this._completeGuard = null;
    this.startTime = 0;
    this.progress = 0;
    this._progressTimer = null;
    this.lastStep = -1;
    this.assetsReady = false;
    this.waitingForGesture = false;
    this._gestureResolve = null;
    this._timings = {
      load: this.reduceMotion ? 1200 : 2200,
      settle: this.reduceMotion ? 300 : 1200,
      fade: this.reduceMotion ? 260 : 900,
    };

    this._scheduleProgress = this._scheduleProgress.bind(this);
    this._bind();
  }

  // --------------------------------------------------------------- ciclo ----

  async start() {
    if (!this.el) return;
    clearTimeout(this._revealTimer);
    clearTimeout(this._completeGuard);
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
    this._setDotsPaused(false);

    // Watchdog: independente do que aconteça, o boot não passa de MAX_BOOT_TIME.
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (this.state === 'running') this.skip();
    }, MAX_BOOT_TIME);

    // O texto de status só avança quando os recursos estiverem prontos.
    this._waitForAssets();
    this._scheduleProgress();
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
      this._setDotsPaused(document.hidden);
      if (!document.hidden) this._resyncProgress();
    });

    // Alguns embeds só "acordam" quando ganham foco; realinha ao voltar.
    window.addEventListener('focus', () => this._resyncProgress());

    audio.armUnlockOnFirstGesture();
    this._syncSoundButton();

    // Mantém o rótulo do botão coerente: o contexto pode destravar em um gesto
    // fora da tela de boot ou por política de autoplay do navegador.
    audio.ctx?.addEventListener?.('statechange', () => this._syncSoundButton());
  }

  /**
   * Espera fonte, ícone e layout. Usa apenas Promises e setTimeout — nada de
   * requestAnimationFrame, que pode nunca disparar (iframe oculto, aba em
   * segundo plano, throttling agressivo) e travaria o boot em 0%.
   */
  async _waitForAssets() {
    const jobs = [];

    if (document.fonts?.ready) {
      jobs.push(Promise.race([document.fonts.ready, wait(1800)]).catch(() => {}));
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
          setTimeout(resolve, 1800);
        })
      );
    }

    // Um tick é suficiente: o layout já foi calculado no parse do HTML.
    jobs.push(wait(0));

    await Promise.all(jobs);
    this.assetsReady = true;
  }

  /**
   * Curva de carga dirigida por TEMPO (setTimeout), não por frames.
   * requestAnimationFrame pausa em abas ocultas e em iframes não visíveis,
   * o que deixava o boot parado em "Iniciando" até o usuário clicar em Pular.
   */
  _scheduleProgress() {
    clearTimeout(this._progressTimer);
    if (this.state !== 'running') return;

    const elapsed = performance.now() - this.startTime;
    const t = clamp(elapsed / this._timings.load, 0, 1);
    const curve = sampleCurve(t);

    // Segura em 88% até os recursos estarem prontos: nunca "mente" no fim.
    this.progress = this.assetsReady ? curve : Math.min(curve, 0.88);

    const step = this._stepFor(this.progress);
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.setStatus(STEPS[step].label);
    }

    if (t >= 1 && this.assetsReady) {
      this._complete();
      return;
    }

    this._progressTimer = setTimeout(() => this._scheduleProgress(), 90);
  }

  /** Se o usuário voltar para a aba, realinha o progresso imediatamente. */
  _resyncProgress() {
    if (this.state !== 'running') return;
    this._scheduleProgress();
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
    clearTimeout(this._watchdog);
    this.state = 'completing';

    this.el.classList.add('is-complete');
    this.setStatus('Pronto');
    // Acende o anel inteiro; a dissolução acompanha o fade-out (.is-leaving).
    this._setDotsPaused(true);

    // Rede de segurança final: por melhor que seja o tratamento de áudio, uma
    // etapa que não resolva não pode impedir a tela de sair do boot. Este
    // temporizador revela o desktop de qualquer forma.
    clearTimeout(this._completeGuard);
    this._completeGuard = setTimeout(() => {
      if (this.state === 'completing') this._reveal();
    }, this.reduceMotion ? 1400 : 5500);

    await withTimeout(this._playBootSound(), this.reduceMotion ? 900 : 4500);
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
        this._syncSoundButton();
        this.setStatus('Reproduzindo assinatura sonora');
        await wait(this.reduceMotion ? 600 : this._timings.settle);
        return;
      }
    }

    // Bloqueado: oferece o gesto e segue em frente de qualquer forma.
    this.waitingForGesture = true;
    this.setStatus('Toque na tela para ouvir o som de boot');
    this.el.classList.add('is-awaiting-gesture');

    const gesture = await this._waitForGesture(this.reduceMotion ? 800 : 1600);
    this.waitingForGesture = false;
    this.el.classList.remove('is-awaiting-gesture');
    if (this.state !== 'completing') return;

    if (gesture && audio.enabled) {
      const played = await audio.playBootSequence();
      if (this.state !== 'completing') return;
      if (played) {
        this._syncSoundButton();
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
    if (this.state !== 'completing') return;
    clearTimeout(this._completeGuard);
    this.state = 'revealing';
    this.setStatus('Pronto');

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

    clearTimeout(this._progressTimer);
    clearTimeout(this._watchdog);
    this._progressTimer = null;
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
    clearTimeout(this._progressTimer);
    clearTimeout(this._watchdog);
    clearTimeout(this._completeGuard);
  }

  /** Congela/retoma a animação das bolinhas (aba oculta ou fim do boot). */
  _setDotsPaused(paused) {
    if (!this.dots) return;
    this.dots.style.animationPlayState = paused ? 'paused' : '';
    for (const dot of this.dots.children) {
      dot.style.animationPlayState = paused ? 'paused' : '';
    }
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

    // Em telas estreitas o rótulo completo quebra em três linhas; usamos uma
    // versão curta e mantemos o texto completo em aria-label/title.
    const compact = window.matchMedia('(max-width: 560px)').matches;
    const full = {
      on: 'Som: ativado',
      off: 'Som: desativado',
      pending: 'Som: aguardando gesto',
    };
    const short = { on: 'Som', off: 'Som', pending: 'Som' };

    if (this.soundLabel) {
      this.soundLabel.textContent = compact ? short[state] : full[state];
    }
    this.soundBtn.setAttribute('aria-label', full[state]);
    this.soundBtn.setAttribute('title', full[state]);
    this.soundBtn.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
  }
}
