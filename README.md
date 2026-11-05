# Lunar OS

Web OS construído em fases. Esta entrega contém a **Fase 1: tela de boot e inicialização**.

![Fluxo de boot](docs/boot-preview.png)

> **Cache:** o servidor envia `Cache-Control: no-store`, o HTML referencia CSS/JS com `?v=0.2.4`
> e a página se auto-atualiza: ela compara a própria versão com `/version.json` (exposto pelo
> `server.mjs` a partir do `package.json`) e recarrega uma única vez se estiver velha.
> O rodapé mostra `demo 0.2.4` e o console imprime `Lunar OS · build 0.2.4`.

---

## Rodar

O projeto usa ES Modules, então precisa de um servidor HTTP (abrir `index.html` com `file://` não funciona).

```bash
npm start          # http://localhost:3000
# ou
PORT=8080 node server.mjs
```

Não há dependências: `server.mjs` é um servidor estático de ~70 linhas, escrito só com a biblioteca padrão do Node.

---

## Como a Fase 1 funciona

| Requisito | Implementação |
| --- | --- |
| Fundo preto absoluto | `background-color: #000` em `.boot` (sem gradiente, aura ou grão) |
| Apenas o ícone, centralizado, com fade-in | `.boot__logo` — fade de 1,6 s + micro-escala, orquestrado pela classe `.is-entered` |
| Bolinhas girando (padrão Windows) no lugar da barra | `.boot__dots` em `src/css/boot.css` (CSS puro, 8 pontos) |
| Som de boot em Web Audio API | `AudioEngine.playBootSequence()` em `src/js/core/audio.js` |
| Fade-out elegante para o desktop | `.boot.is-leaving` → `.boot.is-gone`, com `.desktop.is-visible` entrando junto |
| Fonte Plus Jakarta Sans | `src/css/fonts.css` (arquivos `.woff2` locais, SIL OFL) |

### As bolinhas girando

Implementadas em **CSS puro**, sem canvas e sem imagem. São 8 `<span>` com a mesma
animação e um `animation-delay` diferente por ponto (`-1500ms ÷ 8 × --i`), de modo que
num mesmo instante cada ponto está numa fase distinta do ciclo — essa defasagem é o que
cria o rastro.

**Duas animações por ponto, ambas no compositor:**

| Animação | O que faz | Propriedade |
| --- | --- | --- |
| `dotOrbit` | percorre a elipse do anel, crescendo ao passar pela frente e encolhendo ao voltar | `transform` |
| `dotBrightness` | sobe rápido (~375 ms) até o pico e decai devagar, formando líder + cauda | `opacity` |

A órbita aplica `scaleY(0.62)` antes do `rotate`: o anel vira uma elipse e cada ponto
encolhe no fundo e cresce na frente, o que dá a leitura 3D (anel inclinado girando).

#### Perspectiva: por que as bolinhas pareciam "chapadas no chão"

A primeira tentativa de 3D inclinou o plano do anel com `rotateX(58deg)`. O
resultado foi pior que o original: a rotação 3D achatava o **próprio ponto**
— cada bolinha virava uma elipse fina, como uma moeda vista de lado.

Hoje a perspectiva não vem de rotação: o ponto é posicionado direto na elipse
(`x = R·sen θ`, `y = −R·cos θ`) e recebe **escala e opacidade próprias** —
menor e mais apagado no alto (fundo do anel), maior e mais claro embaixo
(frente). O ponto permanece circular. São 16 paradas no keyframe, porque com
4 a interpolação do `translate` corta os cantos e o percurso vira um losango.

O visual de esfera vem do gradiente radial com realce fora do centro
(`circle at 34% 26%`) mais uma sombra interna na base — um gradiente
centralizado lia como adesivo.

#### Cinco armadilhas que já quebraram esta animação

1. **Faixas de 12,5% em `steps`.** A primeira versão do rastro usava 8
   patamares de opacidade seguidos de salto; medido quadro a quadro, o brilho
   ficava 6 amostras idêntico e então pulava. A correção é interpolar a curva.
2. **Rotação de 0° a 360°.** São o mesmo ponto: um keyframe com só `0%` e
   `100%` não gira. Passos intermediários forçam o avanço.
3. **Somar o ângulo duas vezes.** O deslocamento de cada ponto já vem do
   `animation-delay`; somar também `rotate(var(--i) * 45deg)` no keyframe fazia
   o ponto 4 cair sobre o 0 e o anel ficava com 4 posições.
