/**
 * Lunar OS — FASE 2
 * Catálogo de aplicativos e ações do sistema.
 *
 * Um único lugar descreve TUDO que aparece no menu Iniciar e na barra de
 * tarefas: nome, descrição, ícone, cor de destaque e em que fase o app fica
 * disponível de verdade. A Fase 3 (motor de janelas + terminal com VFS) só
 * precisa trocar `phase` e registrar o construtor da janela aqui; nada de
 * mexer em layout ou em busca.
 *
 * `keywords` existe porque a busca precisa ser tolerante: ninguém digita
 * "configurações" com acento no celular.
 */

/**
 * Ícones desenhados inline (SVG, sem arquivo de imagem): traço de 1.6px,
 * `currentColor`, grade de 24×24. Ficam consistentes em qualquer tamanho e
 * herdam a cor do botão — nenhum PNG novo entra no projeto.
 */
export const ICONS = {
  files: `
    <path d="M3 8.2A2.2 2.2 0 0 1 5.2 6h3.3c.6 0 1.1.2 1.5.6l1.2 1.2h7.6A2.2 2.2 0 0 1 21 10v6.8A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z"/>
    <path d="M3 11.4h18"/>`,
  terminal: `
    <rect x="3" y="4.5" width="18" height="15" rx="3"/>
    <path d="M7.5 9.5 10.5 12l-3 2.5"/>
    <path d="M12.5 15h4"/>`,
  notes: `
    <path d="M6 3.5h7.4L18 8.1v12.4H6z"/>
    <path d="M13.2 3.6V8.3H18"/>
    <path d="M9 12h6"/><path d="M9 15.5h4"/>`,
  settings: `
    <circle cx="12" cy="12" r="3.1"/>
    <path d="M12 3.2v2.1M12 18.7v2.1M4.8 7.9l1.8 1M17.4 15.1l1.8 1M4.8 16.1l1.8-1M17.4 8.9l1.8-1"/>`,
  calculator: `
    <rect x="5" y="3.5" width="14" height="17" rx="2.4"/>
    <path d="M8.4 7.6h7.2"/>
    <circle cx="9.2" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="14.8" cy="12" r=".9"/>
    <circle cx="9.2" cy="15.7" r=".9"/><circle cx="12" cy="15.7" r=".9"/><circle cx="14.8" cy="15.7" r=".9"/>`,
  calendar: `
    <rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4"/>
    <path d="M3.6 10.2h16.8"/>
    <path d="M8.4 3.4v3.4M15.6 3.4v3.4"/>
    <path d="M7.8 13.8h2M11 13.8h2M14.2 13.8h2M7.8 17h2M11 17h2"/>`,
  music: `
    <circle cx="7.4" cy="17.2" r="2.6"/>
    <circle cx="17.2" cy="15.4" r="2.6"/>
    <path d="M10 17.2V6.6l9.8-2v10.8"/>`,
  gallery: `
    <rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.6"/>
    <circle cx="8.6" cy="9.6" r="1.5"/>
    <path d="M4.2 16.8 9.4 12l3.4 3.2 2.6-2.4 4.4 4"/>`,
  browser: `
    <circle cx="12" cy="12" r="8.2"/>
    <path d="M3.8 12h16.4"/>
    <path d="M12 3.8c2.3 2.3 3.4 5.1 3.4 8.2s-1.1 5.9-3.4 8.2c-2.3-2.3-3.4-5.1-3.4-8.2S9.7 6.1 12 3.8z"/>`,
  clock: `
    <circle cx="12" cy="12" r="8.2"/>
    <path d="M12 7.4V12l3.2 1.9"/>`,
  trash: `
    <path d="M4.6 6.8h14.8"/>
    <path d="M9.4 6.8V4.6h5.2v2.2"/>
    <path d="M6.6 6.8 7.7 19.4h8.6l1.1-12.6"/>
    <path d="M10.4 10.6v5.4M13.6 10.6v5.4"/>`,
  search: `
    <circle cx="11" cy="11" r="6.4"/>
    <path d="m15.8 15.8 4.2 4.2"/>`,
  sparkle: `
    <path d="M12 3.6l1.7 4.9 4.9 1.7-4.9 1.7L12 16.8l-1.7-4.9-4.9-1.7 4.9-1.7z"/>
    <path d="M18.4 15.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>`,
  power: `
    <path d="M12 3.6v7"/>
    <path d="M7.4 6.6a7.4 7.4 0 1 0 9.2 0"/>`,
  volume: `
    <path d="M4.6 9.6h3L12 5.8v12.4l-4.4-3.8h-3z"/>
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6"/>
    <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  volumeOff: `
    <path d="M4.6 9.6h3L12 5.8v12.4l-4.4-3.8h-3z"/>
    <path d="m16 9.6 5 4.8M21 9.6l-5 4.8"/>`,
  refresh: `
    <path d="M20 12a8 8 0 1 1-2.6-5.9"/>
    <path d="M20.4 4.4v4.2h-4.2"/>`,
  moon: `
    <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4 8.6 8.6 0 1 0 20 14.4z"/>`,
};

/**
 * `phase`: em que fase o app ganha janela de verdade.
 *   2 → já funciona nesta entrega (o papel de parede, por exemplo);
 *   3 → motor de janelas (próxima fase);
 *   4 → planejado.
 * `tone` alimenta o gradiente do bloco de ícone (nada de imagem).
 */
