/**
 * Lunar OS — FASE 2
 * Área de trabalho: papel de parede, barra de tarefas, menu Iniciar e o
 * painel "Sobre".
 *
 * Este módulo HIDRATA o esqueleto que já existe no index.html: a barra, o
 * menu, o relógio e os contêineres estão no HTML, aqui só entram as listas e
 * os eventos. Se este módulo não carregar, a área de trabalho continua
 * aparecendo (sem conteúdo, mas sem tela vazia) — mesma filosofia do boot.
 *
 * Nada aqui grava estado: nem localStorage, nem cookies, nem IndexedDB. O que
 * muda de aparência vive em memória e se perde no recarregamento, de propósito.
 */

import { APPS, ACTIONS, PINNED, ICONS, allEntries, searchEntries } from './apps.js';
import { Wallpaper } from './wallpaper.js';
import { audio } from '../core/audio.js';

/** Atalhos que aparecem na área de trabalho (ordem = ordem na coluna). */
const DESKTOP_SHORTCUTS = ['about', 'files', 'notes', 'terminal', 'trash'];

/** Busca um app/ação pelo id no catálogo inteiro. */
const findEntry = (id) => allEntries().find((entry) => entry.id === id) ?? null;

/**
 * Monta um ícone SVG inline.
 *
 * Os ícones são strings de paths em apps.js: nada de arquivo de imagem (o
 * projeto só pode ter as duas PNGs já existentes) e nada de sprite externo.
 * `currentColor` faz o traço herdar a cor do botão.
 */
export function iconSvg(name, { size } = {}) {
  const body = ICONS[name] ?? ICONS.moon ?? '';
  const sizeAttr = size ? ` width="${size}" height="${size}"` : '';
  return (
    `<svg viewBox="0 0 24 24"${sizeAttr} fill="none" stroke="currentColor"` +
    ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
    ` focusable="false">${body}</svg>`
  );
}

export class Desktop {
  /**
   * @param {{
   *   build?: string,
   *   onReplay?: () => void,
   * }} [options]
   */
  constructor({ build = '0.3.0', onReplay } = {}) {
    this.build = build;
    this.onReplay = onReplay ?? (() => {});

    // Elementos (todos opcionais: o módulo não pode quebrar se o HTML mudar).
    this.el = document.getElementById('desktop');
    this.canvas = document.getElementById('wallpaper');
    this.iconsEl = document.getElementById('desktop-icons');
    this.taskbarAppsEl = document.getElementById('taskbar-apps');
    this.startBtn = document.getElementById('start-button');
    this.searchBtn = document.getElementById('search-button');
    this.menuEl = document.getElementById('start-menu');
    this.searchInput = document.getElementById('start-search');
    this.searchForm = document.getElementById('start-search-form');
    this.gridEl = document.getElementById('start-grid');
    this.emptyEl = document.getElementById('start-empty');
    this.sectionEl = document.getElementById('start-section-title');
    this.actionsEl = document.getElementById('start-actions');
    this.clockTimeEl = document.getElementById('clock-time');
    this.clockDateEl = document.getElementById('clock-date');
    this.soundBtn = document.getElementById('tray-sound');
    this.soundLabelEl = document.getElementById('tray-sound-label');
    this.startLogo = document.getElementById('start-logo');
    this.toastsEl = document.getElementById('toasts');
    this.sheetEl = document.getElementById('about-sheet');
    this.sheetBodyEl = document.getElementById('about-body');

    this.menuOpen = false;
    this.query = '';
    /** Aberturas por app: a Fase 3 registra as janelas aqui. */
    this.handlers = new Map();
    this._toastTimers = new Set();
    this._clockTimer = null;
    this._lastClock = '';
    this._lastFocus = null;

    this.wallpaper = this.canvas ? new Wallpaper(this.canvas) : null;

    // Liga o que existe e preenche as listas.
    this.mount();
  }

  // ------------------------------------------------------------- montagem --

  mount() {
    this._renderDesktopIcons();
    this._renderTaskbarApps();
    this._renderActions();
    this._renderMenu();

    // O app "Sobre" é o único já aberto pela Fase 2.
    this.registerApp('about', () => this.openAbout());

    this._bindEvents();
    this._watchLogo();
    this._tickClock();
    this._syncSound();
    this._prefillIcons();

    const buildEl = document.getElementById('start-build');
    if (buildEl) buildEl.textContent = this.build;
  }

