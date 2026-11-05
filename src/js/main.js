/**
 * Lunar OS — ponto de entrada.
 * Fase 1: orquestra apenas a boot sequence e o palco do desktop.
 * Fase 2 e Fase 3 registram seus módulos aqui.
 */

import { BootSequence } from './boot/boot.js';
import { audio } from './core/audio.js';

// Identificador de build: se o console não mostrar esta linha, o navegador
// está servindo uma versão em cache.
const BUILD = '0.2.0';
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

export { boot, audio };
