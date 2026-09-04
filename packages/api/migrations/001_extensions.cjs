/* eslint-disable @typescript-eslint/no-require-imports */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`create extension if not exists pgcrypto`); // gen_random_uuid()
  pgm.sql(`create extension if not exists citext`); // username sem case
  pgm.sql(`create extension if not exists pg_trgm`); // busca por similaridade
};

exports.down = (pgm) => {
  pgm.sql(`drop extension if exists pg_trgm`);
  pgm.sql(`drop extension if exists citext`);
  pgm.sql(`drop extension if exists pgcrypto`);
};
