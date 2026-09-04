import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import type { ApiError } from '@trindade/shared';

/**
 * Erros do Fastify que são culpa do cliente, traduzidos para a linguagem do
 * contrato. Sem isso todos viram `INTERNAL_ERROR` e o cliente não sabe o que
 * corrigir.
 */
const CLIENT_ERRORS: Record<string, { error: string; code: string }> = {
  FST_ERR_CTP_EMPTY_JSON_BODY: { error: 'corpo da requisição vazio', code: 'INVALID_BODY' },
  FST_ERR_CTP_INVALID_JSON_BODY: { error: 'corpo da requisição inválido', code: 'INVALID_BODY' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    error: 'tipo de conteúdo não suportado',
    code: 'UNSUPPORTED_MEDIA_TYPE',
  },
  FST_ERR_CTP_BODY_TOO_LARGE: { error: 'conteúdo grande demais', code: 'FILE_TOO_LARGE' },
};

/**
 * Ponto único de saída de erro. Toda resposta de erro da API tem a forma
 * `{ error, code, field? }`. Ver docs/05-contrato-api.md.
 */
export const errorHandler = fp(function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      const body: ApiError = { error: err.message, code: err.code };
      if (err.field) body.field = err.field;
      return reply.code(err.statusCode).send(body);
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const body: ApiError = { error: 'entrada inválida', code: 'INVALID_INPUT' };
      const field = err.validation[0]?.params.issue.path.join('.');
      if (field) body.field = field;
      return reply.code(400).send(body);
    }

    // Resposta que não bate com o schema declarado é bug nosso, nunca do
    // cliente. Registra e devolve 500 sem detalhe.
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'resposta não bateu com o schema declarado');
      return reply.code(500).send({ error: 'falha interna', code: 'INTERNAL_ERROR' });
    }

    const status = err.statusCode ?? 500;

    if (status === 429) {
      return reply.code(429).send({ error: 'muitas tentativas', code: 'RATE_LIMITED' });
    }

    // Erro de 4xx é do cliente, não nosso. Chamar isso de "falha interna"
    // manda quem depura procurar bug no servidor por um corpo malformado.
    if (status < 500) {
      req.log.warn({ code: err.code, status }, 'requisição malformada');
      return reply.code(status).send({
        error: CLIENT_ERRORS[err.code ?? '']?.error ?? 'requisição inválida',
        code: CLIENT_ERRORS[err.code ?? '']?.code ?? 'BAD_REQUEST',
      });
    }

    // Nada de vazar stack ou mensagem de driver para o cliente.
    req.log.error({ err }, 'erro não tratado');
    return reply.code(500).send({ error: 'falha interna', code: 'INTERNAL_ERROR' });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ error: 'rota não encontrada', code: 'NOT_FOUND' });
  });
});
