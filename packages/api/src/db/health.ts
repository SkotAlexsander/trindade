import { sql } from './index.js';

/** Toca o banco de verdade. Um health check que não consulta não vale nada. */
export async function pingDatabase(): Promise<boolean> {
  try {
    const rows = await sql<{ ok: number }[]>`select 1 as ok`;
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
