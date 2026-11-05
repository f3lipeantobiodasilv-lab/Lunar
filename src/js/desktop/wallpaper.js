/**
 * Lunar OS — FASE 2
 * Papel de parede procedural em Canvas 2D.
 *
 * Regra do projeto: **nenhuma imagem nova**. Tudo aqui é desenhado em runtime
 * a partir de uma semente — campo de estrelas, nebulosa, lua com crateras,
 * halo de horizonte e estrelas cadentes. A mesma semente produz exatamente o
 * mesmo céu (PRNG determinístico), o que torna o resultado reproduzível e
 * testável.
 *
 * Arquitetura de desempenho
 * -------------------------
 * O céu é dividido em camadas **pré-renderizadas** em canvas fora da tela:
 *
 *   nebulosa (desfocada, em 1/2 resolução)  → desliza devagar, 1 drawImage
 *   lua + halo de horizonte                 → parallax mínimo, 1 drawImage
 *   campo de estrelas                       → parallax maior, 1 drawImage
 *   estrelas cintilantes + cadentes         → ~50 arcos por quadro
 *
 * Por quadro: 3 drawImage + poucos arcos. Nenhum gradiente é recriado, nenhum
 * `filter` (que desloca o trabalho para a CPU), nenhum `shadowBlur` no laço.
 * Redimensionar reconstrói as camadas; o laço nunca aloca.
 *
 * Regras de energia
 * -----------------
 * • a aba oculta para o laço (visibilitychange);
 * • durante o boot o laço nem começa (o desktop só chama `start()` ao revelar);
 * • com `prefers-reduced-motion` desenha UM quadro e para — céu estático,
 *   bonito e imóvel, sem custo contínuo;
 * • o DPR é limitado a 2 (em telas 3× o custo quadruplica sem ganho visível).
 */

import { clamp, lerp, seededRandom, prefersReducedMotion } from '../core/ease.js';

/**
 * Paletas de céu. Todas frias (identidade lunar), com uma variação mais
 * quente para o papel de parede não parecer sempre o mesmo.
 */
const PALETTES = [
  { name: 'prata', nebula: ['#5b6bd6', '#8b95ff', '#3f4f9e'], glow: '#cfd6ff', horizon: '#1b1f3a' },
  { name: 'gelo', nebula: ['#3e93b8', '#6ee7f0', '#2c5f86'], glow: '#bff4ff', horizon: '#132434' },
  { name: 'violeta', nebula: ['#7a4fd0', '#b98bff', '#402a7a'], glow: '#dcc9ff', horizon: '#1d1533' },
  { name: 'aurora', nebula: ['#2f8f6a', '#7ce0b1', '#21626f'], glow: '#c6ffe6', horizon: '#101f24' },
  { name: 'âmbar', nebula: ['#9c5a3c', '#f0b64a', '#5a3450'], glow: '#ffe2b8', horizon: '#231a2a' },
];

const MAX_DPR = 2;

