# Chamada e compartilhamento de tela

Três formas: a barra persistente, a grade de participantes e o modo tela.

> Revisão de 4 de setembro de 2026: `--ember` virou `--live` na troca de
> direção visual — a cor de presença ao vivo passou de âmbar a magenta, o
> papel não mudou. A seção **Câmera** e o ponteiro para
> `13-dispositivos-e-audio.md` são novos, a pedido do dono do projeto.

Aqui o âmbar aparece com força, porque aqui é onde há gente ao vivo. É a
recompensa de ter reservado a cor: quando a chamada começa, a interface esquenta
de verdade.

---

## Barra de chamada

Aparece acima do painel do elenco quando você está conectado. 56px, fundo
`--bg-live`, borda superior de 2px em `--live`.

```
┌──────────────────────────────────┐
│  ◉ Conectado · sala              │
│  ●●○                             │
│  🎤   🎧   📹   🖥   ↗     Sair  │
└──────────────────────────────────┘
```

A borda âmbar é o sinal principal. Ela é a única borda saturada da interface
inteira, e por isso é impossível esquecer que o microfone está aberto.

Primeira linha: ponto âmbar, "Conectado", nome do canal em `--text-secondary`.
Segunda: avatares de 20px de quem está dentro, sobrepostos em -6px.
Terceira: controles de 32px.

| Ícone | Ação | Estado ligado | Estado desligado |
|---|---|---|---|
| 🎤 | microfone | `--text-primary` | `--danger` + barra diagonal |
| 🎧 | áudio | `--text-primary` | `--danger` + barra diagonal |
| 📹 | câmera | `--live` quando ativa | `--text-secondary` |
| 🖥 | tela | `--live` quando ativo | `--text-secondary` |
| ↗ | expandir | — | — |

Desligado nunca é indicado só por cor. A barra diagonal cobre daltonismo e
funciona em qualquer contraste.

"Sair" em `--danger`, texto, sem ícone. Ação destrutiva com rótulo explícito.

### Qualidade da conexão

Um indicador de três barras à direita do nome do canal. Verde, âmbar, vermelho,
conforme o `ConnectionQuality` do LiveKit. Hover mostra latência e perda de
pacote.

Em qualidade ruim, uma linha discreta: "Conexão instável. O vídeo foi reduzido."
Explicar por que a imagem piorou evita que a pessoa culpe o produto.

---

## Grade de participantes

Expande em sobreposição sobre a conversa, não em janela nova.

```
┌───────────────────────────────────────────────────┐
│  sala · 4 pessoas                          ⤡  ✕   │
├───────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐               │
│  │              │  │              │               │
│  │      ◉       │  │   [ vídeo ]  │               │
│  │              │  │              │               │
│  │ Ana      🎤  │  │ Bruno        │               │
│  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐  ┌──────────────┐               │
│  │      ◉       │  │      ◉       │               │
│  │ Carla    🔇  │  │ Você         │               │
│  └──────────────┘  └──────────────┘               │
├───────────────────────────────────────────────────┤
│      🎤    🎧    📹    🖥            Sair          │
└───────────────────────────────────────────────────┘
```

Grade automática: 1 pessoa ocupa tudo; 2 lado a lado; 3 e 4 em 2×2; 5 em 3+2.
Proporção 16:9, `gap: 8px`.

Sem câmera, o cartão mostra o avatar de 80px centralizado sobre `--bg-raised`.

### Quem está falando

Borda de 2px em `--live` no cartão de quem fala, entrando em 120ms e saindo em
400ms.

A assimetria é essencial. Entrada rápida acompanha a voz; saída lenta absorve as
pausas naturais da fala. Com tempos iguais, quatro pessoas conversando produzem
um efeito estroboscópico insuportável.

Não anime a cada frame de áudio. Use o `ActiveSpeakersChanged` do LiveKit, que já
vem com histerese.

Silenciado: ícone de microfone cortado no canto do cartão, em `--danger`.

### Controles

Barra inferior, 56px, botões redondos de 44px. Estado ligado com fundo
`--bg-active`; desligado com fundo `--crimson-wash` e ícone `--danger`.

"Sair" é uma pílula em `--danger`, à direita, separada dos demais. Distância
física evita clique acidental.

---

## Câmera

Desligada ao entrar, sempre. Ao contrário do microfone, que entra aberto porque
a borda magenta torna o estado impossível de ignorar, a câmera não tem sinal
equivalente e o custo do engano é de outra ordem.

