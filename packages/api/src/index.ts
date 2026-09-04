import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/index.js';
import { garantirBalde, storageConfigurado } from './lib/storage.js';
import { agendarFaxina } from './services/faxina.js';

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

// Anexos órfãos, nonces cumpridos, tokens vencidos e auditoria antiga: quatro
// coisas que crescem para sempre se ninguém as varrer.
const pararFaxina = agendarFaxina(app.log);

try {
  await app.listen({ port: config.PORT, host: config.API_HOST });
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
        pararFaxina();
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
