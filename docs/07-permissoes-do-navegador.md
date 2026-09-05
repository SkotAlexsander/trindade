# Permissões do navegador

O que o produto pede ao navegador, quando pede, e o que nunca pede. Uma
referência única para não haver divergência entre telas.

---

## O que pedimos

| Permissão | Quando | Por quê |
|---|---|---|
| Microfone | ao entrar numa chamada | voz |
| Câmera | ao ligar o vídeo, nunca antes | vídeo |
| Captura de tela | ao clicar em compartilhar | tela |
| Notificações | na primeira menção recebida | aviso na área de trabalho |
| Área de transferência (leitura) | ao colar imagem no compositor | anexo por Ctrl+V |

A regra: **pedir no momento do uso, nunca no primeiro acesso.** Um pedido sem
contexto é negado, e uma permissão negada é a pior de reverter — exige que a
pessoa encontre o cadeado na barra de endereço sozinha.

Câmera e microfone são pedidos separadamente. Entrar numa chamada de voz não
deve acender a luz da câmera.

## A lista de dispositivos também é permissão

`enumerateDevices()` sem permissão devolve os dispositivos com `label: ''`. Não
é falha: a lista de aparelhos identifica uma máquina, e por isso o navegador a
esconde até haver consentimento.

Consequência prática, em `design/13-dispositivos-e-audio.md`: a tela de
configurações de voz tem um estado "permita para ver seus dispositivos" com um
botão. O botão abre uma trilha, lê a lista e **fecha a trilha em seguida** —
deixar a luz acesa para popular um `<select>` é exatamente o tipo de coisa que
faz alguém revogar a permissão e não devolver.

Vale para a prévia da câmera também: ela vive enquanto o painel está aberto e
morre quando ele fecha.

## O que nunca pedimos

| Permissão | Motivo |
|---|---|
| Localização | não há funcionalidade que use, e é dado pessoal |
| Contatos | não existe importação |
| Bluetooth, USB, MIDI, sensores | irrelevantes |
| Pagamento | não há cobrança |
| Notificações push (Service Worker) | fora da v1 |

Bloqueado no servidor, não só ausente no código:

```
Permissions-Policy: geolocation=(), payment=(), usb=(), bluetooth=(), midi=(),
  serial=(), hid=(), idle-detection=(), camera=(self), microphone=(self),
  display-capture=(self)
```

Se um dia alguém escrever `navigator.geolocation` por engano, o navegador recusa.
É a diferença entre "não usamos" e "não podemos usar".

> Onde isso vive: `infra/cabecalhos.caddy`, o mesmo arquivo que o Caddy importa
> e que o roteiro `e2e/fase-08-csp.py` lê. O roteiro serve o `dist` com esses
> cabeçalhos e **chama `getCurrentPosition`**: se a política afrouxar, ele
> falha. Política e verificação saem da mesma fonte, senão uma envelhece sem a
> outra.

## Quando é negado

Cada caso tem a instrução real do lugar onde clicar, nunca "permissão negada":

| Situação | Texto |
|---|---|
| microfone | O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o acesso. |
| câmera | O navegador bloqueou a câmera. Clique no cadeado ao lado do endereço e permita o acesso. |
| tela (cancelou o seletor) | nada — cancelar é uma ação legítima, não um erro |
| tela (bloqueado pelo sistema) | O sistema bloqueou a captura de tela. No macOS: Ajustes › Privacidade › Gravação de Tela. |
| notificações | Notificações estão desligadas no navegador. Você pode ligar nas configurações do site. |

Notificação negada não insiste. Uma linha nas configurações mostra o estado e
como mudar; a interface não pede de novo.

## Verificar antes de pedir

Use `navigator.permissions.query()` onde suportado para saber o estado sem
disparar o pedido. Permite mostrar "microfone bloqueado" no botão de entrar na
chamada **antes** de a pessoa clicar e ser surpreendida.

Não é suportado para `display-capture` em todos os navegadores; nesse caso,
trate o erro do `getDisplayMedia`.

> Onde isso vive: `estadoDaPermissao()` em `packages/web/src/lib/midia.ts`,
> chamada por `useChamada` antes de entrar numa chamada e antes de ligar a
> câmera. Ela devolve quatro estados, e o quarto é o que importa:
> **`desconhecido` não é `negada`**. O Firefox lança para `camera` e
> `microphone`, e tratar isso como recusa mostraria "bloqueado" para quem nunca
> foi perguntado.
>
> Com o aparelho bloqueado, `getUserMedia` **não abre caixa nenhuma** — falha
> em silêncio, e quem clicou fica olhando um "conectando" que nunca sai. Por
> isso a consulta vem antes, e a mensagem já traz onde clicar.

## Desktop (Tauri)

O Tauri delega ao sistema. macOS exige entrada em `Info.plist` para microfone,
câmera e gravação de tela, com o texto de justificativa que o sistema mostra.
Windows e Linux não pedem para microfone e câmera, mas o Wayland pode exigir o
portal `xdg-desktop-portal` para tela.

Notificação nativa via plugin do Tauri, sem pedir permissão de navegador.