  /**
   * Se a logo do Iniciar não carregar (offline, caminho errado), o ícone de
   * lua inline assume o lugar. Nada de botão furado.
   */
  _watchLogo() {
    if (!this.startLogo) return;
    const fail = () => {
      this.startLogo.closest('.taskbar__start-icon')?.setAttribute('data-logo', 'failed');
    };
    if (this.startLogo.complete && this.startLogo.naturalWidth === 0) fail();
    this.startLogo.addEventListener('error', fail, { once: true });
  }

  /** Preenche os ícones declarados no HTML por `data-icon` (sem JS duplicado). */
  _prefillIcons() {
    for (const node of document.querySelectorAll('[data-icon]')) {
      if (node.dataset.iconDone === '1') continue;
      node.innerHTML = iconSvg(node.dataset.icon);
      node.dataset.iconDone = '1';
    }
  }

  _renderDesktopIcons() {
    if (!this.iconsEl) return;
    const items = DESKTOP_SHORTCUTS.map(findEntry).filter(Boolean);
    this.iconsEl.innerHTML = items
      .map((entry) => {
        const soon = entry.phase > 2;
        const tone = `style="--tone-a:${entry.tone[0]};--tone-b:${entry.tone[1]}"`;
        return (
          `<li class="desktop__icons-item">` +
          `<button class="desktop-icon" type="button" data-app="${entry.id}"` +
          ` data-soon="${soon}" title="${entry.name} — ${entry.hint}" ${tone}>` +
          `<span class="desktop-icon__glyph">${iconSvg(entry.icon)}</span>` +
          `<span class="desktop-icon__name">${entry.name}</span>` +
          (soon ? '<span class="desktop-icon__badge">fase ' + entry.phase + '</span>' : '') +
          `</button></li>`
        );
      })
      .join('');
  }

  _renderTaskbarApps() {
    if (!this.taskbarAppsEl) return;
    const items = PINNED.map(findEntry).filter(Boolean);
    this.taskbarAppsEl.innerHTML = items
      .map((entry) => {
        const soon = entry.phase > 2;
        return (
          `<li><button class="taskbar__app" type="button" data-app="${entry.id}"` +
          ` data-soon="${soon}" aria-label="${entry.name}" title="${entry.name}">` +
          iconSvg(entry.icon) +
          `</button></li>`
        );
      })
      .join('');
  }

  _renderActions() {
    if (!this.actionsEl) return;
    this.actionsEl.innerHTML = ACTIONS.map(
      (entry) =>
        `<li><button class="startmenu__action" type="button" data-action="${entry.id}"` +
        ` title="${entry.hint}">${iconSvg(entry.icon)}<span>${entry.name}</span></button></li>`
    ).join('');
  }

  /** Desenha o menu: busca ativa → resultados; senão, todos os apps. */
  _renderMenu() {
    if (!this.gridEl) return;
    const term = this.query.trim();
    const entries = term ? searchEntries(term, 12) : APPS;
    const results = Boolean(term);

    if (this.sectionEl) {
      this.sectionEl.textContent = results
        ? `Resultados para “${term}”`
        : 'Todos os aplicativos';
    }

    if (this.emptyEl) {
      this.emptyEl.hidden = entries.length > 0;
      if (!entries.length) this.emptyEl.textContent = `Nada encontrado para “${term}”.`;
    }

    this.gridEl.innerHTML = entries
      .map((entry) => {
        const soon = entry.phase > 2;
        return (
          `<li><button class="startmenu__tile" type="button"` +
          (entry.id && !ACTIONS.some((a) => a.id === entry.id)
            ? ` data-app="${entry.id}"`
            : ` data-action="${entry.id}"`) +
          ` data-soon="${soon}" style="--tone-a:${entry.tone[0]};--tone-b:${entry.tone[1]}">` +
          `<span class="startmenu__tile-glyph">${iconSvg(entry.icon)}</span>` +
          `<span class="startmenu__tile-text">` +
          `<span class="startmenu__tile-name">${entry.name}</span>` +
          `<span class="startmenu__tile-hint">${entry.hint}</span>` +
          `</span>` +
          (soon ? `<span class="startmenu__tile-soon">fase ${entry.phase}</span>` : '') +
          `</button></li>`
        );
      })
      .join('');

    // Primeiro item destacado: Enter abre ele sem precisar Tab.
    const first = this.gridEl.querySelector('.startmenu__tile');
    first?.classList.add('is-active');
    this._activeIndex = 0;
  }

  // -------------------------------------------------------------- eventos --

