import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';

/**
 * TOTP conforme RFC 6238: 6 dígitos, passo de 30s, tolerância de ±1 período.
 * O segredo é cifrado com AES-256-GCM antes de ir para o banco — se o banco
 * vazar, o segundo fator ainda vale alguma coisa. Ver docs/04-seguranca.md.
 */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 20 bytes, o tamanho recomendado para HMAC-SHA1. */
export function generateSecret(): string {
  return toBase32(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateCode(secretBase32: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  return hotp(fromBase32(secretBase32), counter);
}

/**
 * Aceita o período atual e um para cada lado, para tolerar relógio dessincronizado.
 * A comparação é em tempo constante.
 */
export function verifyCode(secretBase32: string, code: string, at: number = Date.now()): boolean {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  const secret = fromBase32(secretBase32);
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  const expected = Buffer.from(candidate, 'utf8');

  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    const actual = Buffer.from(hotp(secret, counter + drift), 'utf8');
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, username: string): string {
  const label = encodeURIComponent(`Trindade:${username}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: 'Trindade',
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- cifra do segredo ---------------------------------------------------

const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const raw = config.TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOTP_ENCRYPTION_KEY é obrigatória — rode pnpm keygen');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY precisa ter 32 bytes em base64');
  return key;
}

/** Formato guardado: `iv.tag.ciphertext`, tudo em base64url. */
export function encryptSecret(secretBase32: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [ivPart, tagPart, dataPart] = stored.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('segredo TOTP corrompido');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

// --- códigos de recuperação ---------------------------------------------

export const RECOVERY_CODE_COUNT = 10;

/**
 * Sem e-mail no sistema, estes códigos são a única saída se a pessoa perder o
 * telefone. Formato `xxxxx-xxxxx` com alfabeto sem caracteres ambíguos.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(10);
    let code = '';
    for (let j = 0; j < 10; j += 1) {
      if (j === 5) code += '-';
      code += alphabet[(bytes[j] ?? 0) % alphabet.length];
    }
    codes.push(code);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s/g, '');
}
