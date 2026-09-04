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
Permissions-Policy: geolocation=(), payment=(), usb=(), bluetooth=(),
  camera=(self), microphone=(self), display-capture=(self)
```

Se um dia alguém escrever `navigator.geolocation` por engano, o navegador recusa.
É a diferença entre "não usamos" e "não podemos usar".

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

## Desktop (Tauri)

O Tauri delega ao sistema. macOS exige entrada em `Info.plist` para microfone,
câmera e gravação de tela, com o texto de justificativa que o sistema mostra.
Windows e Linux não pedem para microfone e câmera, mas o Wayland pode exigir o
portal `xdg-desktop-portal` para tela.

Notificação nativa via plugin do Tauri, sem pedir permissão de navegador.
