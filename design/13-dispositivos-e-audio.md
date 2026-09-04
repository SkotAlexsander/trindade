# Dispositivos, áudio e câmera

> Acrescentado em 4 de setembro de 2026, a pedido do dono do projeto, a partir
> de uma referência do Discord. Cobre o que `07-chamada.md` deixou implícito:
> **qual** microfone, **qual** alto-falante, **qual** câmera, e o que acontece
> com o som entre o dispositivo e a rede.

A chamada em si está em `07-chamada.md`. A transmissão de tela em
`12-compartilhamento-de-tela.md`. Este documento é a camada de baixo dos três.

---

## Onde mora

Configurações › **Voz e vídeo**. Painel de 640px, mesma moldura de diálogo do
perfil.

Também alcançável por dois caminhos que importam mais que o menu:

- clique com o botão direito no ícone de microfone da barra de chamada
- a seta ao lado do botão de microfone, quando conectado

Ninguém abre configurações no meio de uma chamada por vontade própria. Abre
porque não está sendo ouvido. O caminho tem que sair do próprio controle que
falhou.

---

## Seleção de dispositivo

```
┌─────────────────────────────────────────────────────────────┐
│  MICROFONE                     ALTO-FALANTE                 │
│  ┌───────────────────────┐    ┌───────────────────────┐     │
│  │ 🎤  Logi C270      ▾  │    │ 🎧  Alto-falantes  ▾  │     │
│  └───────────────────────┘    └───────────────────────┘     │
│                                                             │
│  Volume de entrada             Volume de saída              │
│  ●───────────────────          ────────────────●──          │
│                                                             │
│  [ Testar microfone ]  ▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯          │
└─────────────────────────────────────────────────────────────┘
```

Três listas: microfone, alto-falante, câmera. A câmera fica na seção de vídeo,
mais abaixo, porque a maioria das sessões nunca liga a câmera e a lista dela no
topo sugere que ligar é o padrão.

### O rótulo só existe depois da permissão

`enumerateDevices()` antes de qualquer `getUserMedia` devolve a lista com
`label: ''`. Não é erro nem bug de navegador — é privacidade: a lista de
dispositivos é impressão digital.

Então o estado inicial da lista **não** é "nenhum dispositivo". É:

> Permita o acesso ao microfone para ver seus dispositivos.  [ Permitir ]

O botão chama `getUserMedia({ audio: true })`, encerra a trilha em seguida e
chama `enumerateDevices()` de novo. Nunca deixe a trilha de sondagem aberta: a
luz do dispositivo acesa sem chamada nenhuma destrói a confiança.

### Guardar a escolha

`deviceId` é derivado do dispositivo **e** da origem, e é zerado quando a pessoa
limpa os dados do site. Guardar só ele produz a falha clássica: um dia a escolha
some sem explicação.

Guarde os três campos e resolva em cascata:

```ts
type DispositivoSalvo = { deviceId: string; label: string; groupId: string };
// 1. deviceId bate  → usa
// 2. label bate     → usa e regrava o deviceId novo
// 3. nada bate      → 'default', e avisa qual assumiu
```

O caso 3 mostra um toast: "Microfone não encontrado. Usando Logi C270." Trocar
de dispositivo em silêncio é pior que trocar avisando.

### Tirar e pôr no meio da chamada

`navigator.mediaDevices.addEventListener('devicechange', …)`.

| Evento | Comportamento |
|---|---|
| entrou um dispositivo novo | a lista atualiza; **nada troca sozinho** |
| saiu o dispositivo em uso | cai para o próximo pela cascata acima, com toast |
| saiu um que não estava em uso | só a lista atualiza, sem aviso |

Trocar sozinho para o fone que acabou de ser conectado é o comportamento do
sistema operacional, não o nosso. Aqui, quem escolheu escolheu.

### `default` e `communications` no Windows

O Chrome no Windows expõe dois pseudodispositivos além dos reais. Eles são
úteis — seguem a escolha do sistema — e aparecem no topo da lista como
**"Padrão do sistema"**, com os reais abaixo, separados por um traço. Não
esconda: para muita gente é a única opção que funciona sem pensar.

### Escolher a saída não funciona em todo lugar

`setSinkId` não existe em todos os navegadores. Detecte a capacidade, nunca a
versão:

```ts
const podeEscolherSaida = 'setSinkId' in HTMLMediaElement.prototype;
```

Sem ela, a lista de alto-falante aparece **desabilitada com o motivo ao lado**,
nunca escondida:

> Este navegador não permite escolher a saída de áudio. O som segue o
> dispositivo padrão do sistema.

