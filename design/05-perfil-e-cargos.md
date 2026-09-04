# Perfil e cargos

Cobre o cartão de perfil, o editor do próprio perfil, o gerenciamento de cargos e
a lista de pessoas.

---

## Cartão de perfil

Abre no hover (400ms) ou clique de um avatar, em qualquer lugar. 300px de
largura, `--bg-raised`, `--r-surface`, `--shadow-pop`.

```
┌──────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  faixa 56px, cor de destaque
│      ┌────────┐              │
│      │  ◉     │              │  avatar 64px, sobrepõe a faixa
│      └────────┘              │
│  Ana Silva                   │  18px, peso 600
│  @ana                        │  13px, --text-secondary
│                              │
│  ▪ Produto   ▪ Admin         │  chips de cargo
│                              │
│  Cuidando do backend e       │  bio, 13px
│  fingindo entender CSS.      │
│  ─────────────────────────   │
│  ◉ Disponível                │
│  Está aqui desde março       │
│  ─────────────────────────   │
│  [ Mandar mensagem ]         │
└──────────────────────────────┘
```

A faixa do topo usa `accent_color` da pessoa, ou o cargo de maior posição se ela
não escolheu, ou `--slate-mid` se nenhum dos dois. É a única personalização
cromática que cada pessoa controla.

Chip de cargo: `--r-full`, altura 20px, fundo com 12% da cor do cargo, texto na
cor do cargo ajustada para contraste, com um ponto de 6px antes.

Se o cartão for de você mesmo, o botão vira "Editar perfil".

Posicionamento: prefira à direita do avatar; se não couber, à esquerda; se não
couber na vertical, alinhe pelo rodapé da janela. Nunca deixe sair da viewport.

Fechamento: clique fora, `Escape`, ou mouse sair por mais de 300ms. Esse atraso
importa — sem ele, atravessar a borda do cartão o fecha e a interface parece
hostil.

---

## Editar perfil

Diálogo de 560px, não uma página. Perfil é edição pontual; tirar a pessoa do
contexto para isso é desnecessário.

```
┌────────────────────────────────────────────────┐
│  Seu perfil                               ✕    │
├────────────────────────────────────────────────┤
│                                                │
│   ┌──────┐   Foto                              │
│   │  ◉   │   [ Trocar ]  [ Remover ]           │
│   └──────┘   PNG, JPG ou WebP. Até 8 MB.       │
│                                                │
│   Nome de exibição                             │
│   ┌──────────────────────────────────┐         │
│   │ Ana Silva                        │         │
│   └──────────────────────────────────┘         │
│   É assim que você aparece nas conversas.      │
│                                                │
│   Nome de usuário                              │
│   @ana                                         │
│   Não pode ser alterado.                       │
│                                                │
│   Sobre você                            0/280  │
│   ┌──────────────────────────────────┐         │
│   │                                  │         │
│   └──────────────────────────────────┘         │
│                                                │
│   Cor de destaque                              │
│   ▪ ▪ ▪ ▪ ▪ ▪ ▪  [ #4c8df6 ]                   │
│                                                │
├────────────────────────────────────────────────┤
│                    [ Cancelar ]  [ Salvar ]    │
└────────────────────────────────────────────────┘
```

O nome de usuário aparece como texto, não como campo desabilitado. Campo cinza
convida a tentar clicar; texto simples com a explicação ao lado responde a
pergunta antes dela ser feita.

Contador de caracteres só aparece a partir de 80% do limite. Antes disso é ruído.

Salvar fica desabilitado sem alteração. Fechar com mudança pendente pede
confirmação; sem mudança, fecha direto.

### Trocar a foto

1. Seleção abre o seletor nativo do sistema.
2. A imagem entra num recortador quadrado com zoom e arrasto. Sempre quadrado —
   a pessoa decide o enquadramento em vez de descobrir depois que a interface
   cortou a cabeça dela.
3. Confirmar envia. O avatar mostra o novo arquivo imediatamente, com opacidade
   reduzida até o servidor confirmar.
4. Falha reverte para o anterior com uma mensagem no próprio bloco da foto.

Uma linha discreta abaixo do controle, em `--text-tertiary`:

> A localização e outros dados da foto são removidos ao enviar.

Isso não é jurídico, é informação útil. A maioria das pessoas não sabe que a foto
do celular carrega GPS, e dizer que você cuida disso constrói confiança.

---

## Segurança da conta

Aba separada dentro do mesmo diálogo.

```
   Senha
   Alterada há 3 meses.            [ Alterar senha ]

   ──────────────────────────────────────────────

   Verificação em duas etapas
   ◉ Ativa desde 12 de março       [ Desativar ]

   Códigos de recuperação
   7 de 10 ainda válidos           [ Gerar novos ]

   ──────────────────────────────────────────────

   Sessões abertas

   ▪ Chrome no Linux · agora        esta sessão
   ▪ Firefox no Android · há 2 dias      [ Encerrar ]

   [ Encerrar todas as outras sessões ]
```

A lista de sessões **não mostra IP nem localização**, de propósito. É coerente com
o resto do produto: se não registramos IP, não temos o que exibir. O navegador e
o horário bastam para reconhecer o que é seu.

### Ativar 2FA

Três passos num fluxo só:

