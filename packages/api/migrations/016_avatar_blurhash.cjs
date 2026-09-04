exports.shorthands = undefined;

/**
 * A mancha de cor do avatar enquanto ele carrega.
 *
 * A 002 guardou `avatar_key` e mais nada. O blurhash é pedido pela fase 6, e
 * vive junto da chave porque as duas mudam na mesma operação: trocar a foto
 * troca as duas, e apagar a foto apaga as duas.
 */
exports.up = (pgm) => {
  pgm.sql(`alter table users add column avatar_blurhash text`);
};

exports.down = (pgm) => {
  pgm.sql(`alter table users drop column avatar_blurhash`);
};