4. **Sinal do `animation-delay`.** Com atraso negativo, a cauda aparece na
   frente do líder e o conjunto lê como uma cobra girando ao contrário do
   próprio movimento. O atraso é positivo: cada ponto entra depois do vizinho,
   e com a órbita no sentido anti-horário o líder fica à frente da cauda.
5. **Cauda que não desaparece.** Se a opacidade mínima da curva não chega perto
   de zero, os 8 pontos ficam todos acesos e formam um anel em vez de um
   rastro. A curva atual termina em `0.02`.

#### Custo por quadro

O desfoque de profundidade (`filter: blur()`) animado foi removido: como `filter` não é
composto, ele repinta os 8 elementos a cada quadro. Medição no navegador real, tela de
900×620: **22 fps com `filter`, 60 fps estáveis sem ele**. A profundidade hoje é feita só
por escala e opacidade.

#### Encerramento

Ao completar, a órbita é congelada e o anel inteiro acende (0,95) antes de dissolver no
fade-out. O atalho `animation` **zera** o `animation-delay`; sem redeclarar o delay nessa
regra, os 8 pontos empilham no centro e viram um único blob.

Com `prefers-reduced-motion` ativo (o "Efeitos de animação" desligado no Windows) a regra
global de acessibilidade zera a duração de **todas** as animações — o anel ficaria
estático e uniforme, parecendo travado. As bolinhas reativam a própria animação com
`!important`, em ritmo 2× mais lento, mantendo o rastro.

### Escala fluida (mobile → monitor grande)

Nenhum breakpoint redimensiona o layout em saltos: cada medida é um `clamp()` contínuo
sobre `vmin`/`vw`.

| Elemento | Regra |
| --- | --- |
| Logo | `width: clamp(132px, 28vmin, 264px)` |
| Anel | `--ring: clamp(58px, 12.5vmin, 118px)` — sempre ~45% do logo |
| Ponto | `calc(var(--ring) * 0.185)` |

Duas faixas ajustam a proporção quando a **altura** aperta, para logo + anel + texto
continuarem cabendo sem colisão: `max-height: 620px` e `max-height: 460px` (esta também
achata menos o anel, `--flat-y: 0.8`, para o texto não encostar nos pontos).

Verificado em 13 telas, de 320×568 a 2560×1440, sem sobreposição e com a proporção
anel/logo constante em 0,45.

### O boot não depende de `requestAnimationFrame`

Esta foi a causa de a tela ficar travada em "Iniciando" e só destravar no botão *Pular*: o boot inteiro (progresso, troca de mensagens, conclusão) rodava dentro de um laço de `requestAnimationFrame`, e o próprio `main.js` iniciava a sequência dentro de um rAF. Em abas em segundo plano, **iframes não visíveis** e com throttling, o rAF pode simplesmente nunca disparar.

Hoje:

- `main.js` inicia com `setTimeout(0)`;
- o progresso é dirigido por `setTimeout(90ms)` e por `performance.now()`, então o tempo real manda;
- a espera por fontes/imagem usa apenas Promises e `setTimeout`;
- `visibilitychange` e `focus` realinham o progresso ao voltar;
- um watchdog de **15 s** chama `skip()` se qualquer coisa travar, então o boot nunca fica preso.

A animação das bolinhas continua sendo CSS, que independe de rAF (e fica pausada quando a aba está oculta, por economia).

### O boot travava em "Pronto" (áudio bloqueado)

O sintoma relatado foi "às vezes demora muito e só aparece Iniciando, sem os
textos de preparando". Reproduzido de forma determinística colocando a página
em segundo plano: o status chegava a **"Pronto"** e a tela **nunca** saía do
boot — nem depois de voltar ao foco.

Causa: sem gesto do usuário, o Chrome bloqueia o autoplay e
`AudioContext.resume()` **não rejeita** — a Promise simplesmente nunca resolve.
O `await this._playBootSound()` em `_complete()` ficava pendurado para sempre,
e a chamada a `_reveal()` que vem depois nunca acontecia. O console registrava
`The AudioContext was not allowed to start`.

Duas correções independentes:

1. `AudioEngine.unlock()` corre `ctx.resume()` contra um prazo de 700 ms, então
   nunca pode ficar pendurado.
2. `_complete()` protege a reprodução do som com um prazo **e** arma um
   temporizador de segurança que revela o desktop de qualquer forma. Nenhuma
   etapa — áudio, fonte ou imagem — consegue mais impedir a saída do boot.

O ritmo também foi encurtado: ~4,9 s no total (era ~6,5 s), e a espera por um
gesto para ouvir o som caiu de 4,2 s para 1,6 s.


