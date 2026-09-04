/**
 * Erro tipado. O plugin de erro converte isto na forma única da API:
 * `{ error, code, field? }`. Ver docs/05-contrato-api.md.
 *
 * Regra da camada: `services/` e `db/` lançam AppError e não sabem que HTTP
 * existe. Quem traduz para status é o plugin.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(statusCode: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.field = field;
  }
}

export const badRequest = (code: string, message: string, field?: string) =>
  new AppError(400, code, message, field);

export const unauthorized = (code: string, message: string) => new AppError(401, code, message);

export const forbidden = (code: string, message: string) => new AppError(403, code, message);

export const notFound = (code: string, message: string) => new AppError(404, code, message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const tooLarge = (code: string, message: string) => new AppError(413, code, message);

export const rateLimited = (code: string, message: string) => new AppError(429, code, message);
