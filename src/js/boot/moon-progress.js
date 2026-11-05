/**
 * Lunar OS — FASE 1
 * Indicador de progresso "Lua Cheia se completando".
 *
 * Tudo é desenhado proceduralmente na Canvas API (nenhuma imagem envolvida):
 *   • disco lunar com mares e crateras gerados por PRNG determinístico;
 *   • a luz "acende" do centro para as bordas conforme o progresso;
 *   • anel de progresso com marcas orbitais;
 *   • halo/respiração que reage ao valor atual.
 *
 * Para manter 60fps, o disco iluminado é rasterizado num canvas offscreen
 * sempre que o tamanho muda; o laço de animação só faz drawImage + arcos.
 */

import {
  clamp,
  easeInOutCubic,
  easeOutCubic,
  easeInOutSine,
  prefersReducedMotion,
  seededRandom,
} from '../core/ease.js';

const TAU = Math.PI * 2;

export class MoonProgress {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.options = {
      ticks: 72,
      craters: 26,
      ...options,
    };

    this.progress = 0;      // alvo (0..1)
    this.displayed = 0;     // valor suavizado usado no desenho
    this.reveal = 0;        // 0..1 quanto da lua está "acesa"
    this.flare = 0;         // 0..1 clarão de conclusão
    this.haloBoost = 0;

    this.size = 0;
    this.dpr = 1;
    this.ringRadius = 0;
    this.moonRadius = 0;

    this.reduceMotion = prefersReducedMotion();
    this.rafId = null;
    this.lastTime = 0;
    this.running = false;

    this.moonSprite = null;
    this._craters = [];
    this._maria = [];
    this._ticks = [];

