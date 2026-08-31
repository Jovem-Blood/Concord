# Concord — Design Guide

## 1. Brand concept

Concord é um app pequeno de screen sharing privado para grupos pequenos.
O nome nasceu como uma brincadeira com Discord, então a identidade pode assumir
um posicionamento de “espelho invertido”: familiar, amigável e social, porém mais
leve, mais clean, mais utilitário e menos “plataforma gamer”.

### Brand keywords

- leve
- claro
- confiável
- direto
- amigável
- nítido
- privado
- técnico sem ser frio

### Brand personality

Se o Discord parece uma sala social escura, cheia de energia e presença,
o Concord deve parecer uma sala iluminada, focada, organizada e acolhedora.

### One-line brand statement

> Concord é a sala privada, leve e direta para compartilhar sua tela com amigos.

---

## 2. Visual strategy

A identidade deve evitar duas armadilhas:

1. parecer uma cópia direta do Discord;
2. parecer um template “AI generated” genérico com gradientes excessivos,
   cards sem hierarquia e excesso de glow.

A direção visual deve ser:

- interface limpa;
- contraste bem controlado;
- superfícies suaves;
- poucos efeitos chamativos;
- hierarquia forte;
- tipografia bem resolvida;
- espaçamento consistente;
- uso disciplinado de cor de destaque.

### Aesthetic direction

- “soft tech”
- “calm productivity”
- “modern desktop utility”
- “friendly broadcast control room”

---

## 3. Color system

## 3.1 Core idea

Usar um **colorscheme invertido do espírito do Discord**, não uma inversão matemática literal.

Discord clássico:
- fundo escuro
- indigo/blurple forte
- alto peso visual
- atmosfera noturna

Concord:
- fundo claro
- azul-violeta acinzentado como acento
- superfícies em branco e cinza frio
- atmosfera limpa e luminosa

## 3.2 Primary palette

### Base neutrals

- `--bg`: `#F6F7FB`
- `--bg-elevated`: `#FFFFFF`
- `--bg-subtle`: `#EEF1F7`
- `--bg-muted`: `#E6EAF2`
- `--border`: `#D7DDEA`
- `--border-strong`: `#C3CCDD`

### Text

- `--text`: `#1F2430`
- `--text-soft`: `#4C5568`
- `--text-muted`: `#6F7A90`
- `--text-inverse`: `#FFFFFF`

### Brand accent

- `--brand-50`: `#F1F2FF`
- `--brand-100`: `#E4E7FF`
- `--brand-200`: `#CDD3FF`
- `--brand-300`: `#B1BBFF`
- `--brand-400`: `#8D9BFF`
- `--brand-500`: `#6E80FF`
- `--brand-600`: `#586AE8`
- `--brand-700`: `#4654BF`
- `--brand-800`: `#39439A`

### Semantic colors

- `--success-bg`: `#E9F9EF`
- `--success-fg`: `#1F7A46`
- `--warning-bg`: `#FFF6E8`
- `--warning-fg`: `#9A6500`
- `--danger-bg`: `#FDECEC`
- `--danger-fg`: `#B42318`
- `--danger-strong`: `#E5484D`

### Focus ring

- `--focus`: `rgba(110, 128, 255, 0.35)`

## 3.3 Dark theme (optional)

Se houver modo escuro, ele também deve manter a lógica “invertida”:
não tão pesado quanto Discord, mais fosco e técnico.

- `--bg`: `#0F1218`
- `--bg-elevated`: `#171B23`
- `--bg-subtle`: `#1C2230`
- `--border`: `#2A3242`
- `--text`: `#F2F4F8`
- `--text-soft`: `#C2C8D4`
- `--text-muted`: `#97A1B3`
- `--brand-500`: `#8D9BFF`

---

## 4. Logo direction

## 4.1 Logo concept

A logo não deve tentar replicar mascote, controle ou balão do Discord.

Melhor direção:
- ícone geométrico baseado em **duas formas em diálogo**;
- pode sugerir:
  - duas janelas;
  - duas telas;
  - conexão;
  - “C” aberto;
  - broadcast;
  - “concordância”.

### Good visual metaphors

- duas molduras arredondadas se encontrando;
- um “C” estilizado em forma de monitor;
- duas barras/tiles inclinadas sugerindo ligação;
- um glyph compacto, simples e memorável.

### Avoid

