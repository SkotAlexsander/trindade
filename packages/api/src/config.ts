import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

// O .env vive na raiz do monorepo, não no pacote.
dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
dotenv.config({ quiet: true });

/**
 * `VARIAVEL=` no `.env` é "não configurada", não uma string vazia.
 *
 * O `.env.example` traz as opcionais com o valor em branco para dizer que
 * existem. Sem isto, copiar o exemplo e não preencher uma URL faz a API
 * **recusar-se a subir** — o valor vazio não passa por `.url()`, e o erro
 * aparece na hora mais cara: a primeira implantação.
 */
function semValor<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((valor) => (valor === '' ? undefined : valor), schema);
}

// Nesta fase só o que o health check e o bootstrap precisam é obrigatório. As
// chaves de mídia e storage existem no .env.example desde já — ver
// docs/04-seguranca.md — mas só viram obrigatórias na fase em que são usadas.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Em que endereço escutar.
   *
   * `127.0.0.1` é o certo na máquina de desenvolvimento: nada fica exposto na
   * rede local sem querer. **Em contêiner tem de ser `0.0.0.0`** — o Caddy fala
   * com a API pela rede do compose, e um processo preso ao loopback do próprio
   * contêiner é inalcançável de fora dele. O compose de produção define isto, e
   * o padrão continua sendo o seguro.
   */
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória — copie o .env.example'),

  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  TOTP_ENCRYPTION_KEY: z.string().optional(),

  S3_ENDPOINT: z.string().optional(),
  S3_KEY: z.string().optional(),
  S3_SECRET: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),

  // Endereços de mídia sempre por variável de ambiente, mesmo com tudo no
  // mesmo servidor. Ver "Decisões" no CLAUDE.md.
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  TURN_URL: z.string().optional(),
  /** O mesmo relay sobre TLS na 5349, para rede que bloqueia UDP. */
  TURN_TLS_URL: z.string().optional(),
  TURN_STATIC_SECRET: z.string().optional(),
  /**
   * De onde o webhook do LiveKit pode chegar.
   *
   * A assinatura já é conferida; isto é a segunda tranca, e existe porque um
   * webhook aceito de qualquer lugar é uma rota que reescreve o estado de voz
   * de todo mundo. Vazio libera — só em desenvolvimento.
   */
  LIVEKIT_WEBHOOK_IPS: z.string().optional(),

  /**
   * Quem pode ler `/metrics`.
   *
   * Sem ela a rota não serve nada: métrica aberta conta quantas pessoas estão
   * conectadas, quantas mensagens passam por minuto e quando o servidor está
   * ocupado — um mapa de uso para quem estiver olhando de fora.
   */
  METRICS_TOKEN: z.string().optional(),

  /**
   * Quantas contas o cadastro aberto aceita.
   *
   * O produto tem um elenco fixo de cinco, e o painel reserva exatamente cinco
   * espaços. A porta se fecha sozinha quando o grupo termina de entrar — sem
   * isso, quem descobrir o endereço entra na conversa de todo mundo. Para
   * fechar antes da hora, `0`; para abrir para mais alguém, suba o número e
   * volte a descer.
   */
  VAGAS: z.coerce.number().int().min(0).max(50).default(5),

  /**
   * Para onde vão os três alertas: disco cheio, 5xx em série e API fora.
   *
   * Vazia desliga a vigilância inteira — nada é medido para não ser contado a
   * ninguém. O destino é um serviço de fora, então o que sai por aqui é só
   * número e nome de subsistema: nunca mensagem, usuário ou endereço.
   * Ver `services/alerta.ts`.
   */
  ALERTA_WEBHOOK: semValor(z.string().url().optional()),

  /**
   * Qual disco vigiar.
   *
   * O padrão é onde a aplicação está. Num servidor único isso é o mesmo
   * dispositivo dos volumes do Docker — banco, backup e anexos —, que é o que
   * enche e derruba tudo junto.
   */
  DISCO_VIGIADO: semValor(z.string().default(process.cwd())),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Configuração inválida:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
export const isProduction = config.NODE_ENV === 'production';
