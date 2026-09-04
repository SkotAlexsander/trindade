import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyObject, type CryptoKey } from 'jose';
import { config } from '../../config.js';
import { AppError, unauthorized } from '../errors.js';

/**
 * Access token: JWT EdDSA, 15 minutos, vive só na memória do JavaScript do
 * cliente. Refresh token: 32 bytes aleatórios, guardado como SHA-256.
 * Ver docs/04-seguranca.md.
 */
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
/** Token curto entre o login e o segundo fator. */
export const MFA_TTL_SECONDS = 5 * 60;

const ISSUER = 'trindade';
const AUDIENCE = 'trindade-web';

type Key = KeyObject | CryptoKey;
let privateKey: Key | null = null;
let publicKey: Key | null = null;

function requireKeyMaterial(): { priv: string; pub: string } {
  const priv = config.JWT_PRIVATE_KEY;
  const pub = config.JWT_PUBLIC_KEY;
  if (!priv || !pub) {
    throw new Error('JWT_PRIVATE_KEY e JWT_PUBLIC_KEY são obrigatórias — rode pnpm keygen');
  }
  // O .env guarda o PEM em uma linha, com \n escapado.
  return { priv: priv.replace(/\n/g, '\n'), pub: pub.replace(/\n/g, '\n') };
}

async function keys(): Promise<{ privateKey: Key; publicKey: Key }> {
  if (!privateKey || !publicKey) {
    const { priv, pub } = requireKeyMaterial();
    privateKey = await importPKCS8(priv, 'EdDSA');
    publicKey = await importSPKI(pub, 'EdDSA');
  }
  return { privateKey, publicKey };
}

export interface AccessClaims {
  sub: string;
  sid: string;
}

export interface MfaClaims {
  sub: string;
  mfa: true;
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  const { privateKey: key } = await keys();
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { publicKey: key } = await keys();
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.sid !== 'string' || payload.mfa) {
      throw unauthorized('INVALID_TOKEN', 'token inválido');
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unauthorized('INVALID_TOKEN', 'token inválido ou expirado');
  }
}

/** Token de passagem entre o login e o código do segundo fator. */
export async function signMfaToken(userId: string): Promise<string> {
  const { privateKey: key } = await keys();
  return new SignJWT({ mfa: true })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MFA_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyMfaToken(token: string): Promise<MfaClaims> {
  const { publicKey: key } = await keys();
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || payload.mfa !== true) {
      throw unauthorized('INVALID_TOKEN', 'token inválido');
    }
    return { sub: payload.sub, mfa: true };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unauthorized('MFA_TOKEN_EXPIRED', 'a verificação expirou, entre de novo');
  }
}

/** O valor entregue ao cliente. Nunca é gravado em claro. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * `Path` restrito de propósito: o cookie não é enviado em nenhuma outra rota,
 * o que reduz a superfície de CSRF a uma só. Ver docs/04-seguranca.md.
 */
export const REFRESH_COOKIE = 'rt';
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';

export function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // Em dev o front roda em http://localhost; `Secure` impediria o cookie.
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
  };
}