- rostinho de gamepad;
- headset;
- mascote cartunesco;
- símbolo excessivamente parecido com logo do Discord;
- ícone genérico de câmera/webcam.

## 4.2 Wordmark

“Concord” deve usar tipografia:
- limpa;
- levemente arredondada;
- moderna;
- com aparência confiável de software.

Boas qualidades:
- geometria simples;
- ótimo espaçamento;
- peso medium ou semibold;
- sem excesso de personalidade “startup 2021”.

---

## 5. Typography

Objetivo: parecer produto real, não demo de landing page gerada por IA.

### Recommended font stack

Se quiser sistema:
- `Inter`
- `Segoe UI`
- `system-ui`
- `sans-serif`

Se quiser um pouco mais de personalidade:
- `Inter` para UI
- `Sora` ou `Plus Jakarta Sans` apenas para títulos/branding, com moderação

### Type scale

- Display: 32 / 40, weight 700
- H1: 28 / 36, weight 700
- H2: 22 / 30, weight 650
- H3: 18 / 26, weight 650
- Body large: 16 / 24, weight 400
- Body: 14 / 22, weight 400
- Small: 13 / 18, weight 500
- Label: 12 / 16, weight 600, letter-spacing pequena opcional

### Typography rules

- evitar títulos enormes demais;
- evitar muito texto centralizado;
- evitar 4 pesos diferentes na mesma área;
- usar semibold para ações e títulos curtos;
- usar body 14–16px na maior parte da interface.

---

## 6. Layout principles

## 6.1 Core layout philosophy

A interface principal deve parecer um app desktop/web real de colaboração,
não uma landing page.

### Principles

- hierarquia forte;
- grid simples;
- barras funcionais;
- menos decoração, mais estrutura;
- ações principais sempre óbvias;
- densidade moderada.

## 6.2 App shell

Estrutura ideal:

- top bar
- sidebar de participantes / informações da sala
- stage principal para os streams
- action bar clara

### Suggested layout

- Topbar: 64px
- Sidebar: 280px
- Content max width: fluido
- Main padding: 20–24px
- Gap padrão: 16px
- Border radius:
  - cards pequenos: 12px
  - painéis: 16px
  - modal: 20px

---

## 7. UI components

## 7.1 Buttons

### Variants

- Primary
- Secondary
- Tertiary/Ghost
- Danger

### Primary

- fundo `--brand-500`
- texto branco
- hover `--brand-600`
- active `--brand-700`

### Secondary

- fundo `--bg-subtle`
- borda `--border`
- texto `--text`

### Ghost

- fundo transparente
- hover leve com `--bg-subtle`

### Danger

- fundo `--danger-strong`
- texto branco

### Button style rules

- altura mínima 40px
- padding horizontal 14–16px
- raio 12px
- sem gradiente
- sem sombra forte
- transições sutis

## 7.2 Inputs

- altura ~44px
- fundo branco
- borda cinza suave
- placeholder discreto
- focus ring visível
- erro com borda e mensagem sem exagero

## 7.3 Cards / panels

- fundo branco
- borda 1px suave
- sombra muito leve
- padding confortável
- títulos compactos

## 7.4 Modal

O source picker deve parecer ferramenta séria, não popup cenográfico.

- cabeçalho claro
- grid de fontes bem alinhado
- ações no rodapé
- opção de qualidade e áudio com explicações curtas
- thumbnails mais valorizadas
- estados loading/empty mais elegantes

---

## 8. Media experience

## 8.1 Stage

A área de streams é o centro do produto.

Ela precisa:
- parecer importante;
- ter bom contraste;
- maximizar foco no conteúdo;
- manter chrome mínimo.

### Rules

- tiles maiores;
- bordas suaves;
- fundo da stage um pouco mais escuro ou neutro que a UI ao redor;
- labels discretas sobre os vídeos;
- menos ornamentos.

## 8.2 Stream tiles

- raio 16px
- fundo neutro escuro quando sem vídeo
- overlay inferior com nome do participante
- badges pequenas para:
  - compartilhando áudio
  - você
  - preview local

### Avoid

- muita informação dentro do tile;
- bordas excessivamente grossas;
- glow roxo;
- carinha “dashboard NFT”.

---

## 9. Motion

Motion deve ser curta, útil e discreta.

### Use

- fade/slide curto em modais;
- hover suave;
- foco com feedback claro;
- transição de layout ao focar stream.

