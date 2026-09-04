/**
 * Tokens de acesso para o teste de carga.
 *
 * Entra com as contas do elenco de desenvolvimento e imprime os tokens
 * separados por vírgula, para o k6 consumir. Fora daqui não serve para nada: o
 * token vive quinze minutos e o elenco só existe em desenvolvimento.
 *
 *   node e2e/tokens-de-carga.mjs
 */
const API = process.env.API ?? 'http://127.0.0.1:3000';
const SENHA = 'cavalo-bateria-grampo-9';
const ELENCO = ['alex', 'bruno', 'carla', 'daniel', 'eva'];

const tokens = [];

for (const username of ELENCO) {
  const resposta = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: SENHA }),
  });

  if (!resposta.ok) {
    // O limite de login é 5 por 15 minutos por usuário: numa segunda corrida
    // seguida, a conta trava. Dizer isso é melhor que devolver lista curta em
    // silêncio e o k6 acusar "conexões recusadas".
    console.error(
      `!! ${username}: ${resposta.status} — se for 429, reinicie a API para zerar o contador`,
    );
    continue;
  }
  tokens.push((await resposta.json()).access);
}

if (tokens.length === 0) {
  console.error('!! nenhum token; a API está de pé? `pnpm dev:seed` já rodou?');
  process.exit(1);
}

process.stdout.write(tokens.join(','));
