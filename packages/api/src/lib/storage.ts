import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

/**
 * Arquivos num S3: MinIO em desenvolvimento, R2 em produção.
 *
 * A escolha é só de variável de ambiente — mesma interface nos dois. Ver
 * "Decisões" no CLAUDE.md.
 */

let cliente: S3Client | null = null;

export function storageConfigurado(): boolean {
  return Boolean(config.S3_ENDPOINT && config.S3_KEY && config.S3_SECRET && config.S3_BUCKET);
}

function s3(): S3Client {
  if (!storageConfigurado()) {
    throw new Error('S3_ENDPOINT/S3_KEY/S3_SECRET/S3_BUCKET não estão configurados');
  }
  cliente ??= new S3Client({
    endpoint: config.S3_ENDPOINT as string,
    region: config.S3_REGION,
    // MinIO não faz virtual-host de bucket sem DNS curinga. O R2 aceita path
    // style também, então a mesma linha serve aos dois.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_KEY as string,
      secretAccessKey: config.S3_SECRET as string,
    },
  });
  return cliente;
}

const balde = (): string => config.S3_BUCKET as string;

/**
 * Chave aleatória, nunca o nome enviado por quem subiu.
 *
 * São 32 bytes: quem serve o arquivo — em produção um domínio de CDN separado,
 * ver docs/04-seguranca.md — não tem como consultar a sessão de ninguém, e a
 * chave é a única barreira. Adivinhar não é uma opção que exista.
 */
export function novaChave(prefixo: string): string {
  return `${prefixo}/${randomBytes(32).toString('base64url')}`;
}

export async function guardar(
  chave: string,
  corpo: Buffer,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: balde(),
      Key: chave,
      Body: corpo,
      ContentType: contentType,
    }),
  );
}

export async function buscar(
  chave: string,
): Promise<{ corpo: Readable; contentType: string | null; byteSize: number | null } | null> {
  try {
    const saida = await s3().send(new GetObjectCommand({ Bucket: balde(), Key: chave }));
    if (!saida.Body) return null;
    return {
      corpo: saida.Body as Readable,
      contentType: saida.ContentType ?? null,
      byteSize: saida.ContentLength ?? null,
    };
  } catch (err) {
    if (naoExiste(err)) return null;
    throw err;
  }
}

export async function apagar(chave: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: balde(), Key: chave }));
  } catch (err) {
    // Apagar o que já não existe é sucesso: a varredura de órfãos roda de novo
    // e não pode travar num arquivo que alguém já removeu.
    if (!naoExiste(err)) throw err;
  }
}

function naoExiste(err: unknown): boolean {
  const nome = (err as { name?: string; Code?: string } | null)?.name;
  return nome === 'NoSuchKey' || nome === 'NotFound' || nome === 'NoSuchBucket';
}

/** Cria o bucket se ele ainda não existe. Só o dev precisa disto. */
/**
 * O storage responde?
 *
 * `HeadBucket` é a pergunta mais barata que existe e mesmo assim atravessa rede,
 * credencial e permissão — que são exatamente as três coisas que quebram.
 */
export async function pingStorage(): Promise<boolean> {
  if (!storageConfigurado()) return false;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: balde() }));
    return true;
  } catch {
    return false;
  }
}

export async function garantirBalde(): Promise<void> {
  if (!storageConfigurado()) return;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: balde() }));
  } catch {
    try {
      await s3().send(new CreateBucketCommand({ Bucket: balde() }));
    } catch (err) {
      if ((err as { name?: string }).name !== 'BucketAlreadyOwnedByYou') throw err;
    }
  }
}
