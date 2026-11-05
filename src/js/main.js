/**
 * Lunar OS — ponto de entrada.
 *
 * Fase 1: a boot sequence.
 * Fase 2: a área de trabalho (papel de parede, barra, menu Iniciar).
 * Fase 3 registra aqui o motor de janelas.
 *
 * A ligação entre boot e desktop é feita observando a classe `is-visible` do
 * #desktop, e não chamando na mão dentro de um callback: assim funciona em
 * TODOS os caminhos que revelam a área de trabalho — fim normal do boot,
 * pular, watchdog, fail-safe e o script clássico de fallback.
 */

import { BootSequence } from './boot/boot.js';
import { audio } from './core/audio.js';
import { Desktop } from './desktop/desktop.js';

// Identificador de build: se o console não mostrar esta linha (ou mostrar uma
// versão antiga), o navegador está servindo uma página em cache.
const BUILD = '0.3.0';
console.info(`Lunar OS · build ${BUILD}`);

const desktopEl = document.getElementById('desktop');

const shell = new Desktop({
  build: BUILD,
  onReplay() {
    // Volta ao boot: a área de trabalho para de animar antes da cortina.
    startBoot();
  },
});

const boot = new BootSequence({
  onReveal() {
    audio.playChime();
  },
});

// IMPORTANTE: o boot NÃO pode depender de requestAnimationFrame.
// Em abas em segundo plano, iframes ocultos ou com throttling, o rAF pode
// nunca disparar — e a tela ficaria congelada em "Iniciando" para sempre,
// destravando só quando o usuário clicasse em "Pular".
// Também não usamos setTimeout(0): um timer de 0 ms ainda é uma volta no event
// loop e, em navegador com aba oculta, pode ser adiado (timers de abas em
// segundo plano são agrupados). Começar de forma síncrona é o único caminho
// que não depende de agendador nenhum.
function startBoot() {
  try {
    boot.start();
  } catch (error) {
    // Um erro no boot não pode terminar em tela preta. Revela o desktop,
    // que é a única tela útil depois da fase 1.
    console.error('Lunar OS · falha ao iniciar o boot', error);
    const bootEl = document.getElementById('boot');
    const desktopEl = document.getElementById('desktop');
    document.documentElement.classList.add('boot-fallback');
    bootEl?.classList.add('is-gone');
    bootEl?.setAttribute('aria-hidden', 'true');
    desktopEl?.classList.add('is-visible');
    desktopEl?.removeAttribute('aria-hidden');
    document.body.classList.remove('is-booting');
  }
}

startBoot();

// Atalho de teclado: ESC durante o boot = pular. (Fora do boot, o ESC é do
// desktop: fecha o menu Iniciar ou o painel "Sobre".)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('is-booting')) {
    boot.skip();
  }
});

// Em navegadores que exigem gesto, o primeiro clique já habilita o áudio.
desktopEl?.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// ---------------------------------------------------------------------------
// Boot ↔ desktop.
//
// O desktop é o dono do laço de animação do papel de parede: ele só deve
// rodar com a área de trabalho na tela. Observar a classe cobre os seis
// caminhos possíveis de revelação (fim normal, pular, watchdog interno,
// fail-safe, fallback clássico e erro no start) com um único lugar.
// ---------------------------------------------------------------------------
let shellRunning = false;

function syncShell() {
  if (!desktopEl) return;
  const visible = desktopEl.classList.contains('is-visible');
  if (visible === shellRunning) return;
  shellRunning = visible;
  if (visible) shell.start();
  else shell.stop();
}

if (desktopEl && 'MutationObserver' in window) {
  new MutationObserver(syncShell).observe(desktopEl, {
    attributes: true,
    attributeFilter: ['class'],
  });
  syncShell(); // caso o fallback já tenha revelado antes deste módulo rodar
}

/**
 * Auto-atualização de build.
 *
 * O HTML é o único arquivo que não pode carregar `?v=`: se o navegador guardar
 * uma página antiga, ela continua pedindo CSS/JS antigos. Aqui comparamos a
 * versão embutida nesta página com a que o servidor expõe em /version.json e,
 * quando divergem, recarregamos ignorando o cache.
 *
 * Só recarrega quando o boot já terminou (nunca interrompe a animação) e no
 * máximo uma vez por sessão, para não entrar em laço.
 */
const VERSION_KEY = 'lunar:auto-reload';

async function checkBuild() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === BUILD) return;
    if (sessionStorage.getItem(VERSION_KEY) === version) return;

    sessionStorage.setItem(VERSION_KEY, version);
    console.info(`Lunar OS · build ${BUILD} desatualizado (servidor: ${version}) — recarregando`);

    // location.replace com recarga forçada: descarta o documento antigo.
    const url = new URL(window.location.href);
    url.searchParams.set('v', version);
    window.location.replace(url.toString());
  } catch {
    /* offline ou file:// — segue com a versão atual */
  }
}

// Verifica depois do boot para não competir com a animação.
window.setTimeout(() => {
  if (document.querySelector('#boot')?.classList.contains('is-gone')) checkBuild();
  else window.setTimeout(checkBuild, 6000);
}, 6000);

export { boot, audio, shell as desktop };