1. QR code com o segredo, e o segredo em texto para quem digita à mão. Botão de
   copiar.
2. Campo de 6 dígitos para confirmar. Só aqui o 2FA é realmente ativado.
3. Dez códigos de recuperação, com botões de copiar e baixar.

O passo 3 tem um aviso enfático, e ele é literal:

> Guarde estes códigos agora. Sem e-mail cadastrado, eles são a única forma de
> entrar se você perder o telefone. Não é possível vê-los de novo.

Exigir uma caixa "guardei os códigos" antes de fechar é justificado aqui. É um
dos raríssimos casos em que atrito é o desenho certo.

---

## Cargos

Página completa, não diálogo. Exige `MANAGE_ROLES`.

```
┌─────────────┬────────────────────────────────────────┐
│  CARGOS     │  Admin                                 │
│             │                                        │
│  ▪ Admin    │  Nome                                  │
│  ▪ Produto  │  ┌────────────────────┐                │
│  ▪ Membro   │  │ Admin              │                │
│             │  └────────────────────┘                │
│  + Criar    │                                        │
│             │  Cor                                   │
│             │  ▪ ▪ ▪ ▪ ▪ ▪  [ #de5d52 ]              │
│             │                                        │
│             │  ─────────────────────────────────     │
│             │  Permissões                            │
│             │                                        │
│             │  Conversa                              │
│             │   Enviar mensagens              [ ● ]  │
│             │   Anexar arquivos               [ ● ]  │
│             │   Apagar mensagens de outros    [ ○ ]  │
│             │                                        │
│             │  Chamada                               │
│             │   Entrar em chamadas            [ ● ]  │
│             │   Compartilhar tela             [ ● ]  │
│             │                                        │
│             │  Administração                         │
│             │   Gerenciar canais              [ ○ ]  │
│             │   Gerenciar cargos              [ ○ ]  │
│             │                                        │
│             │  ─────────────────────────────────     │
│             │  Quem tem este cargo                   │
│             │   ◉ Ana    ◉ Bruno      [ + Adicionar ]│
└─────────────┴────────────────────────────────────────┘
```

A lista da esquerda é ordenada por `position`, do mais alto para o mais baixo, e
arrastável. A ordem é a hierarquia — mostrar isso visualmente evita ter que
explicar o conceito.

Cargo com `position` maior ou igual ao seu aparece esmaecido e não abre. Uma
linha explica: "Você não pode editar cargos acima do seu."

Permissões agrupadas por área, com nome em linguagem de quem usa. "Apagar
mensagens de outros", não `DELETE_ANY_MESSAGE`.

`ADMINISTRATOR` fica separado, no fim, com destaque:

> **Administrador** — ignora todas as permissões acima e concede acesso total.
> Dê apenas a quem você confia com o servidor inteiro.

Salvamento automático com debounce de 800ms. Um indicador discreto de "Salvo"
aparece por 2s. Formulário de permissão com botão Salvar convida a esquecer de
clicar.

---

## Pessoas

Lista simples. São cinco.

```
┌──────────────────────────────────────────────────────┐
│  Pessoas                          [ + Convidar ]     │
├──────────────────────────────────────────────────────┤
│  ◉ Ana Silva      @ana      ▪ Admin  ▪ Produto   ⋯   │
│  ◉ Bruno Costa    @bruno    ▪ Membro             ⋯   │
│  ○ Carla Dias     @carla    ▪ Membro             ⋯   │
│  ◉ Você           @dani     ▪ Admin              ⋯   │
│  ◐ Eva Lima       @eva      ▪ Membro             ⋯   │
├──────────────────────────────────────────────────────┤
│  Desativadas (1)                                  ⌄  │
└──────────────────────────────────────────────────────┘
```

Sem busca, sem filtro, sem paginação. Cinco linhas cabem na tela.

Menu `⋯`: gerenciar cargos, desativar. Ambos escondidos se a hierarquia não
permitir — escondidos, não desabilitados.

Desativar pede confirmação com o nome digitado e explica a consequência real:

> Bruno perde o acesso imediatamente. As mensagens dele continuam no histórico.
> Você pode reativar depois.

Pessoas desativadas ficam numa seção recolhida no rodapé, com opção de reativar.

---

## Convites

Diálogo. Exige `CREATE_INVITE`.

```
┌────────────────────────────────────────────┐
│  Convidar alguém                      ✕    │
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ cinco.exemplo.com/entrar/K7X2M9PQ    │  │
│  └──────────────────────────────────────┘  │
│  [ Copiar link ]                           │
│                                            │
│  Vale para uma pessoa e expira em 7 dias.  │
│                                            │
│  Para quem é? (opcional)                   │
│  ┌──────────────────────────────────────┐  │
│  │ Bruno, do time de design             │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Expira em   [ 7 dias ⌄ ]                  │
│                                            │
├────────────────────────────────────────────┤
│  Convites abertos                          │
│  K7X2M9PQ · Bruno · expira em 6 d      ✕   │
└────────────────────────────────────────────┘
```

O link é gerado ao abrir o diálogo, não ao clicar num botão. Se a pessoa fechar
sem usar, ele expira sozinho.

Uso único é dito em texto claro, não como rótulo técnico. "Vale para uma pessoa"
comunica melhor que "single-use".
