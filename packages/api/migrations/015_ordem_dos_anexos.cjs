exports.shorthands = undefined;

/**
 * A ordem em que a pessoa escolheu os arquivos.
 *
 * Sem esta coluna, a grade sai na ordem de `created_at`, que é o instante em
 * que **o upload terminou** — e os uploads correm em paralelo. Anexar o azul e
 * depois o verde mostrava o verde primeiro sempre que ele era menor. É uma
 * daquelas coisas que ninguém reporta como bug e todo mundo estranha.
 *
 * `sort_order` e não `position`: `position` é função no Postgres
 * (`position(x in y)`) e a coluna precisaria de aspas em metade dos lugares.
 */
exports.up = (pgm) => {
  pgm.sql(`alter table attachments add column sort_order smallint not null default 0`);
};

exports.down = (pgm) => {
  pgm.sql(`alter table attachments drop column sort_order`);
};
