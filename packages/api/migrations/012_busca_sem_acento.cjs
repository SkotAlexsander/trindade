exports.shorthands = undefined;

/**
 * Busca que encontra com acento e sem.
 *
 * A configuração `portuguese` faz stemming mas **não** remove acento: quem
 * digita "migracao" não acha "migração". O aceite da fase 5 e o roteiro do
 * COMECE-AQUI exigem que as duas formas encontrem.
 *
 * A solução é uma configuração própria que encadeia `unaccent` antes do
 * stemmer português. Ela precisa existir como configuração nomeada — e não
 * como chamada a `unaccent()` dentro do `to_tsvector` — porque a coluna é
 * gerada, e coluna gerada exige função IMMUTABLE. `unaccent(text)` é STABLE;
 * `to_tsvector(regconfig, text)` é IMMUTABLE.
 */
exports.up = (pgm) => {
  pgm.sql(`create extension if not exists unaccent`);

  pgm.sql(`
    create text search configuration pt_unaccent (copy = portuguese)
  `);
  pgm.sql(`
    alter text search configuration pt_unaccent
      alter mapping for hword, hword_part, word
      with unaccent, portuguese_stem
  `);

  // Coluna gerada não se altera: recria-se.
  pgm.sql(`drop index if exists messages_search`);
  pgm.sql(`alter table messages drop column search_vector`);
  pgm.sql(`
    alter table messages add column search_vector tsvector
      generated always as (to_tsvector('pt_unaccent', content)) stored
  `);
  pgm.sql(`create index messages_search on messages using gin (search_vector)`);
};

exports.down = (pgm) => {
  pgm.sql(`drop index if exists messages_search`);
  pgm.sql(`alter table messages drop column search_vector`);
  pgm.sql(`
    alter table messages add column search_vector tsvector
      generated always as (to_tsvector('portuguese', content)) stored
  `);
  pgm.sql(`create index messages_search on messages using gin (search_vector)`);
  pgm.sql(`drop text search configuration if exists pt_unaccent`);
};
