import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * Copia as fontes do Excalidraw para `public/excalidraw/fonts`.
 *
 * Sem isto o Excalidraw busca as fontes em `esm.sh` — uma requisição externa, do
 * navegador de cada pessoa, que a CSP recusa (`font-src 'self'`) e que o produto
 * não faz em lugar nenhum. As fontes vêm do pacote instalado e não do
 * repositório: versionar binário que já está no `node_modules` é como ele
 * envelhece sem ninguém notar.
 *
 * **Xiaolai fica de fora.** São 13 MB de ideogramas para o caso de alguém
 * escrever em chinês num quadro; as outras oito somam meio mega. Sem ela, texto
 * CJK cai na fonte do sistema — em vez de fazer todo mundo baixar 13 MB.
 *
 * **Só copia quando precisa.** A primeira versão apagava e recopiava tudo a
 * cada `dev` e a cada `build`; no Windows, um `build` com o servidor de
 * desenvolvimento no ar derruba o servidor com `EBUSY` — o watcher do Vite está
 * com os arquivos abertos no instante em que eles somem. A marca com a versão
 * do pacote resolve, e de quebra o `dev` deixa de esperar a cópia.
 */

const require = createRequire(import.meta.url);
// Pelo `index.js` e não pelo `package.json`: o pacote não exporta o segundo, e
// `require.resolve` respeita a lista de `exports`.
const dist = dirname(require.resolve('@excalidraw/excalidraw'));
const origem = join(dist, 'fonts');
const raiz = resolve(import.meta.dirname, '..', 'public', 'excalidraw');
const destino = join(raiz, 'fonts');
const marca = join(raiz, '.versao');

const FORA = new Set(['Xiaolai']);

const { version } = JSON.parse(
  await readFile(resolve(dist, '..', '..', 'package.json'), 'utf8'),
);
const esperado = `@excalidraw/excalidraw ${version}\n`;

const atual = await readFile(marca, 'utf8').catch(() => null);
if (atual === esperado) {
  console.log(`fontes do quadro: já em dia (${version})`);
} else {
  await rm(raiz, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });

  const familias = (await readdir(origem, { withFileTypes: true })).filter(
    (f) => f.isDirectory() && !FORA.has(f.name),
  );

  for (const familia of familias) {
    await cp(join(origem, familia.name), join(destino, familia.name), { recursive: true });
  }

  await writeFile(marca, esperado);
  console.log(`fontes do quadro: ${familias.length} famílias copiadas (${version})`);
}