    this._generateMarkings();
    this._observeResize();
    this._render = this._render.bind(this);
  }

  // ------------------------------------------------------------ API pública --

  setProgress(value, { immediate = false } = {}) {
    const next = clamp(value, 0, 1);
    if (immediate || this.reduceMotion) {
      this.progress = next;
      this.displayed = next;
      this.reveal = this._revealFor(next);
      return;
    }
    this.progress = next;
  }

  /** Clarão curto no anel + halo quando o carregamento termina. */
  pulse(strength = 1) {
    if (this.reduceMotion) {
      this.flare = 0.0001;
      return;
    }
    this.flare = strength;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this._render);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy() {
    this.stop();
    this._resizeObserver?.disconnect();
    this.moonSprite = null;
  }

  // ------------------------------------------------------------- geração ---

  _generateMarkings() {
    const rand = seededRandom(20260311);

    // Crateras: amostragem com rejeição para não sobrepor demais.
    const craters = [];
    let guard = 0;
    while (craters.length < this.options.craters && guard < 800) {
      guard += 1;
      const angle = rand() * TAU;
      const dist = Math.sqrt(rand()) * 0.93;
      const radius = 0.022 + rand() * rand() * 0.085;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;

      if (dist + radius > 1) continue;
      const overlap = craters.some(
        (c) => Math.hypot(c.x - x, c.y - y) < (c.r + radius) * 0.72
      );
      if (overlap) continue;

      craters.push({ x, y, r: radius, tone: 0.5 + rand() * 0.5 });
    }
    this._craters = craters;

    // Mares (manchas largas e escuras) — dão a leitura de "Lua".
    const maria = [];
    for (let i = 0; i < 5; i += 1) {
      const angle = rand() * TAU;
      const dist = 0.15 + rand() * 0.62;
      maria.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        r: 0.2 + rand() * 0.26,
        alpha: 0.13 + rand() * 0.12,
      });
    }
    this._maria = maria;

    // Marcas orbitais ao redor do anel.
    this._ticks = Array.from({ length: this.options.ticks }, (_, i) => ({
      angle: (i / this.options.ticks) * TAU - Math.PI / 2,
      major: i % Math.round(this.options.ticks / 12) === 0,
    }));
  }

  _revealFor(progress) {
    // A lua "acende" um pouco antes do fim; o restante do progresso é o anel.
    return easeInOutCubic(clamp(progress / 0.94, 0, 1));
  }

  // -------------------------------------------------------------- medição ---

  _observeResize() {
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas);
    this._resize();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.round(Math.min(rect.width, rect.height));
    if (!size) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size === this.size && dpr === this.dpr) return;

    this.size = size;
    this.dpr = dpr;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);

    this.ringRadius = size * 0.455;
    this.moonRadius = this.ringRadius - Math.max(15, size * 0.052);

    this._buildMoonSprite();
    if (!this.running) this._draw();
  }

  // ------------------------------------------------------------ sprite ------

  /**
   * Rasteriza a lua iluminada uma única vez por tamanho.
   * Depois disso, o frame só copia o bitmap com clip.
   */
  _buildMoonSprite() {
    const R = this.moonRadius;
    if (R <= 0) return;

    const pad = 10;
    const dim = Math.ceil((R + pad) * 2);
    const dpr = this.dpr;
    const sprite = document.createElement('canvas');
    sprite.width = Math.round(dim * dpr);
    sprite.height = Math.round(dim * dpr);

    const c = sprite.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(dim / 2, dim / 2);

    // --- corpo lunar ---------------------------------------------------------
    c.save();
    c.beginPath();
    c.arc(0, 0, R, 0, TAU);
    c.clip();

    const base = c.createRadialGradient(-R * 0.34, -R * 0.42, R * 0.08, 0, 0, R * 1.12);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(0.3, '#f2f4fa');
    base.addColorStop(0.62, '#d8dce8');
    base.addColorStop(0.86, '#b9bfd0');
    base.addColorStop(1, '#8d93a7');
    c.fillStyle = base;
    c.fillRect(-R, -R, R * 2, R * 2);

    // Mares: manchas amplas e difusas.
    this._maria.forEach((m) => {
      const gx = m.x * R;
      const gy = m.y * R;
      const gr = m.r * R;
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(104, 110, 133, ${m.alpha})`);
      g.addColorStop(0.55, `rgba(104, 110, 133, ${m.alpha * 0.55})`);
      g.addColorStop(1, 'rgba(104, 110, 133, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(gx, gy, gr, 0, TAU);
      c.fill();
    });

    // Crateras: depressões côncavas. A luz vem do canto superior esquerdo, então
    // a parede interna voltada para a luz (canto superior esquerdo) fica em
    // sombra e a parede oposta recebe luz — o aro elevado é claro na borda
    // superior esquerda e projeta sombra no lado inferior direito.
    this._craters.forEach((crt) => {
      const cx = crt.x * R;
      const cy = crt.y * R;
      const cr = crt.r * R;
      const tone = crt.tone;

      // 1. interior da bacia: escuro do lado da luz, mais claro do lado oposto
      const bowl = c.createRadialGradient(
        cx - cr * 0.4,
        cy - cr * 0.4,
        cr * 0.08,
        cx + cr * 0.12,
        cy + cr * 0.12,
        cr
      );
      bowl.addColorStop(0, `rgba(74, 78, 96, ${0.3 * tone})`);
      bowl.addColorStop(0.45, `rgba(108, 113, 133, ${0.16 * tone})`);
      bowl.addColorStop(0.82, `rgba(190, 196, 214, ${0.1 * tone})`);
      bowl.addColorStop(1, `rgba(255, 255, 255, 0)`);
      c.fillStyle = bowl;
      c.beginPath();
      c.arc(cx, cy, cr * 1.02, 0, TAU);
      c.fill();

      // 2. aro iluminado (borda superior esquerda, virada para a luz)
      c.beginPath();
      c.arc(cx, cy, cr * 0.94, Math.PI * 0.86, Math.PI * 1.92);
      c.strokeStyle = `rgba(255, 255, 255, ${0.3 * tone})`;
      c.lineWidth = Math.max(0.5, cr * 0.11);
      c.stroke();

      // 3. aro em sombra (borda inferior direita)
      c.beginPath();
      c.arc(cx, cy, cr * 0.94, Math.PI * -0.06, Math.PI * 0.84);
      c.strokeStyle = `rgba(64, 68, 84, ${0.22 * tone})`;
      c.lineWidth = Math.max(0.5, cr * 0.1);
      c.stroke();

      // 4. pontos maiores ganham um núcleo de sombra mais denso
      if (cr > R * 0.055) {
        const core = c.createRadialGradient(
          cx - cr * 0.18,
          cy - cr * 0.18,
          0,
          cx - cr * 0.05,
          cy - cr * 0.05,
          cr * 0.55
        );
        core.addColorStop(0, `rgba(58, 62, 78, ${0.24 * tone})`);
        core.addColorStop(1, 'rgba(58, 62, 78, 0)');
        c.fillStyle = core;
        c.beginPath();
        c.arc(cx, cy, cr * 0.55, 0, TAU);
        c.fill();
      }
    });

    // Volume esférico: sombra no quadrante oposto à luz.
    const shade = c.createRadialGradient(R * 0.42, R * 0.5, R * 0.12, 0, 0, R * 1.02);
    shade.addColorStop(0, 'rgba(9, 9, 14, 0)');
    shade.addColorStop(0.58, 'rgba(9, 9, 14, 0.2)');
    shade.addColorStop(0.86, 'rgba(7, 7, 12, 0.44)');
    shade.addColorStop(1, 'rgba(5, 5, 9, 0.72)');
    c.fillStyle = shade;
    c.fillRect(-R, -R, R * 2, R * 2);

    c.restore();

    // --- luz de borda (rim light) -------------------------------------------
    const rim = c.createLinearGradient(-R, -R, R, R);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    rim.addColorStop(0.45, 'rgba(198, 206, 255, 0.35)');
    rim.addColorStop(1, 'rgba(139, 149, 255, 0.12)');
    c.beginPath();
    c.arc(0, 0, R - 0.75, 0, TAU);
    c.strokeStyle = rim;
    c.lineWidth = 1.4;
    c.stroke();

    this.moonSprite = { canvas: sprite, dim, R };

    // Buffer usado para aplicar a máscara de "lua se completando" com borda
    // suave (destination-in + gradiente radial). Sem ele, o clip circular
    // criaria um degrau duro, com cara de holofote.
    const buffer = document.createElement('canvas');
    buffer.width = sprite.width;
    buffer.height = sprite.height;
    this.revealBuffer = { canvas: buffer, ctx: buffer.getContext('2d') };
  }

  /**
   * Desenha a lua iluminada até `revealRadius` (px CSS), com a frente de luz
   * esfumada. Espera o contexto já transladado para o centro do canvas.
   */
  _isRevealComplete(revealRadius) {
    return revealRadius >= this.moonRadius * 0.995;
  }

  _paintReveal(revealRadius) {
    const { ctx } = this;
    const sprite = this.moonSprite;
    if (!sprite) return;

    const full = this._isRevealComplete(revealRadius);

    if (full) {
      ctx.drawImage(sprite.canvas, -sprite.dim / 2, -sprite.dim / 2, sprite.dim, sprite.dim);
      return;
    }

    const buf = this.revealBuffer;
    const bctx = buf.ctx;
    const w = buf.canvas.width;
    const h = buf.canvas.height;
    const center = w / 2;
    const r = Math.max(revealRadius * this.dpr, 1);
    const feather = Math.max(r * 0.34, this.dpr * 6);

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(sprite.canvas, 0, 0);

    // Máscara: opaca até quase a borda, dissolvendo na frente de luz.
    bctx.globalCompositeOperation = 'destination-in';
    const mask = bctx.createRadialGradient(center, center, Math.max(r - feather, 0), center, center, r);
    mask.addColorStop(0, 'rgba(255, 255, 255, 1)');
    mask.addColorStop(0.55, 'rgba(255, 255, 255, 0.92)');
    mask.addColorStop(1, 'rgba(255, 255, 255, 0)');
    bctx.fillStyle = mask;
    bctx.fillRect(0, 0, w, h);
    bctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(buf.canvas, -sprite.dim / 2, -sprite.dim / 2, sprite.dim, sprite.dim);
  }

  // ------------------------------------------------------------- desenho ----

  _render(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Suavização independente de framerate.
    const k = 1 - Math.exp(-dt * 7.5);
    this.displayed += (this.progress - this.displayed) * k;
    if (Math.abs(this.progress - this.displayed) < 0.0005) {
      this.displayed = this.progress;
    }

    const targetReveal = this._revealFor(this.displayed);
    this.reveal += (targetReveal - this.reveal) * (1 - Math.exp(-dt * 6));

    if (this.flare > 0) {
      this.flare = Math.max(0, this.flare - dt * 0.55);
    }

    const nowSec = now / 1000;
    this.haloBoost = 0.5 + 0.5 * Math.sin(nowSec * 0.9);

    this._draw(nowSec);
    this.rafId = requestAnimationFrame(this._render);
  }

  _draw(time = 0) {
    const { ctx, size } = this;
    if (!ctx || !size) return;

    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const R = this.ringRadius;
    const Rm = this.moonRadius;
    const p = this.displayed;
    const flare = this.flare;

    ctx.save();
    ctx.translate(cx, cy);

    // --- halo externo --------------------------------------------------------
    // O raio máximo é limitado ao círculo inscrito no canvas: se o gradiente
    // passar da borda, o corte reto do canvas aparece como um quadrado aceso.
    const haloStrength = 0.05 + p * 0.26 + flare * 0.32;
    const haloRadius = Math.min(R * 1.42, size * 0.5);
    const halo = ctx.createRadialGradient(0, 0, Rm * 0.55, 0, 0, haloRadius);
    halo.addColorStop(0, `rgba(196, 205, 255, ${haloStrength * 0.9})`);
    halo.addColorStop(0.45, `rgba(139, 149, 255, ${haloStrength * 0.4})`);
    halo.addColorStop(0.78, `rgba(139, 149, 255, ${haloStrength * 0.1})`);
    halo.addColorStop(1, 'rgba(139, 149, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, TAU);
    ctx.fill();

    // --- disco lunar ---------------------------------------------------------
    if (this.moonSprite) {
      const { canvas, dim } = this.moonSprite;

      // 1) contorno apagado do disco completo (mostra o "alvo" a preencher)
      ctx.globalAlpha = 0.1 + p * 0.05;
      ctx.drawImage(canvas, -dim / 2, -dim / 2, dim, dim);
      ctx.globalAlpha = 1;

      // 2) luz que se espalha do centro para as bordas
      const revealRadius = Rm * (0.06 + this.reveal * 1.02);
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, Rm, 0, TAU);
      ctx.clip();

      // A lua é luz refletida, não um holofote: fica abaixo da logo em
      // intensidade para que a marca continue sendo o elemento mais claro.
      const brightness = 0.34 + 0.46 * easeOutCubic(this.reveal);
      ctx.globalAlpha = brightness;
      this._paintReveal(revealRadius);
      ctx.globalAlpha = 1;

      // Frio lunar: véu azulado muito leve sobre a parte já acesa.
      ctx.beginPath();
      ctx.arc(0, 0, revealRadius, 0, TAU);
      ctx.fillStyle = 'rgba(120, 134, 196, 0.1)';
      ctx.fill();
      ctx.restore();

      // 3) frente de luz: um brilho fino exatamente na borda que está crescendo
      if (!this._isRevealComplete(revealRadius)) {
        const front = ctx.createRadialGradient(
          0, 0, Math.max(revealRadius * 0.86, 0), 0, 0, Math.min(revealRadius * 1.01, Rm)
        );
        front.addColorStop(0, 'rgba(255, 255, 255, 0)');
        front.addColorStop(0.8, 'rgba(233, 238, 255, 0.16)');
        front.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, Rm, 0, TAU);
        ctx.clip();
        ctx.fillStyle = front;
        ctx.beginPath();
        ctx.arc(0, 0, revealRadius * 1.01, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // --- trilha do anel ------------------------------------------------------
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- marcas orbitais -----------------------------------------------------
    const tickInner = R + Math.max(7, size * 0.022);
    const tickOuter = tickInner + Math.max(4, size * 0.012);
    this._ticks.forEach((tick) => {
      const passed = tick.angle < -Math.PI / 2 + p * TAU + 0.0001;
      const cos = Math.cos(tick.angle);
      const sin = Math.sin(tick.angle);
      ctx.beginPath();
      ctx.moveTo(cos * tickInner, sin * tickInner);
      ctx.lineTo(cos * (tick.major ? tickOuter + 3 : tickOuter), sin * (tick.major ? tickOuter + 3 : tickOuter));
      ctx.strokeStyle = passed
        ? `rgba(214, 221, 255, ${tick.major ? 0.75 : 0.4})`
        : `rgba(255, 255, 255, ${tick.major ? 0.16 : 0.09})`;
      ctx.lineWidth = tick.major ? 1.4 : 1;
      ctx.stroke();
    });

    // --- arco de progresso ---------------------------------------------------
    if (p > 0.0005) {
      const start = -Math.PI / 2;
      const end = start + TAU * clamp(p, 0, 1);

      const arcGradient = ctx.createLinearGradient(-R, -R, R, R);
      arcGradient.addColorStop(0, '#8b95ff');
      arcGradient.addColorStop(0.5, '#c9d0ff');
      arcGradient.addColorStop(1, '#ffffff');

      // Brilho do arco: em vez de shadowBlur (caro no canvas), desenhamos
      // strokes progressivamente mais largos e translúcidos por baixo.
      const glowAlpha = (p < 0.999 ? 0.22 : 0.3) + this.haloBoost * 0.1 + flare * 0.35;
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 3; i >= 1; i -= 1) {
        ctx.beginPath();
        ctx.arc(0, 0, R, start, end);
        ctx.strokeStyle = `rgba(168, 180, 255, ${(glowAlpha / (i * 2.2)).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.6, size * 0.006) * (1 + i * 2.4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, R, start, end);
      ctx.strokeStyle = arcGradient;
      ctx.lineWidth = Math.max(1.6, size * 0.006);
      ctx.stroke();
      ctx.restore();

      // cabeça luminosa do progresso
      if (p < 0.998) {
        const hx = Math.cos(end) * R;
        const hy = Math.sin(end) * R;
        const dot = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(9, size * 0.026));
        dot.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        dot.addColorStop(0.35, 'rgba(196, 206, 255, 0.55)');
        dot.addColorStop(1, 'rgba(139, 149, 255, 0)');
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(9, size * 0.026), 0, TAU);
        ctx.fill();
      }
    }

    // --- respiração de conclusão --------------------------------------------
    if (p > 0.995) {
      const breathe = easeInOutSine((Math.sin(time * 1.6) + 1) / 2);
      ctx.beginPath();
      ctx.arc(0, 0, R + Math.max(6, size * 0.02), 0, TAU);
      ctx.strokeStyle = `rgba(196, 206, 255, ${0.06 + breathe * 0.09 + flare * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }
}
