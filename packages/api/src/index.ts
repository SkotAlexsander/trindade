import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/index.js';
import { garantirBalde, storageConfigurado } from './lib/storage.js';
import { iniciarVarredura } from './services/varredura-de-anexos.js';

const app = await buildApp();

if (storageConfigurado()) {
  try {
    await garantirBalde();
  } catch (err) {
    // Sem storage a API sobe assim mesmo, só sem anexo: um MinIO fora do ar
    // não pode impedir cinco pessoas de conversarem.
    app.log.error({ err }, 'não consegui falar com o storage — anexos vão falhar');
  }
}

const pararVarredura = iniciarVarredura(app.log);

try {
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error({ err }, 'não subiu');
  process.exit(1);
}

// Desligamento gracioso: para de aceitar, drena o que está em voo, fecha o pool.
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'desligando');
    void (async () => {
      try {
        pararVarredura();
        await app.close();
        await closePool();
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'falha no desligamento');
        process.exit(1);
      }
    })();
  });
}
