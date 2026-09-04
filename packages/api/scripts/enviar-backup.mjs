/**
 * Manda o dump para o storage e apaga o que passou de 30 dias.
 *
 * Em Node, e não com a CLI da AWS: as credenciais já estão no `.env` e o SDK já
 * é dependência do projeto. Uma ferramenta a mais para instalar no servidor é
 * uma coisa a mais que pode faltar justamente no dia em que o backup importa.
 *
 * Mora dentro de `packages/api` porque é lá que as dependências estão: num
 * monorepo pnpm, um script na raiz não enxerga o `node_modules` de um pacote.
 *
 * Ver docs/08-operacao.md.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { config as carregarEnv } from 'dotenv';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// O `.env` fica na raiz do monorepo.
carregarEnv({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });
carregarEnv({ quiet: true });

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node scripts/enviar-backup.mjs <arquivo.dump>');
  process.exit(1);
}

const { S3_ENDPOINT, S3_KEY, S3_SECRET, S3_REGION = 'auto' } = process.env;
// Balde separado do de anexos: quem consegue ler avatares não pode ler o banco
// inteiro. Se não existir, cai no principal — melhor um backup no lugar errado
// do que nenhum.
const balde = process.env.S3_BUCKET_BACKUP ?? process.env.S3_BUCKET;

if (!S3_ENDPOINT || !S3_KEY || !S3_SECRET || !balde) {
  console.error('!! storage não configurado — o dump ficou só em disco');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
  forcePathStyle: true,
});

const chave = `backups/${basename(arquivo)}`;
await s3.send(
  new PutObjectCommand({
    Bucket: balde,
    Key: chave,
    Body: readFileSync(arquivo),
    ContentType: 'application/octet-stream',
  }),
);
console.log(`==> ${chave} (${(statSync(arquivo).size / 1e6).toFixed(1)} MB)`);

/* Retenção de 30 dias, aplicada aqui e não por regra de ciclo de vida do
   provedor: a regra do provedor é invisível no repositório e ninguém lembra
   dela seis meses depois. */
const limite = Date.now() - 30 * 86_400_000;
const lista = await s3.send(new ListObjectsV2Command({ Bucket: balde, Prefix: 'backups/' }));

for (const objeto of lista.Contents ?? []) {
  if (!objeto.Key || !objeto.LastModified) continue;
  if (objeto.LastModified.getTime() >= limite) continue;
  await s3.send(new DeleteObjectCommand({ Bucket: balde, Key: objeto.Key }));
  console.log(`==> removido ${objeto.Key}`);
}