### Avoid

- bounce
- overshoot exagerado
- parallax
- shimmer gratuito
- animações “AI SaaS landing page”

Recommended:
- duration 120–180ms microinterações
- 180–240ms modais
- easing suave, sem teatralidade

---

## 10. Iconography

- simples
- outline ou duotone leve
- cantos arredondados
- consistência de stroke

Ícones sugeridos:
- monitor
- janela
- link
- usuários
- áudio
- copiar
- sair
- foco/maximizar

Evitar pack visualmente muito “corporate enterprise”.
Lucide é uma boa direção.

---

## 11. Brand voice in UI copy

A cópia deve soar humana, direta e calma.

### Tone

- clara
- curta
- segura
- sem excesso de entusiasmo
- amigável sem parecer marketing

### Good examples

- “Entre e compartilhe.”
- “Sua sala privada para mostrar a tela.”
- “Escolha uma janela ou monitor.”
- “Ninguém está compartilhando ainda.”
- “A conexão caiu. Tentando reconectar.”

### Avoid

- “Supercharge your collaboration”
- “Seamless AI-powered sharing experience”
- “Broadcast effortlessly in seconds”

---

## 12. Make it feel less AI-generated

## 12.1 Common AI-looking problems

- gradientes em excesso;
- brilho/glow em tudo;
- cards sem função;
- elementos “bonitos” mas sem hierarquia;
- textos genéricos de startup;
- cantos arredondados demais em tudo;
- inconsistência de espaçamento;
- tela muito vazia com elementos gigantes;
- ilustrações abstratas desnecessárias.

## 12.2 Anti-AI heuristics

- cada bloco deve ter propósito claro;
- reduzir marketing visual e aumentar estrutura;
- usar mais alinhamento do que efeito;
- no máximo 1 cor de destaque dominante;
- sombras quase invisíveis;
- tipografia mais madura;
- labels e microcopy mais específicas;
- menos gimmick, mais produto.

---

## 13. Accessibility

- contraste AA no mínimo;
- focus visível em todos os controles;
- navegação por teclado nos modais;
- `aria-label` onde necessário;
- targets de clique confortáveis;
- estados disabled claramente distinguíveis;
- cores sem depender exclusivamente de matiz.

---

## 14. Practical UI recommendations for Concord

## Welcome screen

Hoje deve evoluir para:
- branding mais forte;
- menos “hero genérico”;
- foco em ação;
- campos bem proporcionados;
- melhor separação entre criar e entrar.

### Content structure

- logo
- nome do produto
- tagline curta
- input nome
- ação primária: criar sala
- separador
- input código + entrar

## App screen

Melhorar:
- topbar menos genérica;
- sidebar com bloco de sala e bloco de participantes;
- stage mais cinematográfica;
- actions mais claras;
- badges mais refinadas;
- estados vazios mais elegantes.

## Source picker

Deve parecer um seletor premium de captura:
- thumbnails maiores;
- tabs ou filtro visual entre monitor e janela, se fizer sentido;
- explicação do áudio mais curta;
- perfis de qualidade com melhor visual;
- hierarquia mais limpa.

---

## 15. Suggested design tokens

```css
:root {
  --bg: #F6F7FB;
  --bg-elevated: #FFFFFF;
  --bg-subtle: #EEF1F7;
  --bg-muted: #E6EAF2;

  --border: #D7DDEA;
  --border-strong: #C3CCDD;

  --text: #1F2430;
  --text-soft: #4C5568;
  --text-muted: #6F7A90;
  --text-inverse: #FFFFFF;

  --brand-50: #F1F2FF;
  --brand-100: #E4E7FF;
  --brand-200: #CDD3FF;
  --brand-300: #B1BBFF;
  --brand-400: #8D9BFF;
  --brand-500: #6E80FF;
  --brand-600: #586AE8;
  --brand-700: #4654BF;
  --brand-800: #39439A;

  --success-bg: #E9F9EF;
  --success-fg: #1F7A46;
  --warning-bg: #FFF6E8;
  --warning-fg: #9A6500;
  --danger-bg: #FDECEC;
  --danger-fg: #B42318;
  --danger-strong: #E5484D;

  --focus: rgba(110, 128, 255, 0.35);

  --radius-sm: 10px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;

  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);
  --shadow-md: 0 8px 24px rgba(16, 24, 40, 0.06);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