  _bindEvents() {
    // Cliques: um único listener resolve ícones, barra, menu e ações.
    const onClick = (event) => {
      const appBtn = event.target.closest?.('[data-app]');
      if (appBtn) {
        this.run(appBtn.dataset.app);
        return;
      }
      const actionBtn = event.target.closest?.('[data-action]');
      if (actionBtn) {
        this.runAction(actionBtn.dataset.action);
        return;
      }
      const closeSheet = event.target.closest?.('[data-sheet-close]');
      if (closeSheet) this.closeAbout();
    };

    this.el?.addEventListener('click', onClick);

    this.startBtn?.addEventListener('click', () => {
      audio.playUiTick({ frequency: 720, peak: 0.05 });
      this.toggleMenu();
    });

    this.searchBtn?.addEventListener('click', () => {
      audio.playUiTick({ frequency: 880, peak: 0.05 });
      this.openMenu({ focusSearch: true });
    });

    this.searchInput?.addEventListener('input', () => {
      this.query = this.searchInput.value ?? '';
      this._renderMenu();
    });

    // Enter no campo executa o primeiro resultado — é o atalho que todo
    // mundo tenta antes de clicar.
    this.searchForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const [first] = this.query.trim() ? searchEntries(this.query, 1) : [];
      if (first) this.run(first.id);
    });

    // Fecha o menu ao clicar fora dele (mas não ao clicar dentro).
    this._onPointerDown = (event) => {
      if (!this.menuOpen) return;
      if (this.menuEl?.contains(event.target)) return;
      if (this.startBtn?.contains(event.target)) return;
      if (this.searchBtn?.contains(event.target)) return;
      this.closeMenu();
    };
    document.addEventListener('pointerdown', this._onPointerDown);

    this.soundBtn?.addEventListener('click', () => this.toggleSound());

    // Teclado: ESC fecha menu/painel, setas navegam nos resultados.
    this._onKeydown = (event) => {
      const sheetOpen = this.sheetEl && !this.sheetEl.hidden;

      if (event.key === 'Escape') {
        if (sheetOpen) {
          event.preventDefault();
          this.closeAbout();
          return;
        }
        if (!this.menuOpen) return;
        // Com texto digitado, o primeiro ESC limpa a busca; o segundo fecha.
        if (this.query.trim()) {
          event.preventDefault();
          this._clearSearch();
          return;
        }
        event.preventDefault();
        this.closeMenu();
        return;
      }

      if (sheetOpen) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!this.menuOpen) return;
        event.preventDefault();
        this._moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', this._onKeydown);

    // Relógio: acorda a cada 15 s. O texto só é reescrito quando muda.
    this._clockTimer = window.setInterval(() => this._tickClock(), 15000);

    // O menu some se a janela for redimensionada para um formato onde ele não
    // cabe bem — evita menu flutuando sobre nada.
    this._onResize = () => {
      if (this.menuOpen && window.innerWidth < 360) this.closeMenu();
    };
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  // ---------------------------------------------------------------- menu ---

  openMenu({ focusSearch = false } = {}) {
    if (!this.menuEl) return;
    if (!this.menuOpen) {
      this._lastFocus = document.activeElement;
      this.menuOpen = true;
      this.menuEl.classList.add('is-open');
      this.menuEl.removeAttribute('aria-hidden');
      this.startBtn?.setAttribute('aria-expanded', 'true');
    }
    if (focusSearch) {
      // O foco precisa esperar o menu ficar visível (no estado fechado,
      // `visibility: hidden` tira o elemento da ordem de foco).
      const focus = () => {
        this.searchInput?.focus();
        this.searchInput?.select?.();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
      else window.setTimeout(focus, 0);
    }
  }

  closeMenu() {
    if (!this.menuEl || !this.menuOpen) return;
    this.menuOpen = false;
    this.menuEl.classList.remove('is-open');
    this.menuEl.setAttribute('aria-hidden', 'true');
    this.startBtn?.setAttribute('aria-expanded', 'false');
    this._clearSearch();
    // Devolve o foco a quem abriu, mas só se o foco ainda está dentro do menu
    // (senão o usuário já foi para outro lugar e não deve ser puxado de volta).
    if (this.menuEl.contains(document.activeElement)) {
      const back = this._lastFocus instanceof HTMLElement ? this._lastFocus : this.startBtn;
      back?.focus?.();
    }
  }

  toggleMenu() {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  _clearSearch() {
    this.query = '';
    if (this.searchInput && this.searchInput.value !== '') this.searchInput.value = '';
    this._renderMenu();
  }

  /** Sobe/desce pelo grid (e pelos resultados da busca) com as setas. */
  _moveActive(delta) {
    if (!this.gridEl) return;
    const tiles = [...this.gridEl.querySelectorAll('.startmenu__tile')];
    if (!tiles.length) return;
    this._activeIndex = (this._activeIndex + delta + tiles.length) % tiles.length;
    tiles.forEach((tile, index) => tile.classList.toggle('is-active', index === this._activeIndex));
    tiles[this._activeIndex]?.focus?.();
  }

  // --------------------------------------------------------------- ações ---

  /**
   * Registra o que um app faz. A Fase 3 chama isso para cada janela; aqui só
   * o "Sobre" se registra.
   */
  registerApp(id, handler) {
    this.handlers.set(id, handler);
  }

  /** Abre um app: delega para o handler registrado ou avisa que vem depois. */
  run(id) {
    const entry = findEntry(id);
    if (!entry) return;

    // A busca não distingue app de ação do sistema; quem sabe é o catálogo.
    // Sem esse desvio, achar "Regerar papel de parede" e dar Enter caía no
    // aviso de "chega na fase 2" — sendo que a ação já funciona agora.
    if (ACTIONS.some((action) => action.id === id)) {
      this.runAction(id);
      return;
    }

    audio.playUiTick({ frequency: entry.phase > 2 ? 320 : 760, peak: 0.05 });

    const handler = this.handlers.get(id);
    if (handler) {
      this.closeMenu();
      handler();
      return;
    }

    // Sem handler: app das fases seguintes. O clique precisa responder.
    this.closeMenu();
    this.notify({
      title: entry.name,
      text: `Chega na fase ${entry.phase}. Nesta demo, o que já abre é o painel “Sobre o Lunar”.`,
      icon: entry.icon,
      tone: entry.tone,
    });
  }

  /** Ações do sistema (não são apps: não abrem janela). */
  runAction(id) {
    const entry = ACTIONS.find((action) => action.id === id);
    if (!entry) return;

    audio.playUiTick({ frequency: 640, peak: 0.05 });

    if (id === 'wallpaper') {
      const seed = this.wallpaper?.randomize();
      this.notify({
        title: 'Novo céu sorteado',
        text: seed
          ? `Semente ${seed.toString(16).padStart(8, '0')} — lua, estrelas e aurora redesenhados.`
          : 'O papel de parede não está disponível neste navegador.',
        icon: 'sparkle',
        tone: ['#8b95ff', '#5b3fd0'],
      });
      return;
    }

    if (id === 'sound') {
      this.toggleSound();
      return;
    }

    if (id === 'replay') {
      this.closeMenu();
      this.onReplay();
    }
  }

  /** Liga/desliga o som sintetizado (o botão reflete o estado real). */
  async toggleSound() {
    const next = !(audio.enabled ?? true);
    audio.setEnabled(next);

    if (next) {
      const unlocked = await audio.unlock();
      if (unlocked) audio.playUiTick({ frequency: 880, peak: 0.07 });
    }

    this._syncSound();
    this.notify({
      title: next ? 'Som do sistema ligado' : 'Som do sistema desligado',
      text: next
        ? 'Todos os sons são sintetizados em tempo real — nenhum arquivo de áudio.'
        : 'Os cliques e avisos ficam em silêncio.',
      icon: 'volume',
      tone: next ? ['#7ce0b1', '#2f8f6a'] : ['#9aa1b8', '#5c6376'],
    });
  }

  _syncSound() {
    const on = audio.enabled ?? true;
    this.soundBtn?.setAttribute('aria-pressed', String(on));
    if (this.soundLabelEl) this.soundLabelEl.textContent = on ? 'Som' : 'Mudo';
    if (this.soundBtn) this.soundBtn.title = on ? 'Desligar o som do sistema' : 'Ligar o som do sistema';
  }

  // -------------------------------------------------------------- avisos ---

  /**
   * Aviso temporário. Some sozinho; não empilha mais que três; nada disso é
   * gravado em lugar nenhum.
   */
  notify({ title, text, icon = 'moon', tone = ['#8b95ff', '#4f5bd5'], duration = 4200 } = {}) {
    if (!this.toastsEl) return;

    while (this.toastsEl.children.length >= 3) {
      this.toastsEl.firstElementChild?.remove();
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--tone-a', tone[0]);
    el.style.setProperty('--tone-b', tone[1]);
    el.innerHTML =
      `<span class="toast__glyph">${iconSvg(icon)}</span>` +
      `<span class="toast__text"><span class="toast__title">${title}</span>${text ?? ''}</span>`;
    this.toastsEl.append(el);

    const timer = window.setTimeout(() => {
      el.classList.add('is-leaving');
      const cleanup = window.setTimeout(() => {
        el.remove();
        this._toastTimers.delete(cleanup);
      }, 260);
      this._toastTimers.add(cleanup);
      this._toastTimers.delete(timer);
    }, duration);
    this._toastTimers.add(timer);
  }

  // --------------------------------------------------------------- Sobre ---

  openAbout() {
    if (!this.sheetEl) return;
    if (this.sheetBodyEl && !this.sheetBodyEl.dataset.filled) {
      this.sheetBodyEl.innerHTML = aboutMarkup(this.build);
      this.sheetBodyEl.dataset.filled = '1';
    }
    this._lastFocus = document.activeElement;
    this.sheetEl.hidden = false;
    const focus = () => this.sheetEl.querySelector('.sheet__close')?.focus?.();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    else window.setTimeout(focus, 0);
  }

  closeAbout() {
    if (!this.sheetEl || this.sheetEl.hidden) return;
    this.sheetEl.hidden = true;
    const back = this._lastFocus instanceof HTMLElement ? this._lastFocus : this.startBtn;
    back?.focus?.();
  }

  // ------------------------------------------------------------- relógio ---

  _tickClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

    if (this.clockTimeEl) {
      this.clockTimeEl.textContent = time;
      this.clockTimeEl.dateTime = now.toISOString();
    }
    if (this.clockDateEl) this.clockDateEl.textContent = date.replace('.', '');
    this._lastClock = time;
  }

  // --------------------------------------------------------------- ciclo ---

  /** Chamado quando o boot revela a área de trabalho. */
  start() {
    this.wallpaper?.start();
    this._tickClock();
  }

  /** Chamado ao voltar para o boot: para o laço do canvas (economia real). */
  stop() {
    this.closeMenu();
    this.closeAbout();
    this.wallpaper?.stop();
  }

  destroy() {
    this.stop();
    window.removeEventListener('keydown', this._onKeydown);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('pointerdown', this._onPointerDown);
    if (this._clockTimer) window.clearInterval(this._clockTimer);
    for (const timer of this._toastTimers) window.clearTimeout(timer);
    this._toastTimers.clear();
    this.wallpaper?.destroy();
  }
}

/** Conteúdo do painel "Sobre o Lunar". */
function aboutMarkup(build) {
  return `
    <p>
      Lunar OS é uma demo de sistema operacional na web: tudo o que você vê é
      desenhado em tempo real, no navegador, sem nenhum arquivo de imagem além
      das duas logos do projeto e sem nenhum arquivo de áudio.
    </p>

    <h3>Esta versão</h3>
    <dl class="sheet__body-grid">
      <div class="sheet__row"><dt>Build</dt><dd>${build}</dd></div>
      <div class="sheet__row"><dt>Boot</dt><dd>Bolinhas em CSS puro, som sintetizado</dd></div>
      <div class="sheet__row"><dt>Papel de parede</dt><dd>Canvas 2D procedural, sorteado por semente</dd></div>
      <div class="sheet__row"><dt>Barra</dt><dd>Vidro fosco, relógio e menu com busca</dd></div>
    </dl>

    <h3>Fases</h3>
    <ul class="sheet__phases">
      <li><b>1</b> <span>Boot universal: escala que cabe em qualquer tela e nunca trava.</span></li>
      <li><b class="is-current">2</b> <span>Papel de parede, barra de tarefas e menu Iniciar.</span></li>
      <li><b>3</b> <span>Motor de janelas e terminal com sistema de arquivos em memória.</span></li>
    </ul>

    <h3>Regras do projeto</h3>
    <ul>
      <li>Nenhuma imagem nova: os ícones são SVG inline, o céu é desenhado.</li>
      <li>Nenhum áudio em arquivo: cada som é sintetizado na Web Audio API.</li>
      <li>Nenhuma persistência: nada de localStorage, cookies ou IndexedDB.</li>
    </ul>

    <p>
      Dica: pressione <b>Iniciar</b> (ou a tecla de busca) e digite — a busca
      encontra apps e ações, com ou sem acento.
    </p>
  `;
}