export class Wallpaper {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ seed?: number, onReady?: () => void }} [options]
   */
  constructor(canvas, { seed, onReady } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d', { alpha: false }) ?? null;
    this.onReady = onReady ?? (() => {});

    this.seed = Number.isFinite(seed) ? seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.reduceMotion = prefersReducedMotion();

    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    /** @type {HTMLCanvasElement|null} */ this._nebula = null;
    /** @type {HTMLCanvasElement|null} */ this._moon = null;
    /** @type {HTMLCanvasElement|null} */ this._stars = null;

    this._twinkles = [];
    this._shooting = [];
    this._nextShootingAt = 0;

    this._raf = null;
    this._lastFrame = 0;
    this._running = false;
    this._built = false;

    // Parallax suave: alvo vem do ponteiro, posição persegue com lerp.
    this._pointer = { x: 0, y: 0 };
    this._parallax = { x: 0, y: 0 };

    this._onPointerMove = (event) => this._trackPointer(event);
    this._onResize = () => this.resize();
    this._onVisibility = () => {
      if (document.hidden) this._cancelLoop();
      else if (this._running) this._startLoop();
    };
  }

  // ----------------------------------------------------------- ciclo -------

  /** Monta as camadas e começa a animar. Idempotente. */
  start() {
    if (!this.ctx || !this.canvas) return;
    this._running = true;

    // Mede ANTES de construir: é `resize()` quem escreve width/height no
    // canvas da tela. Sem ela o elemento ficaria com os 300×150 padrão do
    // HTML e o CSS o esticaria, borrando tudo.
    this.resize();
    if (!this._built) this._build();
    this._bind();

    // Um quadro agora, antes do laço: o papel de parede já aparece pintado no
    // primeiro instante em que a área de trabalho é revelada.
    this._drawFrame(0, { static: true });

    if (this.reduceMotion) return;
    this._startLoop();
  }

  /** Para o laço sem destruir as camadas (usado ao voltar para o boot). */
  stop() {
    this._running = false;
    this._cancelLoop();
    this._unbind();
  }

  destroy() {
    this.stop();
    this._nebula = this._moon = this._stars = null;
    this._built = false;
  }

  /** Sorteia um céu novo mantendo o mesmo tamanho de tela. */
  randomize() {
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this._built = false;
    this._build();
    if (this.reduceMotion) this._drawFrame(0, { static: true });
    else if (this._running) this._startLoop();
    return this.seed;
  }

  /** Recalcula tamanho, DPR e reconstrói camadas (rotação, resize). */
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // O canvas pode estar com 0×0 (display:none, aba recém-aberta, layout
    // ainda não calculado). Nesse caso caímos para a janela: um papel de
    // parede com o tamanho errado por um instante é melhor do que camadas
    // vazias — e o próximo resize corrige.
    const width = Math.max(1, Math.round(rect.width || window.innerWidth || 1));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight || 1));
    const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);

    const sameSize =
      width === this.width && height === this.height && Math.abs(dpr - this.dpr) < 0.01;
    if (sameSize && this._built) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;

    for (const target of [this.canvas, this._nebula, this._moon, this._stars]) {
      if (!target) continue;
      target.width = Math.round(width * dpr);
      target.height = Math.round(height * dpr);
    }

    this._built = false;
    this._build();
    if (this.reduceMotion) this._drawFrame(0, { static: true });
  }

  // -------------------------------------------------------- construção -----

  /**
   * Constrói as camadas.
   *
   * Nunca chama `resize()` — antes, com o canvas em 0×0, `_build` chamava
   * `resize`, que chamava `_build`, e a recursão estourava a pilha. Agora o
   * tamanho é responsabilidade exclusiva de `resize()` (chamado por `start` e
   * pelo listener de resize).
   */
  _build() {
    if (!this.canvas) return;
    if (!this.width || !this.height) {
      // Sem medida ainda: garante um mínimo desenhável e segue.
      this.width = this.width || Math.max(1, window.innerWidth || 1);
      this.height = this.height || Math.max(1, window.innerHeight || 1);
    }

    this._built = true;
    const random = seededRandom(this.seed);
    const palette = PALETTES[Math.floor(random() * PALETTES.length)] ?? PALETTES[0];

    this._nebula = this._makeLayer(this.width / 2, this.height / 2, 0.5);
    this._moon = this._makeLayer(this.width, this.height, this.dpr);
    this._stars = this._makeLayer(this.width, this.height, this.dpr);

    this._paintNebula(this._nebula, palette, random);
    this._paintMoonAndHorizon(this._moon, palette, random);
    this._buildStarField(palette, random);

    this._shooting = [];
    this._nextShootingAt = 2600 + random() * 6000;

    this.onReady();
  }

  _makeLayer(cssWidth, cssHeight, scale) {
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.round(cssWidth * scale));
    layer.height = Math.max(1, Math.round(cssHeight * scale));
    return layer;
  }

  /** Nebulosa: manchas somadas em `lighter` + faixa da via láctea. */
  _paintNebula(layer, palette, random) {
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    const w = layer.width;
    const h = layer.height;

    ctx.clearRect(0, 0, w, h);

    // Fundo: a base escura que garante preto absoluto nas bordas.
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, w, h);

    const blobs = 5 + Math.floor(random() * 3);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < blobs; i += 1) {
      const cx = random() * w;
      const cy = random() * h * 0.9;
      const radius = (0.28 + random() * 0.45) * Math.max(w, h) * 0.5;
      // A névoa vive melhor com alpha baixo e raio grande: sobrepostas, as
      // manchas somam e formam a nuvem sem virar "blob" saturado.
      const alpha = 0.07 + random() * 0.1;
      const color = palette.nebula[i % palette.nebula.length];

      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, hexToRgba(color, alpha));
      gradient.addColorStop(0.45, hexToRgba(color, alpha * 0.45));
      gradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Faixa da via láctea: um degradê longo atravessando a tela no ângulo
    // sorteado, com Alpha baixíssimo — é o que dá "profundidade" ao céu.
    const angle = (-35 + random() * 70) * (Math.PI / 180);
    ctx.save();
    ctx.translate(w / 2, h * 0.42);
    ctx.rotate(angle);
    const band = ctx.createLinearGradient(0, -h * 0.22, 0, h * 0.22);
    band.addColorStop(0, hexToRgba(palette.glow, 0));
    band.addColorStop(0.5, hexToRgba(palette.glow, 0.05));
    band.addColorStop(1, hexToRgba(palette.glow, 0));
    ctx.fillStyle = band;
    ctx.fillRect(-w, -h * 0.22, w * 2, h * 0.44);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Lua cheia com crateras + halo de horizonte. */
  _paintMoonAndHorizon(layer, palette, random) {
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    const w = layer.width;
    const h = layer.height;
    const unit = Math.min(w, h);

    ctx.clearRect(0, 0, w, h);

    // Halo de horizonte: a barra de tarefas escura ganha contexto.
    const horizon = ctx.createLinearGradient(0, h * 0.62, 0, h);
    horizon.addColorStop(0, hexToRgba(palette.horizon, 0));
    horizon.addColorStop(0.62, hexToRgba(palette.horizon, 0.35));
    horizon.addColorStop(1, hexToRgba(palette.horizon, 0.72));
    ctx.fillStyle = horizon;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);

    const radius = clamp(unit * 0.115, 42 * this.dpr, 148 * this.dpr);
    // A lua nunca encosta na borda: 1.25·R de margem.
    const margin = radius * 1.25;
    const cx = lerp(margin, w - margin, 0.58 + random() * 0.26);
    const cy = lerp(margin, h * 0.52, 0.3 + random() * 0.34);
    const tilt = (random() - 0.5) * 0.6;

    // 1. Brilho externo (fora do disco, aditivo).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.82, cx, cy, radius * 3.4);
    glow.addColorStop(0, hexToRgba(palette.glow, 0.16));
    glow.addColorStop(0.38, hexToRgba(palette.glow, 0.06));
    glow.addColorStop(1, hexToRgba(palette.glow, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Disco: luz vinda de cima/esquerda, sombra na borda oposta.
    const body = ctx.createRadialGradient(
      cx - radius * 0.34,
      cy - radius * 0.38,
      radius * 0.1,
      cx,
      cy,
      radius * 1.02
    );
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.34, '#eef1fa');
    body.addColorStop(0.72, '#c8cee0');
    body.addColorStop(1, '#8e96ad');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Crateras: elipses levemente achatadas, cada uma com borda iluminada.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.995, 0, Math.PI * 2);
    ctx.clip();
    // A inclinação das crateras entra ângulo a ângulo (Math.cos(angle + tilt))
    // em vez de rotacionar o contexto: assim o clip do disco continua no
    // lugar e nada depende de restaurar duas matrizes empilhadas.

    const craters = 16 + Math.floor(random() * 10);
    for (let i = 0; i < craters; i += 1) {
      const angle = random() * Math.PI * 2;
      // sqrt distribui uniformemente na área do disco (sem isso, tudo se
      // acumula no centro).
      const distance = Math.sqrt(random()) * radius * 0.94;
      const x = cx + Math.cos(angle + tilt) * distance;
      const y = cy + Math.sin(angle + tilt) * distance * 0.97;
      const size = radius * (0.035 + Math.pow(random(), 2.2) * 0.19);

      // Depressão: mais escura no centro, com a borda superior iluminada.
      const crater = ctx.createRadialGradient(
        x - size * 0.28,
        y - size * 0.3,
        size * 0.1,
        x,
        y,
        size
      );
      crater.addColorStop(0, 'rgba(126, 134, 156, 0.5)');
      crater.addColorStop(0.72, 'rgba(158, 166, 186, 0.28)');
      crater.addColorStop(1, 'rgba(214, 220, 236, 0)');
      ctx.fillStyle = crater;
      ctx.beginPath();
      ctx.ellipse(x, y, size, size * 0.9, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();

      if (size > radius * 0.09) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = Math.max(1, size * 0.07);
        ctx.beginPath();
        ctx.ellipse(x, y, size * 0.94, size * 0.84, random() * Math.PI, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 4. Escurecimento limbico: dá esfericidade ao disco.
    const limb = ctx.createRadialGradient(cx, cy, radius * 0.58, cx, cy, radius);
    limb.addColorStop(0, 'rgba(0, 0, 0, 0)');
    limb.addColorStop(1, 'rgba(10, 12, 24, 0.42)');
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 5. Fio de luz na borda superior esquerda (o "nascer" da lua).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexToRgba(palette.glow, 0.42);
    ctx.lineWidth = Math.max(1, radius * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.995, Math.PI * 0.86, Math.PI * 1.86);
    ctx.stroke();
    ctx.restore();
  }

  /** Campo de estrelas estático + lista de estrelas que cintilam. */
  _buildStarField(palette, random) {
    const ctx = this._stars.getContext('2d');
    if (!ctx) return;
    const w = this._stars.width;
    const h = this._stars.height;

    ctx.clearRect(0, 0, w, h);

    // Densidade proporcional à área, com teto: 4K não precisa de 4× estrelas.
    const count = Math.round(clamp((this.width * this.height) / 7800, 90, 420));
    const starRandom = seededRandom(this.seed ^ 0x9e3779b9);

    this._twinkles = [];

    for (let i = 0; i < count; i += 1) {
      const x = starRandom() * w;
      // 8% das estrelas ficam abaixo do horizonte para o céu não "acabar".
      const y = Math.pow(starRandom(), 1.12) * h;
      const size = (0.4 + Math.pow(starRandom(), 3) * 1.7) * this.dpr;
      const alpha = 0.16 + starRandom() * 0.72;
      const warm = starRandom();
      const tint =
        warm > 0.94 ? '#ffd9b0' : warm > 0.86 ? '#cfe0ff' : warm > 0.78 ? '#e7e2ff' : '#ffffff';

      // ~12% escolhidas para cintilar; as demais entram na camada estática.
      const shouldTwinkle = starRandom() < 0.12 && size > 0.7 * this.dpr;
      if (shouldTwinkle) {
        this._twinkles.push({
          x,
          y,
          size,
          alpha,
          tint,
          phase: starRandom() * Math.PI * 2,
          speed: 0.0011 + starRandom() * 0.0022,
        });
        continue;
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // As maiores ganham uma cruz de difração discreta.
      if (size > 1.5 * this.dpr) {
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillRect(x - size * 3, y - 0.4, size * 6, 0.8);
        ctx.fillRect(x - 0.4, y - size * 3, 0.8, size * 6);
      }
    }

    ctx.globalAlpha = 1;

    // Poeira da via láctea: pontinhos minúsculos ao longo da diagonal.
    const dust = Math.round(count * 0.6);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette.glow;
    for (let i = 0; i < dust; i += 1) {
      const t = starRandom();
      const spread = (starRandom() - 0.5) * h * 0.34;
      const x = t * w;
      const y = h * 0.42 + (t - 0.5) * h * 0.5 + spread;
      ctx.globalAlpha = 0.04 + starRandom() * 0.12;
      ctx.fillRect(x, y, this.dpr, this.dpr);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- laço ------

  _startLoop() {
    this._cancelLoop();
    if (!this._running || this.reduceMotion) return;

    // Sem `requestAnimationFrame` (ambiente sem janela, testes): fica no quadro
    // estático que `start()` já desenhou, em vez de estourar.
    if (typeof requestAnimationFrame !== 'function') return;

    this._lastFrame = 0;
    const loop = (timestamp) => {
      if (!this._running) return;
      this._drawFrame(timestamp, {});
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _cancelLoop() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _drawFrame(timestamp, { static: isStatic = false } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this._built) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const time = isStatic ? 0 : timestamp;

    // Persegue o ponteiro com suavização — parallax nunca "cola" no cursor.
    if (isStatic) {
      this._parallax.x = this._parallax.y = 0;
    } else {
      this._parallax.x = lerp(this._parallax.x, this._pointer.x, 0.045);
      this._parallax.y = lerp(this._parallax.y, this._pointer.y, 0.045);
    }
    const px = this._parallax.x * this.dpr;
    const py = this._parallax.y * this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, w, h);

    // 1. Nebulosa: além do parallax, um deslize lentíssimo (aurora).
    if (this._nebula) {
      const driftX = isStatic ? 0 : Math.sin(time / 24000) * w * 0.012;
      const driftY = isStatic ? 0 : Math.cos(time / 31000) * h * 0.008;
      ctx.globalAlpha = isStatic ? 1 : 0.94 + Math.sin(time / 9000) * 0.06;
      ctx.drawImage(this._nebula, px * 0.18 + driftX, py * 0.18 + driftY, w, h);
      ctx.globalAlpha = 1;
    }

    // 2. Lua + horizonte.
    if (this._moon) {
      ctx.drawImage(this._moon, px * 0.42, py * 0.42, w, h);
    }

    // 3. Estrelas fixas.
    if (this._stars) {
      ctx.drawImage(this._stars, px * 0.9, py * 0.9, w, h);
    }

    // 4. Estrelas cintilantes (poucas dezenas: custo desprezível).
    if (!isStatic) {
      for (const star of this._twinkles) {
        const pulse = 0.55 + 0.45 * Math.sin(star.phase + time * star.speed);
        ctx.globalAlpha = clamp(star.alpha * pulse, 0, 1);
        ctx.fillStyle = star.tint;
        ctx.beginPath();
        ctx.arc(star.x + px * 0.9, star.y + py * 0.9, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 5. Estrelas cadentes: raras por decisão de gosto (uma a cada ~8 s).
    if (!isStatic) this._updateShootingStars(time, ctx);
  }

  _updateShootingStars(time, ctx) {
    if (this._lastFrame === 0) this._lastFrame = time;
    const dt = clamp(time - this._lastFrame, 0, 64);
    this._lastFrame = time;

    if (time > this._nextShootingAt && this._shooting.length < 2) {
      this._shooting.push(this._makeShootingStar());
      this._nextShootingAt = time + 7000 + Math.random() * 9000;
    }

    const dpr = this.dpr;
    for (let i = this._shooting.length - 1; i >= 0; i -= 1) {
      const star = this._shooting[i];
      star.life += dt;

      if (star.life > star.duration) {
        this._shooting.splice(i, 1);
        continue;
      }

      const progress = star.life / star.duration;
      // Entra e sai em fade: nunca aparece "cortada" na tela.
      const alpha = Math.sin(progress * Math.PI) * 0.9;
      const x = (star.x + star.vx * star.life) * dpr;
      const y = (star.y + star.vy * star.life) * dpr;
      const tailX = x - star.vx * star.tail * dpr;
      const tailY = y - star.vy * star.tail * dpr;

      const gradient = ctx.createLinearGradient(x, y, tailX, tailY);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.35, `rgba(198, 214, 255, ${alpha * 0.42})`);
      gradient.addColorStop(1, 'rgba(198, 214, 255, 0)');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.6 * dpr;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _makeShootingStar() {
    // Sempre viaja da esquerda para a direita: combina com a lua e com a
    // leitura ocidental da tela.
    const speed = 0.5 + Math.random() * 0.45;
    return {
      x: Math.random() * this.width * 0.7,
      y: Math.random() * this.height * 0.42,
      vx: speed * 0.9,
      vy: speed * 0.36,
      tail: 68 + Math.random() * 54,
      life: 0,
      duration: 720 + Math.random() * 420,
    };
  }

  // ------------------------------------------------------------- entrada ---

  _bind() {
    if (this._bound) return;
    this._bound = true;
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    if (!this.reduceMotion) {
      window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    }
  }

  _unbind() {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('pointermove', this._onPointerMove);
  }

  _trackPointer(event) {
    // Deslocamento máximo de ~22 px: parallax é tempero, não desorientação.
    const nx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    this._pointer.x = -nx * 22;
    this._pointer.y = -ny * 14;
  }
}

/** `#rrggbb` + alpha → `rgba(...)`. */
function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}
