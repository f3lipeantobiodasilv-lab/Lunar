Você é um Engenheiro de Software Sênior especialista em Frontend e interfaces de sistemas operacionais. Vamos construir a primeira DEMO totalmente funcional do meu Web OS chamado "Lunar".

Siga estritamente as regras de arquitetura e o fluxo de desenvolvimento abaixo. Não pule etapas. Trabalhe em FASES e aguarde minha aprovação explícita ao final de cada uma antes de avançar para a próxima.

### 🛠️ REGRAS DE ARQUITETURA E DESEMPENHO:

1. Imagens Reais: Apenas duas imagens reais (.png) existem no projeto: 'lunar-logo.png' (logo base) e 'lunar-boot.png' (sua logo inclinada 3D). Nenhuma outra imagem externa deve ser carregada.

2. Papéis de parede e Interface Visual: Devem ser gerados programaticamente em tempo real usando a API de Canvas do HTML5 ou propriedades avançadas de CSS (Glassmorphism/Blurs).

3. Efeitos Sonoros (Sons de Boot/UI): Devem ser gerados AUTOMATICAMENTE através do processador de áudio nativo do navegador via Web Audio API. Não utilize arquivos .mp3 ou .wav externos.

4. Tipografia: Use a fonte 'Plus Jakarta Sans' carregada via Google Fonts.

5. Dados Temporários e Testes: Qualquer sistema de arquivos virtual (VFS), estados de janelas abertas, logs ou arquivos criados na demo devem rodar exclusivamente em memória dinâmica (arrays/objetos JS locais) ou em uma estrutura simulada e isolada 'tmp/'. Nada deve persistir fora da sessão de teste atual sem permissão.

---

### 📋 CRONOGRAMA DE DESENVOLVIMENTO EM FASES

FASE 1: Tela de Boot e Inicialização (Aguardando Aprovação)

- Crie uma tela preta profunda (#09090b).

- Centralize a logo 'lunar-boot.png' com um efeito suave de fade-in.

- Renderize um Canvas ao redor/abaixo da logo que desenha de forma minimalista a geometria de uma "Lua Cheia" se completando conforme o progresso do carregamento atinge 100%.

- Quando chegar a 100%, execute o som de boot sintetizado via Web Audio API (acorde crescente futurista e limpo).

- Após o som, faça a tela de boot sumir com um fade-out elegante para revelar a área de trabalho.

- [PARE AQUI] Escreva o código completo desta fase, explique brevemente e diga: "Fase 1 concluída. Aguardando sua aprovação para a Fase 2."

FASE 2: Ambiente Desktop e Barra de Tarefas (Apenas após aprovação da Fase 1)

- Renderize o papel de parede dinâmico via Canvas no fundo.

- Crie uma barra de tarefas inferior com efeito de vidro fosco (backdrop-filter: blur).

- Adicione o botão "Iniciar" usando a imagem 'lunar-logo.png'.

- Crie um relógio digital atualizado em tempo real na lateral direita da barra usando a fonte Plus Jakarta Sans.

- [PARE AQUI] Aguarde aprovação.

FASE 3: Gerenciador de Janelas e App Nativo (Apenas após aprovação da Fase 2)

- Crie o "Motor de Janelas" em JavaScript (permitir abrir, fechar e arrastar pela tela).

- Crie o primeiro aplicativo funcional rodando dentro de uma janela: Um "Terminal de Linha de Comando" simplificado onde o usuário pode interagir com o sistema de arquivos simulado em 'tmp/'.

---

Por favor, inicie a FASE 1 agora. Não escreva código para as fases 2 e 3 ainda. Aguarde meu feedback para avançar.
