import { generateKeyPairSync, randomBytes } from 'node:crypto';

// Gera os segredos do .env. Nada aqui é gravado em disco: o valor sai na tela
// e você cola no .env, que não é commitado.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const oneLine = (pem: string) => JSON.stringify(pem.trim());

process.stdout.write(
  [
    'Cole no .env:',
    '',
    `JWT_PRIVATE_KEY=${oneLine(priv)}`,
    `JWT_PUBLIC_KEY=${oneLine(pub)}`,
    `TOTP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    `TURN_STATIC_SECRET=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n'),
);
