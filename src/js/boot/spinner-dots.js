/**
 * Lunar OS — FASE 1
 * Indicador de carregamento em forma de bolinhas girando (estilo Windows).
 *
 * Desenhado proceduralmente na Canvas API — nenhuma imagem, nenhum SVG:
 *   • um anel de pontos que gira em torno de um eixo levemente inclinado
 *     (elipse achatada), o que dá a sensação de profundidade de um globo;
 *   • cada ponto passa por um ciclo cabeça → cauda: a bolinha da frente é
 *     maior e mais clara, as de trás diminuem e escurecem;
 *   • os que ficam na parte de trás do ciclo desaceleram (perspectiva), então
 *     a velocidade aparente "respira" em vez de ser um giro uniforme;
 *   • encerramento: os pontos fecham em círculo, acendem e somem juntos.
 *
 * Custo por frame: 8 arcos. Nada de blur, sombra ou gradiente por ponto.
 */

import { clamp, easeInOutCubic, easeOutCubic, prefersReducedMotion } from '../core/ease.js';

const TAU = Math.PI * 2;

const DEFAULTS = {
  count: 8,
  // Tempo (ms) para o anel dar uma volta completa quando NÃO está saindo.
  spin: 1450,
  // Inclinação do plano do anel: 1 = círculo perfeito, <1 = elipse achatada.
  tilt: 0.62,
  // Raio do anel em fração do menor lado do canvas.
  radius: 0.34,
  color: '255, 255, 255',
};

export class SpinnerDots {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.options = { ...DEFAULTS, ...options };

    this.reduceMotion = prefersReducedMotion();

    // 'idle' → 'spinning' → 'completing' → 'done'
    this.state = 'idle';
    this.angle = 0;
    this.completeProgress = 0;

    this.size = 0;
    this.dpr = 1;
    this.rafId = null;
    this.running = false;
    this.lastTime = 0;

    this._resize = this._resize.bind(this);
    this._render = this._render.bind(this);

    this._resizeObserver = new ResizeObserver(this._resize);
    this._resizeObserver.observe(canvas);
    this._resize();
  }

  // ------------------------------------------------------------ API pública --

  start() {
    if (this.state === 'idle' || this.state === 'done') {
      this.state = 'spinning';
      this.completeProgress = 0;
    }
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this._render);
  }

  /** Fecha o anel, acende tudo e dissolve — o "fim do carregamento". */
  complete() {
    if (this.state === 'completing') return;
    this.state = 'completing';
    this.completeProgress = 0;
    if (!this.running) this.start();
  }

  reset() {
    this.state = 'idle';
    this.angle = 0;
    this.completeProgress = 0;
    this._draw();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy() {
    this.stop();
    this._resizeObserver?.disconnect();
  }

  // ---------------------------------------------------------------- medição --

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return;

    // Redimensiona no menor lado, mas o canvas mantém a proporção real.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.width = width;
    this.height = height;
    this.dpr = dpr;

    if (!this.running) this._draw();
  }

  // --------------------------------------------------------------- desenho --

  _render(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Avanço angular: mais rápido no fim (o sistema está "fechando" o ciclo).
    if (this.state === 'spinning') {
      const speed = this.reduceMotion ? 0.55 : 1;
      this.angle += (dt / (this.options.spin / 1000)) * TAU * speed;
    } else if (this.state === 'completing') {
      this.completeProgress = clamp(this.completeProgress + dt * 3.1, 0, 1);
      // Desacelera até parar enquanto o anel fecha.
      this.angle += (dt / (this.options.spin / 1000)) * TAU * (1 - easeOutCubic(this.completeProgress)) * 0.9;
      if (this.completeProgress >= 1) this.state = 'done';
    }

    this._draw();

    if (this.state === 'done') {
      // Último frame do fade já foi pintado; o loop pode parar.
      this.stop();
      return;
    }
    this.rafId = requestAnimationFrame(this._render);
  }

  _draw() {
    const { ctx } = this;
    if (!ctx || !this.width) return;

    const { count, tilt, radius, color } = this.options;
    const dpr = this.dpr;
    const w = this.width;
    const h = this.height;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const ringRadius = Math.min(w, h) * radius;
    const baseDot = Math.max(2, Math.min(w, h) * 0.086);

    // Fechamento: no fim do carregamento o anel desacelera, os pontos se
    // aproximam do círculo e a opacidade final dissolve tudo junto.
    const complete = this.state === 'completing' || this.state === 'done'
      ? easeInOutCubic(clamp(this.completeProgress, 0, 1))
      : 0;
    const exitFade = complete > 0.8 ? 1 - (complete - 0.8) / 0.2 : 1;
    const flat = tilt + (1 - tilt) * complete; // vira círculo ao completar

    ctx.save();
    ctx.translate(cx, cy);

    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const phase = this.angle + t * TAU;

      // Posição no anel inclinado.
      const x = Math.cos(phase) * ringRadius;
      const y = Math.sin(phase) * ringRadius * flat;

      // Profundidade: sin(phase) > 0 = metade da frente (perto do observador).
      const depth = (Math.sin(phase) + 1) / 2; // 0 = fundo, 1 = frente

      // Cabeça → cauda: o ponto 0 é o "líder" (maior e mais claro).
      const head = 1 - t;
      const scale = (0.5 + 0.5 * head) * (0.74 + 0.36 * depth) + complete * 0.14;
      const alpha = (0.26 + 0.74 * Math.pow(head, 1.7)) * (0.58 + 0.42 * depth) * exitFade;

      if (alpha <= 0.004) continue;

      const r = baseDot * scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = `rgba(${color}, ${(alpha * 0.94).toFixed(3)})`;
      ctx.fill();
    }

    // Brilho central muito discreto durante o fechamento (não durante o giro).
    if (complete > 0.25) {
      const glowAlpha = 0.1 * ((complete - 0.25) / 0.75) * exitFade;
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, ringRadius * 1.5);
      glow.addColorStop(0, `rgba(190, 200, 255, ${glowAlpha.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(190, 200, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius * 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}
