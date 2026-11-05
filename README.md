# Lunar OS

Web OS construído em fases. Esta entrega contém a **Fase 1: tela de boot e inicialização**.

![Fluxo de boot](docs/boot-preview.png)

> **Cache:** o servidor envia `Cache-Control: no-store` e o HTML referencia CSS/JS com `?v=0.1.3`.
> Se a tela ainda parecer antiga, faça um hard reload (`Ctrl+Shift+R`) — o console deve imprimir
> `Lunar OS · build 0.1.3` e o rodapé mostra `demo 0.1.3`.

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

Implementadas em **CSS puro**, sem canvas e sem imagem:

1. **Anel**: 8 `<span>` posicionados por `--i` (`rotate(45deg * i) translateY(-ring/2)`).
2. **Cauda**: todos rodam o mesmo keyframe de opacidade (`0,16 → 1 → 0,16`), defasado em `-0,14s` por ponto — o resultado é o rastro do carregamento do Windows.
3. **Encerramento**: ao terminar, a animação é trocada por `animation: none` e o anel inteiro acende antes de dissolver junto com o fade-out.

Por que CSS e não canvas: a primeira versão desenhava os pontos numa Canvas 2D. Em navegadores com aceleração de canvas indisponível (driver de vídeo, política de GPU), o canvas ocupava o layout mas não pintava nada — as bolinhas simplesmente não apareciam. Como `transform` e `opacity` rodam no compositor, a versão em CSS não tem essa dependência: foi verificada com `--disable-gpu --disable-accelerated-2d-canvas --disable-software-rasterizer` e renderiza igual.

Com `prefers-reduced-motion` a animação é desligada pela regra global, então os pontos recebem `opacity: 0.85` fixo para não congelarem no frame invisível.

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
- **Sem gesto**: o boot chega a 100% e mostra *"Toque na tela para ouvir o som de boot"* com o indicador de som pulsando. O primeiro gesto toca o acorde; se não houver gesto em ~4 s, a demo revela o desktop mesmo assim (nunca trava).

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