export const APPS = [
  {
    id: 'files',
    name: 'Arquivos',
    hint: 'Navegue pelo sistema de arquivos em memória',
    icon: 'files',
    phase: 3,
    tone: ['#8b95ff', '#4f5bd5'],
    keywords: 'arquivos pastas explorer disco vfs',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    hint: 'Shell com VFS em memória e comandos do Lunar',
    icon: 'terminal',
    phase: 3,
    tone: ['#6ee7f0', '#2b8f9b'],
    keywords: 'terminal shell console comandos bash cli',
  },
  {
    id: 'notes',
    name: 'Notas',
    hint: 'Bloco de notas rápido, sem gravar em disco',
    icon: 'notes',
    phase: 3,
    tone: ['#ffd479', '#c98f2b'],
    keywords: 'notas texto escrever bloco rascunho',
  },
  {
    id: 'settings',
    name: 'Configurações',
    hint: 'Aparência, som e movimento do sistema',
    icon: 'settings',
    phase: 3,
    tone: ['#b7bfd8', '#6b7590'],
    keywords: 'configuracoes ajustes preferencias tema som',
  },
  {
    id: 'calculator',
    name: 'Calculadora',
    hint: 'Cálculo básico com teclado',
    icon: 'calculator',
    phase: 3,
    tone: ['#9c8bff', '#5b3fd0'],
    keywords: 'calculadora contas matematica somar dividir',
  },
  {
    id: 'calendar',
    name: 'Calendário',
    hint: 'Visão mensal do ano corrente',
    icon: 'calendar',
    phase: 3,
    tone: ['#7ce0b1', '#2f8f6a'],
    keywords: 'calendario datas agenda mes ano',
  },
  {
    id: 'music',
    name: 'Música',
    hint: 'Sons sintetizados — nenhum arquivo de áudio',
    icon: 'music',
    phase: 3,
    tone: ['#f898c7', '#b93f7a'],
    keywords: 'musica player som audio sintetizador',
  },
  {
    id: 'gallery',
    name: 'Galeria',
    hint: 'Imagens geradas em runtime',
    icon: 'gallery',
    phase: 4,
    tone: ['#7fb8ff', '#2f66b3'],
    keywords: 'galeria fotos imagens album',
  },
  {
    id: 'browser',
    name: 'Navegador',
    hint: 'Navegação dentro do lunar://',
    icon: 'browser',
    phase: 4,
    tone: ['#8de0ff', '#2d7fa8'],
    keywords: 'navegador browser internet web site',
  },
  {
    id: 'clock',
    name: 'Relógio',
    hint: 'Hora, data e cronômetro',
    icon: 'clock',
    phase: 3,
    tone: ['#c9d0e4', '#6f7891'],
    keywords: 'relogio hora data cronometro timer',
  },
  {
    id: 'trash',
    name: 'Lixeira',
    hint: 'Itens removidos do VFS',
    icon: 'trash',
    phase: 3,
    tone: ['#a9b0c2', '#5c6376'],
    keywords: 'lixeira trash deletados remover',
  },
  {
    id: 'about',
    name: 'Sobre o Lunar',
    hint: 'Fases, regras do projeto e créditos',
    icon: 'moon',
    phase: 2,
    tone: ['#e9e9ef', '#8d94ad'],
    keywords: 'sobre lunar versao creditos fase info',
  },
];

/** Apps fixados na barra de tarefas, na ordem em que aparecem. */
export const PINNED = ['files', 'terminal', 'notes', 'settings'];

/** Ações do sistema (entram na busca com o mesmo peso dos apps). */
export const ACTIONS = [
  {
    id: 'wallpaper',
    name: 'Regerar papel de parede',
    hint: 'Sorteia outra lua, outro campo de estrelas e outra aurora',
    icon: 'sparkle',
    phase: 2,
    tone: ['#8b95ff', '#5b3fd0'],
    keywords: 'papel de parede wallpaper fundo aleatorio sortear aura estrelas lua',
  },
  {
    id: 'sound',
    name: 'Alternar som do sistema',
    hint: 'Liga ou desliga todos os sons sintetizados',
    icon: 'volume',
    phase: 2,
    tone: ['#7ce0b1', '#2f8f6a'],
    keywords: 'som audio mudo mute volume ligar desligar',
  },
  {
    id: 'replay',
    name: 'Repetir boot',
    hint: 'Volta à tela de inicialização',
    icon: 'refresh',
    phase: 2,
    tone: ['#c9d0e4', '#6f7891'],
    keywords: 'boot reiniciar repetir reinicio startup',
  },
];

export const allEntries = () => [...APPS, ...ACTIONS];

/** Remove acentos e caixa para a busca não depender de digitação perfeita. */
export const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Busca por nome, dica e palavras-chave.
 * Pontua melhor quem começa com o termo, depois quem o contém — assim
 * "term" acha Terminal antes de "Sistema de arquivos" mencionar terminal.
 */
export function searchEntries(query, limit = 8) {
  const term = normalize(query);
  if (!term) return [];

  const scored = [];
  for (const entry of allEntries()) {
    const name = normalize(entry.name);
    const hint = normalize(entry.hint);
    const keys = normalize(entry.keywords);

    let score = 0;
    if (name === term) score = 100;
    else if (name.startsWith(term)) score = 80;
    else if (name.includes(term)) score = 60;
    else if (keys.split(' ').some((word) => word.startsWith(term))) score = 45;
    else if (keys.includes(term)) score = 35;
    else if (hint.includes(term)) score = 20;

    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, 'pt-BR'))
    .slice(0, limit)
    .map((item) => item.entry);
}
