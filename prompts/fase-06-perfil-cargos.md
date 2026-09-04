# Fase 6 — Perfil, avatar e cargos

Identidade e permissão na interface. Upload de avatar com re-encode, cartão de
perfil, editor, gestão de cargos, lista de pessoas e convites.

Leia antes: `design/05-perfil-e-cargos.md`, `docs/04-seguranca.md` (seção de
upload), `docs/05-contrato-api.md` (perfil, pessoas, cargos, convites).

## Entregar

### Upload de avatar

`POST /me/avatar`, multipart, máximo de 8 MB.

O pipeline não é negociável:

```typescript
const webp = await sharp(buf, { limitInputPixels: 50_000_000 })
  .rotate()
  .resize(256, 256, { fit: 'cover' })
  .webp({ quality: 82 })
  .toBuffer();
```

`.rotate()` aplica a orientação EXIF e descarta o resto do metadado, inclusive
GPS. `limitInputPixels` bloqueia decompression bomb. Se não for imagem, o `sharp`
lança — é a validação real, melhor que checar `Content-Type`.

**Nenhum byte original chega ao disco.**

Valide magic bytes, não extensão. Chave aleatória, nunca o nome enviado. Apague o
avatar anterior do storage ao trocar. Faça broadcast de `USER_UPDATE`.

Gere também o blurhash, para a prévia enquanto carrega.

Sirva os arquivos de um domínio separado, com `X-Content-Type-Options: nosniff`.

### Rotas

Perfil (`GET/PATCH /me`, senha, sessões), pessoas (`GET /users`, cargos,
desativar, reativar), cargos (CRUD) e convites, todos conforme
`docs/05-contrato-api.md`.

`permissions` sempre serializado como **string** — `bigint` não sobrevive ao JSON.

As duas regras de hierarquia validadas no servidor, retornando
`HIERARCHY_VIOLATION`:
1. ninguém mexe em cargo de `position` maior ou igual ao seu maior cargo
2. ninguém desativa alguém com cargo maior ou igual ao seu

Sem elas, `MANAGE_ROLES` equivale a `ADMINISTRATOR`.

### Cartão de perfil

300px, com a faixa de cor no topo e o avatar sobrepondo. Abre no hover após
400ms, ou no clique.

Fecha ao sair do mouse **com 300ms de atraso** — sem isso, atravessar a borda do
cartão o fecha e a interface parece hostil.

Posicionamento com colisão tratada: direita, senão esquerda, senão alinhado pelo
rodapé da janela.

### Editar perfil

Diálogo de 560px, não página. Nome de usuário como **texto**, não campo
desabilitado, com a explicação ao lado.

Recortador quadrado com zoom e arrasto antes de enviar.

A linha sobre privacidade abaixo do controle de foto:

> A localização e outros dados da foto são removidos ao enviar.

Contador de caracteres só a partir de 80% do limite.

### Segurança da conta

Aba do mesmo diálogo: senha, 2FA, códigos de recuperação, sessões.

A lista de sessões mostra navegador e horário, **sem IP e sem localização**. É
coerente: não registramos, então não temos o que exibir.

O fluxo de ativar 2FA em três passos, com o aviso literal sobre os códigos de
recuperação serem a única saída sem e-mail cadastrado, e a caixa de confirmação
antes de fechar.

### Cargos

Página com lista à esquerda ordenada por `position` (arrastável, a ordem é a
hierarquia) e editor à direita.

Permissões agrupadas por área, com nome em linguagem de quem usa: "Apagar
mensagens de outros", não `DELETE_ANY_MESSAGE`.

`ADMINISTRATOR` separado no fim, com o aviso destacado.

Cargo acima do seu aparece esmaecido e não abre.

Salvamento automático com debounce de 800ms e indicador "Salvo" por 2s.

### Pessoas e convites

Lista de cinco linhas, sem busca nem paginação. Menu com itens escondidos quando
a hierarquia não permite.

Desativar pede o nome digitado e explica que as mensagens permanecem.

Diálogo de convite gerando o link ao abrir, com "Vale para uma pessoa e expira em
7 dias" em texto claro.

### Permissões no front

Hook `usePermissions` com `can(perm)`. A UI esconde o que a pessoa não pode
fazer, **e o servidor recusa de qualquer forma**. As duas coisas, sempre.

Ao receber `PERMISSIONS_UPDATE`, a interface se ajusta sem recarregar.

Utilitário de contraste da fase 3 aplicado em toda cor de cargo exibida.

## Aceite

- Enviar foto com GPS e baixar o resultado: `exiftool` não mostra localização
- Enviar um `.txt` renomeado para `.png` é recusado
- Avatar antigo some do storage ao trocar
- Trocar avatar propaga para as outras abas em tempo real
- Usuário sem `MANAGE_ROLES` não vê a página de cargos, e a rota recusa direto
- Tentar atribuir cargo acima do seu devolve `HIERARCHY_VIOLATION`
- Cor de cargo escura é clareada até ficar legível
- Desativar alguém derruba a conexão e some da lista ativa
- 2FA ativa, exibe os códigos uma vez e exige confirmação
- Sessões listam sem IP