### Responsividade

A composição escala em quatro faixas, sempre centralizada e sem sobreposição entre ícone, anel e texto:

| Faixa | Ícone | Anel | Bolinha |
| --- | --- | --- | --- |
| Padrão (≥ 620px de altura) | `clamp(164px, 27vmin, 252px)` | `clamp(64px, 9.5vmin, 92px)` | até 12px |
| Altura ≤ 620px | `clamp(112px, 22vmin, 168px)` | `clamp(50px, 12vmin, 66px)` | até 9px |
| Altura ≤ 460px | `clamp(92px, 18vmin, 128px)` | `clamp(42px, 12vmin, 54px)` | até 7px |
| Largura ≤ 480px | `clamp(112px, 34vw, 168px)` | `clamp(52px, 17vw, 70px)` | até 9px |

Validado em Chromium real nas resoluções 1920×1080, 1440×900, 1280×720, 753×618, 717×442, 1024×400, 390×844 e 360×640: em todas o conteúdo cabe na viewport sem sobrepor e os controles ficam em uma única linha (em telas estreitas o "Som" vira rótulo curto, com o texto completo em `aria-label`).

### O som de boot

Sintetizado no momento do clique final, em quatro camadas:

| Camada | Detalhe |
| --- | --- |
| Pad ascendente | Tríade Dó maior (C3–G3–C4), triângulo, com glissando curto para cima |
| Arpejo | C4–E4–G4–D5 (Dó maior add9) em senoides, entrando a cada 105 ms |
| Sino | 1046 / 1567 / 2093 Hz com decaimento longo |
| Ar | Ruído gerado em buffer, filtro band-pass subindo de 700 Hz a 4,2 kHz |

Um low-pass compartilhado abre de 420 Hz a 5,2 kHz durante o acorde (o som "nasce abafado e termina luminoso") e um compressor segura os picos. Duração total ≈ 2,6 s; o fade-out do boot espera o som terminar.

### Áudio bloqueado (política de autoplay)

Navegadores não deixam tocar áudio antes de um gesto. O fluxo cobre os dois casos:

- **Com gesto** (clique/tecla em qualquer lugar): o áudio é destravado, o acorde toca e a tela revela o desktop.
- **Sem gesto**: o boot chega a 100% e mostra *"Toque na tela para ouvir o som de boot"* com o indicador de som pulsando. O primeiro gesto toca o acorde; se não houver gesto em ~1,6 s, a demo revela o desktop mesmo assim — e há ainda um temporizador de segurança que revela de qualquer forma caso qualquer etapa trave.

Há também o botão **Som** (canto inferior direito) para ligar/desligar, e **ESC** ou **Pular** para ir direto ao fim — nunca a um estado intermediário quebrado.

---

## Estrutura

```
index.html
server.mjs                 # servidor estático sem dependências
assets/
  lunar-boot.png           # logo 3D usada no boot
  lunar-logo.png           # logo base (usada na barra de tarefas, Fase 2)
fonts/                     # Plus Jakarta Sans 200–800 (woff2)
src/css/
  fonts.css  base.css  boot.css  desktop.css
src/js/
  main.js                  # ponto de entrada
  core/ease.js             # curvas e PRNG determinístico
  core/audio.js            # motor de áudio sintetizado
  boot/boot.js             # controlador da sequência de boot
```

`src/js/desktop/` já existe vazio, reservado para as Fases 2 e 3.

---

## Regras do projeto respeitadas

- **Apenas duas imagens reais** (`assets/lunar-boot.png`, `assets/lunar-logo.png`). Papel de parede e demais efeitos são gerados em runtime; as bolinhas do carregamento são CSS puro.
- **Nenhum arquivo de áudio.** Todo som vem de osciladores e buffers da Web Audio API.
- **Nenhuma persistência.** Não há `localStorage`, cookies, IndexedDB ou escrita em disco; todo estado vive em memória. A convenção de `tmp/` está documentada no `.gitignore` para as próximas fases.
- **Tipografia**: Plus Jakarta Sans, com fallback para a pilha do sistema.

---

## Próximas fases

- **Fase 2** — papel de parede dinâmico em Canvas, barra de tarefas com vidro fosco, botão Iniciar com `lunar-logo.png` e relógio em tempo real.
- **Fase 3** — motor de janelas (abrir, fechar, arrastar) e terminal com VFS em memória.

> O desktop atual exibe um cartão com *Repetir boot* e *Testar som do sistema* — andaimes de demonstração para validar a Fase 1; a Fase 2 os substitui pelo ambiente real.
