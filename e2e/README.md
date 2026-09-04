# Testes de navegador

Roteiros que percorrem os testes à mão do `COMECE-AQUI.md` num Chrome de
verdade, em vez de você repetir tudo com a mão a cada fase.

Não fazem parte do build nem do `pnpm test` — são uma ferramenta de conferência.
Estão em Python porque o Playwright já roda assim aqui e não exigem acrescentar
mais nada ao monorepo.

## Rodar

Uma vez:

```bash
python -m pip install playwright
```

Usa o Chrome já instalado (`channel='chrome'`), sem baixar navegador.

Com o `docker compose up -d` e o `pnpm dev` no ar:

```bash
python e2e/fase-02-autenticacao.py .capturas
python e2e/fase-02-dois-fatores.py .capturas
```

As capturas de tela vão para a pasta passada como argumento.

## O que cada um cobre

**`fase-02-autenticacao.py`** — 23 verificações: prévia de convite, convite
inválido e já usado, medidor de senha, registro sem login automático, erro de
credencial que não distingue usuário de senha, cookie `rt` com `HttpOnly` e
`Path` restrito, ausência de token em `localStorage`, sessão sobrevivendo ao
recarregar, renovação pelo cookie, reuso de token derrubando a sessão, `Tab`,
`Enter`, e nenhuma requisição a domínio externo.

**`fase-02-dois-fatores.py`** — 12 verificações: ativação do 2FA, as seis caixas
(foco inicial, avanço ao digitar, backspace voltando, setas, envio automático no
sexto dígito, balanço e limpeza no erro), código de recuperação de uso único, e o
anel de foco envolvendo o campo inteiro.

Cada roteiro cria um usuário novo a cada corrida. Isso não é capricho: a chave do
rate limit do login inclui o nome do usuário, e reaproveitar a mesma conta faz a
segunda execução travar em 429.

## Se a suíte travar em "Timeout ... waiting for navigation"

Quase sempre é o rate limit do login: cinco tentativas por 15 minutos por
usuário, e cada corrida gasta uma. Rodar a suíte várias vezes seguidas esgota.

Não é bug — é o controle funcionando. O contador vive na memória do processo da
API, então reiniciar zera:

```bash
touch packages/api/src/app.ts   # o tsx watch reinicia sozinho
```

Os roteiros da fase 4 em diante reaproveitam o cookie `rt` entre janelas em vez
de logar de novo, justamente para gastar o mínimo. Cada retomada rotaciona o
token, então o estado tem de ser encadeado: reapresentar o anterior é o que a
detecção de reuso derruba.
