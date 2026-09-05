# Autenticação

Quatro telas: entrar, código de verificação, aceitar convite, criar conta. São as
únicas fora do shell e as únicas com tipografia de display.

> Revisão de 4 de setembro de 2026: `--rust-wash` virou `--crimson-wash`.

---

## Composição

Coluna única de 400px, centralizada na horizontal, ancorada a **20% do topo** —
não centralizada na vertical. Centralizar joga o formulário baixo demais e o
teclado virtual do celular o cobre.

Fundo `--bg-app`, sem ilustração, sem imagem, sem gradiente. A tela é
deliberadamente quieta: é o único lugar do produto onde a pessoa está sozinha, e
a paleta reflete isso — nada de âmbar aqui, porque não há ninguém presente.

```
              ▪
          Trindade

     Entrar

     Usuário
     ┌────────────────────────┐
     │                        │
     └────────────────────────┘

     Senha
     ┌────────────────────────┐
     │                    👁  │
     └────────────────────────┘

     [        Entrar         ]

     Tem um convite? Criar conta
```

O título usa `--text-display` (30px) em `--font-ui`, peso 600. É a única
aparição desse tamanho no produto inteiro.

Campos com 44px de altura, `--r-field`, `border: 1px solid var(--border)`, fundo
`--bg-panel`. No foco, `border-color: var(--accent)` mais o anel.

Rótulo acima do campo, 13px `--text-secondary`. Não use placeholder como rótulo:
ele some quando a pessoa digita, e ela perde a referência do que está preenchendo.

Botão de largura total, 44px, `--accent`, texto `--text-on-accent`, peso 500.

---

## Entrar

Autofoco no campo de usuário. `autocomplete="username"` e `"current-password"` —
sem isso o gerenciador de senhas não funciona e a pessoa cria senha fraca.

Erro aparece **acima do botão**, não em toast, em uma faixa com fundo
`--crimson-wash`, borda esquerda de 2px em `--danger`:

> Usuário ou senha incorretos.

Nunca diga qual dos dois errou. Isso confirma quais usuários existem.

Com rate limit atingido:

> Muitas tentativas. Tente de novo em 4 minutos.

Contagem regressiva ao vivo. Um tempo vago frustra mais que o bloqueio.

O botão mostra estado de carregamento no próprio texto, sem trocar por spinner —
trocar o rótulo por um símbolo perde a informação de qual ação está em curso.

---

## Código de verificação

Aparece quando a conta tem 2FA.

```
     Verificação em duas etapas

     Digite o código do seu
     aplicativo autenticador.

     ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐
     │ 1 ││ 2 ││ 3 ││   ││   ││   │
     └───┘└───┘└───┘└───┘└───┘└───┘

     [       Verificar       ]

     Usar um código de recuperação
```

Seis caixas de 48px. `inputmode="numeric"`, `autocomplete="one-time-code"`,
`pattern="[0-9]*"`.

Comportamento que precisa funcionar direito:

- Colar seis dígitos preenche tudo de uma vez e envia automaticamente.
- Backspace numa caixa vazia volta para a anterior.
- Setas navegam entre caixas.
- Ao completar o sexto dígito, envia sozinho — não espere clique.
- Código errado: as caixas balançam 4px por 200ms, limpam e focam a primeira.

O balanço é uma das poucas animações não disparadas por navegação no produto. Ela
se paga: comunica erro sem texto e devolve a pessoa ao ponto de ação.

"Usar um código de recuperação" troca para um campo único de texto.

---

## Aceitar convite

Rota `/entrar/:codigo`. Valida antes de mostrar qualquer formulário.

```
              ▪
          Trindade

     Ana convidou você

     Um espaço de trabalho para
     cinco pessoas.

     [    Criar minha conta    ]

     Já tem conta? Entrar
```

Mostra apenas quem convidou. **Não revele quantas pessoas existem, nem quais
canais, nem nomes.** Um código vazado não deve entregar o mapa do lugar.

Convite inválido:

> Este convite não vale mais.
> Ele pode ter expirado ou já ter sido usado. Peça um novo para quem te chamou.

Sem botão. Não há ação possível aqui e um botão falso é pior que nenhum.

---

## Criar conta

```
     Criar sua conta

     Nome de usuário
     ┌────────────────────────┐
     │ @                      │
     └────────────────────────┘
     Letras minúsculas, números e _
     Não poderá ser alterado depois.

     Como quer aparecer
     ┌────────────────────────┐
     │                        │
     └────────────────────────┘

     Senha
     ┌────────────────────────┐
     │                    👁  │
     └────────────────────────┘
     ▓▓▓▓▓▓▓▓░░░░  boa
     Mínimo de 12 caracteres.

     [     Criar conta      ]
```

O `@` é um prefixo fixo dentro do campo, em `--text-tertiary`, não parte do valor.

A imutabilidade do usuário é avisada **antes**, não depois. É a diferença entre
uma decisão informada e uma surpresa desagradável.

### Medidor de senha

Quatro segmentos de 4px. As cores obedecem à regra do produto: `--danger` para
fraca, `--text-tertiary` para razoável, `--accent` para boa e forte. **Nada de
verde para "forte"** — verde no produto significa presença online, e reaproveitar
significado quebra o vocabulário.