É a mesma regra da tabela de suporte de `12-compartilhamento-de-tela.md`: caixa
desabilitada com o porquê. Sumir com o controle faz a pessoa procurar por ele.

---

## Volume

**Entrada** (0–200%, padrão 100%). Não existe constraint de ganho de captura no
navegador; o controle é um `GainNode` entre a trilha capturada e o que sobe:

```
getUserMedia → MediaStreamAudioSourceNode → GainNode → AnalyserNode
                                                ↓
                        MediaStreamAudioDestinationNode → LiveKit
```

O `AnalyserNode` fica **depois** do ganho, de propósito: o medidor tem que
mostrar o que os outros ouvem, não o que o microfone captou.

Acima de 100% o rótulo fica em `--danger` a partir de 150%, com a nota "pode
distorcer". Permitir e avisar é melhor que travar em 100% — microfone de
notebook barato precisa dos 150%.

**Saída** (0–100%, padrão 100%). Multiplica o volume por participante da grade,
que fica no cartão de cada pessoa. Dois níveis porque o problema real é uma
pessoa baixa e as outras normais, e baixar o volume geral por causa de uma é o
que se faz quando não existe o controle individual.

---

## Testar o microfone

Botão que alterna entre **Testar microfone** e **Parar teste**.

Durante o teste:
- o medidor de 30 barras acende com o RMS da entrada, ~30 quadros por segundo
- o próprio áudio volta pela saída escolhida, sem atraso acrescentado
- se a saída for alto-falante e não fone, avisa: "Use fones para testar sem
  microfonia."

Não é um "grave e ouça depois". A gravação de três segundos parece mais
completa e é pior: a pessoa quer mexer no ganho enquanto fala, e para isso
precisa do retorno agora.

O retorno de áudio fica **desabilitado durante uma chamada**, com o motivo. O
medidor continua funcionando — durante a chamada ele mostra a entrada real, que
é a informação que interessa ali.

### O medidor

Barras de 3px com 2px de espaço, altura 20px. Apagadas em `--line`, acesas em
`--accent`, e as três últimas em `--danger` quando o pico passa de -3 dBFS.

Pico segura por 800ms e cai em 1200ms. Sem a retenção, o pico é rápido demais
para o olho e o medidor vira ruído visual.

---

## Perfil de entrada

Três opções, radio, com a explicação em uma linha embaixo de cada:

| Perfil | Para quê | Constraints |
|---|---|---|
| **Isolamento de voz** | o padrão; corta teclado, ventilador, eco | `echoCancellation`, `noiseSuppression`, `autoGainControl` ligados, mais `voiceIsolation` onde houver |
| **Estúdio** | microfone bom, instrumento, sala tratada | os quatro desligados, `channelCount: 2`, sem gate |
| **Personalizado** | qualquer combinação | as caixas abertas uma a uma |

`voiceIsolation` existe em alguns navegadores e não em outros. Feature-detect
com `navigator.mediaDevices.getSupportedConstraints().voiceIsolation`; sem ele,
o perfil funciona igual, só sem essa camada. Não é caso de erro.

**Não usamos supressão de ruído proprietária.** O que o navegador oferece é
suficiente para cinco pessoas conversando, e a alternativa é embarcar um WASM
de vários megabytes com licença duvidosa numa aplicação auto-hospedada.

Trocar de perfil no meio da chamada recaptura a trilha e a republica. Corta o
áudio por ~200ms. Aceito, e avisado: "Trocando de perfil…" por meio segundo.

---

## Sensibilidade de entrada

Uma chave: **Ajustar automaticamente**. Ligada por padrão.

**Ligada.** O piso de ruído é medido continuamente: mínimo móvel dos últimos 3
segundos, mais 6 dB de margem. Adapta a ventilador que liga, a janela que abre.

**Desligada.** Um slider de limiar desenhado **sobre o medidor**, não ao lado. A
linha vertical mostra exatamente onde o corte cai em relação à sua voz. Um
slider separado do medidor obriga a traduzir número em som, e ninguém faz isso.

```
  ▮▮▮▮▮▮▮▮▮▮▮▮┃▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯
              ↑ limiar
```

Nos dois casos, abaixo do limiar o ganho vai a zero — **em rampa de 40ms, com
250ms de espera antes de fechar.** O corte seco produz um clique audível, e sem
a espera a última sílaba de cada frase é engolida.

O ponto do elenco em `--live` acende com o mesmo sinal. Se o medidor mostra
verde e o ponto não acende, o limiar está alto — e ver os dois juntos é o que
torna isso diagnosticável.

---

## Apertar para falar

Alternativa ao modo por voz, desligada por padrão.

Campo de captura: clique, aperte a tecla, ela aparece. `Esc` cancela.

