# Aplicativo de mesa

> 5 de setembro de 2026. Pedido do dono do projeto: "quero as duas
> possibilidades, navegador e direto no Windows".

O produto ganha uma casca nativa. Não uma segunda versão dele — a mesma coisa,
instalada.

---

## A decisão que governa tudo o resto

**O aplicativo carrega o servidor. Ele não embrulha uma cópia do front.**

A tentação é empacotar o `dist` do `@trindade/web` dentro do binário — é o que a
maioria dos tutoriais de Tauri mostra, e é o que faria o programa abrir sem
rede. Aqui isso quebraria a sessão, e pelo mesmo motivo que faz o produto ser
seguro no navegador: **o token de atualização mora num cookie `httpOnly;
SameSite=Strict`, preso à origem da API.**

Com o front rodando em `tauri://localhost`, toda chamada à API viraria
*cross-site*. O cookie não seria enviado. `POST /auth/refresh` falharia, e a
sessão morreria no primeiro vencimento do token de acesso — quinze minutos
depois de entrar, sem nenhuma mensagem que explicasse por quê.

As saídas seriam todas piores: afrouxar o cookie para `SameSite=None` enfraquece
o navegador para consertar o desktop; guardar o token no cofre do sistema
contraria "nenhuma credencial em disco" e cria um segundo caminho de
autenticação para manter.

Carregando o servidor direto, **tudo continua sendo mesma origem**. O desenho de
autenticação inteiro segue valendo sem uma linha de exceção, a CSP continua
sendo a do Caddy, e o aplicativo nunca fica numa versão diferente da que está
publicada — o que também elimina a classe de bug "funciona no navegador, quebra
no desktop".

O que se perde é abrir sem rede. Para um produto que **é** um servidor de
conversa, isso não é perda: sem rede não há o que mostrar.

É, aliás, o que o aplicativo do Discord faz.

---

## O endereço do servidor

O binário não tem endereço gravado dentro. O mesmo instalador serve para
qualquer espaço, e o servidor de uma pessoa não é o da outra.

Na primeira execução, uma tela pergunta — é a **única** tela que este aplicativo
desenha. O valor vai para `%APPDATA%\com.pixelmartins.trindade\servidor.json`, e
a partir daí a janela nasce apontando para lá. Quem já configurou não vê a tela
de configuração nunca mais.

`https://` é assumido quando não vem escrito. E o endereço passa por validação
antes de virar URL de janela: só `http` e `https`, com host — um `file:` ou
`javascript:` ali seria a porta mais larga que este programa poderia ter.

---

## O que a casca acrescenta

Fatia 1, entregue:

- **Instância única.** Abrir o programa duas vezes traz a janela que já existe
  para a frente. Sem isso, dois processos disputam o mesmo cookie e a mesma
  conexão de WebSocket, e a segunda janela derruba a primeira.
- **Tamanho mínimo de 940×600.** Abaixo disso o shell vira gaveta, e um programa
  de mesa que abre em modo telefone parece quebrado.
- **Tema escuro fixo na janela**, para ela não nascer clara e escurecer quando a
  página carrega.

A fazer, nas fatias seguintes: ícone na bandeja com fechar-sem-encerrar, atalho
global de mudo, notificação nativa e atualização automática. Estão descritas em
`prompts/fase-11-desktop-e-publicacao.md`.

---

## O que a cor da barra de título não é

Na máquina onde isto foi construído, a barra de título abre ciano. Não é defeito
nosso: o Windows tem **"mostrar cor de destaque nas barras de título"** ligado
(`HKCU\Software\Microsoft\Windows\DWM\ColorPrevalence = 1`), e nessa
configuração *toda* janela da máquina usa a cor de destaque. O `theme` do Tauri
controla o esquema de cor da WebView, não a moldura do sistema.

Respeitar isso é o comportamento certo. Um programa que força a própria cor de
barra é um programa que decidiu que sabe melhor que o dono da máquina.

---

## Tamanhos

| | |
|---|---|
| Binário | 3,2 MB |
| Instalador | 1,1 MB |

É a razão de ser Tauri e não Electron: a WebView é a do sistema, e o Electron
carregaria um Chromium inteiro — cerca de 150 MB — para exibir a mesma página,
num programa que fica aberto o dia todo ao lado de uma chamada.

---

## Como construir

```bash
pnpm desktop         # abre em modo de desenvolvimento
pnpm desktop:build   # gera o instalador NSIS
```

O instalador sai em
`packages/desktop/src-tauri/target/release/bundle/nsis/`. Ele instala para o
usuário atual, sem pedir administrador, e aparece em Programas e Recursos como
qualquer outro.

Precisa de Rust estável com o alvo `x86_64-pc-windows-msvc` e do WebView2 — que
já vem no Windows 11.
