/**
 * Lunar OS — ponto de entrada.
 * Fase 1: orquestra apenas a boot sequence e o palco do desktop.
 * Fase 2 e Fase 3 registram seus módulos aqui.
 */

import { BootSequence } from './boot/boot.js';
import { audio } from './core/audio.js';

// Identificador de build: se o console não mostrar esta linha (ou mostrar uma
// versão antiga), o navegador está servindo uma página em cache.
const BUILD = '0.2.1';
console.info(`Lunar OS · build ${BUILD}`);

const desktop = document.getElementById('desktop');
const replayBtn = document.getElementById('replay-boot');
const soundBtn = document.getElementById('desktop-sound');

const boot = new BootSequence({
  onReveal() {
    audio.playChime();
  },
});

// IMPORTANTE: o boot NÃO pode depender de requestAnimationFrame.
// Em abas em segundo plano, iframes ocultos ou com throttling, o rAF pode
// nunca disparar — e a tela ficaria congelada em "Iniciando" para sempre,
// destravando só quando o usuário clicasse em "Pular".
// Um setTimeout(0) também roda depois da primeira pintura, mas sempre dispara.
setTimeout(() => {
  boot.start();
}, 0);

replayBtn?.addEventListener('click', () => {
  audio.playUiTick({ frequency: 660, peak: 0.06 });
  boot.start();
});

soundBtn?.addEventListener('click', async () => {
  const unlocked = await audio.unlock();
  if (!unlocked) return;
  audio.playChime();
});

// Atalho de teclado: ESC durante o boot = pular.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('is-booting')) {
    boot.skip();
  }
});

// Em navegadores que exigem gesto, o primeiro clique já habilita o áudio.
desktop?.addEventListener('pointerdown', () => audio.unlock(), { once: true });

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

export { boot, audio };
