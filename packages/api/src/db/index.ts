import postgres from 'postgres';
import { config } from '../config.js';

/**
 * Pool único do processo. Uma função exportada por operação nos outros
 * arquivos de `db/` — sem lógica de negócio aqui.
 */
export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
  transform: { undefined: null },
});

export type Sql = typeof sql;

export async function closePool(): Promise<void> {
  await sql.end({ timeout: 5 });
}