Rótulos: fraca, razoável, boa, forte. Sem porcentagem, sem pontuação numérica.

Use zxcvbn, não contagem de caracteres. `Senha123!` passa em qualquer regra de
complexidade e é péssima; `cavalo bateria grampo` é excelente e reprovaria.

### Validação

Nome de usuário verifica disponibilidade com debounce de 500ms, e o resultado
aparece dentro do campo: ✓ em `--accent`, ✕ em `--danger`.

Erros de campo aparecem **no blur**, não a cada tecla. Validar enquanto a pessoa
digita a mostra errada antes de ela terminar, e isso é hostil.

Senha vazada, detectada por k-anonymity:

> Esta senha apareceu em vazamentos públicos. Escolha outra.

Sucesso leva para `/entrar` com uma faixa: "Conta criada. Entre com sua senha." O
login imediato seria mais suave, mas exercitar a senha uma vez logo depois de
criá-la aumenta muito a chance de ela ser lembrada.

---

## Detalhes que valem

**Não use `<form>` do HTML sem `onSubmit` controlado em React.** `Enter` precisa
enviar; sem isso metade dos usuários trava.

**Sempre `autocomplete` correto** em todos os campos. Atrapalhar o gerenciador de
senhas é um problema de segurança, não de conveniência.

**Um erro por vez.** Se o usuário está tomado e a senha é fraca, mostre o
primeiro. Uma lista de cinco falhas desanima.

**Estado de carregamento no botão**, texto no gerúndio: "Entrando…", "Criando
conta…". Desabilite para evitar duplo envio.

**`prefers-reduced-motion`** desliga o balanço do código e qualquer transição
entre telas.

---

## Erros, em linguagem de gente

| Situação | Texto |
|---|---|
| credencial errada | Usuário ou senha incorretos. |
| conta desativada | Esta conta foi desativada. Fale com quem administra o servidor. |
| rate limit | Muitas tentativas. Tente de novo em 4 minutos. |
| usuário em uso | Este nome já está sendo usado. |
| usuário inválido | Use apenas letras minúsculas, números e sublinhado. |
| senha curta | Use pelo menos 12 caracteres. |
| senha vazada | Esta senha apareceu em vazamentos públicos. Escolha outra. |
| código errado | Código incorreto. Confira o aplicativo e tente de novo. |
| código expirado | Este código expirou. Digite o atual. |
| convite inválido | Este convite não vale mais. |
| sem conexão | Sem conexão com o servidor. Verifique sua internet. |

Nenhum pede desculpa. Erro explica o que aconteceu e o que fazer; "Ops! Algo deu
errado" não faz nem uma coisa nem outra.

---

## Cadastro aberto

> 5 de setembro de 2026. Pedido do dono do projeto, ao publicar: "por o modo
> cadastro, apenas criar um nome de usuário e uma senha, nada demais".

Duas portas, e elas servem a momentos diferentes: **abrir** o produto para o
grupo entrar, e **convidar** alguém pontualmente depois. O convite continua
inteiro — o que mudou é que ele passou a ser opcional.

**Só nome e senha.** O nome de exibição saiu do formulário: são duas versões do
mesmo nome numa tela que precisa de dois campos. Sem ele, o servidor usa o nome
de usuário, e quem quiser outro troca no perfil.

**A primeira conta é Admin.** Sem isso, com cadastro aberto ninguém
administraria nada — todos entrariam como Membro e não haveria quem criasse
canal, cargo ou convite. O `scripts/bootstrap.ts` continua existindo para o
disaster recovery, mas quem sobe o produto e abre o site não deveria precisar de
um segundo caminho para virar dono dele.

**O cadastro tem vagas.** `VAGAS`, cinco por padrão — o mesmo número de espaços
que o painel do elenco reserva. Sem limite, qualquer um que descubra o endereço
entra na conversa de todo mundo; com ele, a porta se fecha sozinha quando o
grupo termina de entrar, sem ninguém precisar lembrar de fechá-la. `VAGAS=0`
fecha na hora, e o convite continua funcionando.

A contagem é do espaço inteiro, não só de quem se cadastrou: quem entrou por
convite ou pelo bootstrap ocupa uma vaga. E ela roda sob
`pg_advisory_xact_lock` — sem isso, duas pessoas cadastrando ao mesmo tempo leem
a mesma contagem e as duas passam, que é como um limite de vagas vira um limite
de vagas mais uma.

**O limite de registro subiu de 3 para 10 por hora.** Cinco pessoas cadastrando
da mesma casa dividem um IP, e com três o terceiro amigo batia no limite na
tarde de estreia. Quem defende de verdade aqui é o limite de vagas: um flood não
passa de `VAGAS` contas de jeito nenhum.

**Em produção não existe conta fictícia.** O `dev-seed` cria o elenco de
desenvolvimento e **recusa rodar com `NODE_ENV=production`**; o `implantar.sh`
não o chama. Um servidor recém-publicado começa vazio, e a primeira pessoa que
se cadastrar é a dona dele.