O botão 📹 liga e desliga. Ligar pede a permissão **naquele momento** — entrar
numa chamada de voz nunca acende a luz da câmera (`docs/07-permissoes-do-navegador.md`).

O dispositivo, a resolução e o espelhamento da prévia ficam em
`13-dispositivos-e-audio.md`. Aqui só o que aparece durante a chamada:

- **A sua imagem é espelhada só para você.** A trilha publicada não é.
- **Sem câmera, o cartão não é um retângulo preto** — é o avatar de 80px sobre
  `--bg-raised`, exatamente como já está na grade. Vídeo desligado e vídeo
  travado precisam ser distinguíveis de relance.
- Quem desliga a câmera no meio some do vídeo sem sair da grade: o cartão
  permanece, a imagem dá lugar ao avatar em 200ms.
- A câmera cai sozinha se a trilha morrer (`track.onended` — dispositivo
  removido, outro programa tomou o aparelho). O botão sincroniza e um toast
  diz o que aconteceu. Ficar com o botão aceso e a imagem congelada é pior que
  desligar.

Com tela compartilhada e câmera ao mesmo tempo, a câmera vai para a fileira
lateral de 160px junto com os outros participantes. A tela é o assunto; o rosto
é o comentário.

---

## Compartilhamento de tela

Especificado por inteiro em `12-compartilhamento-de-tela.md`. Em resumo: seis
presets de qualidade até 1440p60 e 4K30, assistir é opcional e cada espectador
controla a própria qualidade, simulcast em três camadas, janela flutuante,
zoom, apontador e áudio do sistema como trilha separada.

Quando alguém transmite, o layout muda: a transmissão ocupa o espaço principal
e os participantes viram uma fileira lateral de 160px. `object-fit: contain`
sobre `--void`, nunca `cover`.

## Dispositivos e áudio

Qual microfone, qual alto-falante, qual câmera, ganho de entrada, medidor,
perfil de captura, limiar de sensibilidade, apertar para falar e os sons:
tudo em `13-dispositivos-e-audio.md`.

O caminho até lá sai do controle que falhou, não do menu: botão direito no
ícone de microfone da barra, ou a seta ao lado dele.

---

## Entrar e sair

Clique num canal de voz conecta direto, sem tela de pré-visualização. Com cinco
pessoas conhecidas, uma antessala é cerimônia desnecessária.

O microfone entra **aberto**. Isso é uma escolha: entrar mudo produz o "você está
no mudo" a cada conversa. O estado é impossível de ignorar por causa da borda
âmbar, o que torna o padrão seguro.

Som de entrada e saída, curtos, discretos, desligáveis nas configurações.
Distintos entre si — subindo para entrar, descendo para sair — para você saber o
que aconteceu sem olhar.

Sair não pede confirmação.

---

## Quem não está na chamada

Quem está fora precisa ver que existe algo acontecendo, sem ser interrompido.

O canal de voz na lista mostra os avatares dentro, com anel âmbar em quem fala.
Isso é suficiente: a informação está disponível de relance e não exige ação.

Sem notificação de "fulano entrou na chamada". Numa equipe de cinco, isso
dispararia o dia inteiro.

---

## Estados

| Situação | Interface |
|---|---|
| conectando | barra com "Conectando…" e pulso lento em `--magenta-wash` |
| reconectando | "Reconectando…" em `--live`, controles desabilitados |
| falhou | "Não foi possível conectar" + [ Tentar de novo ] |
| sem permissão de mídia | explica como liberar no navegador, com o passo real |
| sozinho | "Você está sozinho na sala" no centro, tom neutro |

Permissão negada é o erro mais comum e o pior de resolver. Não diga "permissão
negada" — diga onde clicar:

> O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e
> permita o acesso.

---

## Acessibilidade

- Todo controle é alcançável por teclado, com `aria-pressed` no estado.
- Entrada e saída de participante anunciadas em `aria-live="polite"`.
- Quem está falando não é indicado apenas por cor: o cartão também recebe
  `aria-label` com "falando".
- `prefers-reduced-motion` desliga o pulso de conexão e as transições de borda —
  a cor muda sem animação.
- Legenda ao vivo fica fora da v1, mas o gancho existe: o LiveKit entrega as
  trilhas de áudio separadas por participante, o que é o pré-requisito.