Um slider de **atraso ao soltar**, 0 a 2s, padrão 200ms. Sem ele, soltar a tecla
no meio da palavra corta a palavra.

> **Só funciona com a janela em foco.** No navegador não existe atalho global —
> por segurança, e é uma boa razão. No aplicativo de mesa (fase 8) funciona com
> a janela atrás, e aí o aviso some.

A frase acima aparece na interface, não só aqui. Descobrir sozinho que a tecla
não funciona quando você está em outro programa é o pior jeito de aprender isso.

---

## Câmera

```
┌─────────────────────────────────────────┐
│  CÂMERA                                 │
│  ┌───────────────────────┐              │
│  │ 📹  Logi C270      ▾  │              │
│  └───────────────────────┘              │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │       [ prévia 16:9 ]           │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│  Qualidade  ( 360p · 720p · 1080p )     │
│  ☑ Espelhar minha prévia                │
└─────────────────────────────────────────┘
```

A prévia só liga quando esta seção está visível, e desliga ao fechar o painel.
A luz da câmera acesa é um contrato: enquanto ela estiver acesa, alguém está
sendo filmado. Não a deixe acesa por conta de um painel esquecido aberto.

**Espelhar vale só para você.** O que sai para os outros nunca é espelhado —
texto ao contrário na camiseta de alguém é o sintoma de quem espelhou a trilha
em vez da apresentação.

Padrão 720p30. 1080p existe e não é o padrão: com cinco câmeras numa grade de
2×2, a diferença entre 720p e 1080p em cartões de 400px é nenhuma, e a diferença
de banda é o dobro.

O `contentHint` é `'motion'` — o oposto do compartilhamento de tela, que usa
`'text'` ou `'detail'` conforme o preset.

Sem desfoque de fundo e sem plano de fundo virtual. Os dois exigem segmentação
por modelo, custam CPU que a chamada precisa, e existe a solução de sempre:
fechar a porta.

---

## Sons

| Som | Quando | Padrão |
|---|---|---|
| entrada | você entra na chamada | ligado, subindo |
| saída | você sai | ligado, descendo |
| alguém entrou | outra pessoa entra | **desligado** |
| alguém saiu | outra pessoa sai | **desligado** |
| microfone mudo/aberto | você alterna | ligado, dois tons curtos |

Os dois do meio vêm desligados. Com cinco pessoas entrando e saindo o dia
inteiro, ligados por padrão viram ruído que se aprende a ignorar — e aí os
outros três também são ignorados.

Cada som tem um botão de ouvir ao lado. Uma lista de sons sem prévia é uma lista
de nomes.

Um controle mestre de volume dos sons, separado do volume das vozes. Eles não
competem pela mesma escala: o som de entrada bom é bem mais baixo que uma voz.

---

## O que fica guardado, e onde

Tudo em `localStorage`, sob a chave `trindade:midia`. São preferências de
máquina, não de conta: o microfone bom fica no computador de casa, não na
pessoa. Sincronizar isso pelo servidor produziria a chamada onde o notebook
tenta usar a interface de áudio da mesa.

Nada disso é credencial, então a regra de `localStorage` do `CLAUDE.md`
continua valendo inteira: **token nenhum passa por aqui.**

O acesso é por `lib/preferencias.ts`, nunca `localStorage` solto no componente —
o Tauri troca o armazenamento na fase 8 e o ponto de troca tem que ser um só.

---

## Estados

| Situação | Interface |
|---|---|
| sem permissão ainda | lista vazia + [ Permitir ] com a explicação |
| permissão negada | o texto de `docs/07-permissoes-do-navegador.md`, com o caminho real |
| nenhum microfone no sistema | "Nenhum microfone encontrado." + como conectar um |
| dispositivo sumiu em uso | toast nomeando o substituto |
| saída não selecionável | lista desabilitada com o motivo |
| testando fora de chamada | medidor + retorno de áudio |
| medidor durante a chamada | medidor sim, retorno não |

---

## Acessibilidade

- O medidor tem `role="meter"` com `aria-valuenow` em dBFS arredondado, e
  `aria-live="off"` — narrar o nível a cada quadro é inutilizável.
- O limiar é um `<input type="range">` de verdade, com setas e `aria-valuetext`
  em dBFS, sobreposto ao medidor apenas visualmente.
- Nível de entrada não é indicado só por cor: as barras acima do limiar mudam de
  altura, não só de tom.
- Todo dispositivo selecionado é anunciado pelo nome ao mudar,
  `aria-live="polite"`.
- A prévia da câmera tem `aria-label` dizendo que é a sua própria imagem e que
  ninguém mais a está vendo.
