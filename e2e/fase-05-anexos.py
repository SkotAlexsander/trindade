"""Anexos no navegador — a sétima fatia, que fecha a fase 5.

O que a API já garante está em `fase-05-upload-api.py`. Aqui é a outra metade:
o upload que começa ao anexar, a faixa de pendentes, a grade de imagens, a
lightbox e o cartão de link.

    pnpm dev:seed
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
import fixturas  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
TMP = Path(__file__).parent / '.tmp'
BASE = 'http://localhost:5173'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def entrar(pg, usuario, canal='geral'):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.goto(f'{BASE}/c/{canal}', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1200)


foto = fixturas.foto_com_exif(TMP / 'praia.jpg')
azul = fixturas.png(TMP / 'azul.png', cor=(30, 90, 200))
verde = fixturas.png(TMP / 'verde.png', cor=(30, 160, 90))
doc = fixturas.documento(TMP / 'ata-da-reuniao.txt')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctxA = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pgA = ctxA.new_page()
    erros = []
    pgA.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgA, 'alex')

    ctxB = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
    pgB = ctxB.new_page()
    pgB.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgB, 'daniel')

    marca = str(int(time.time()))[-6:]
    faixa = pgA.locator('div[aria-label="Arquivos anexados"]')

    # --- 1. o upload começa ao anexar, não ao enviar -------------------------
    pgA.set_input_files('input[type="file"]', str(foto))
    pgA.wait_for_timeout(400)
    check('a faixa de pendentes aparece ao anexar', faixa.count() == 1)
    check('com a miniatura do arquivo local', faixa.locator('img').count() == 1)

    # Nada foi enviado ainda — o arquivo subiu sozinho.
    pgA.wait_for_function(
        """() => {
            const f = document.querySelector('div[aria-label="Arquivos anexados"]');
            return f && [...f.children].some(c => c.dataset.estado === 'pronto');
        }""",
        timeout=20000,
    )
    check('o arquivo termina de subir sem ninguém apertar Enter', True)
    check('e o compositor continua vazio', pgA.input_value('#compositor') == '')
    pgA.screenshot(path=str(SHOTS / '65-anexo-pendente.png'))

    # --- 2. anexo sem legenda é uma mensagem inteira -------------------------
    antes = pgA.locator('article[class*="mensagem"]').count()
    pgA.click('button[aria-label="Enviar"]')
    pgA.wait_for_timeout(2000)

    check('dá para enviar só a foto, sem escrever nada',
          pgA.locator('article[class*="mensagem"]').count() == antes + 1)
    check('a faixa esvazia depois do envio', faixa.count() == 0)

    ultima = pgA.locator('article[class*="mensagem"]').last
    imagem = ultima.locator('img').first
    check('a imagem aparece na mensagem', imagem.count() == 1)
    src = imagem.get_attribute('src') or ''
    check('servida pela nossa API, com chave aleatória',
          src.startswith('/api/files/anexos/') and 'praia' not in src, src)
    check('e com dimensões antes de carregar, para a conversa não pular',
          bool(imagem.get_attribute('width')) and bool(imagem.get_attribute('height')))

    # O outro lado recebe pelo socket, sem recarregar.
    pgB.wait_for_timeout(1800)
    check('o anexo chega ao outro em tempo real',
          pgB.locator('article[class*="mensagem"]').last.locator('img').count() >= 1)

    # --- 3. a lightbox --------------------------------------------------------
    imagem.click()
    pgA.wait_for_timeout(600)
    caixa = pgA.locator('div[role="dialog"][aria-modal="true"]')
    check('clicar na imagem abre a lightbox', caixa.count() == 1)
    pgA.screenshot(path=str(SHOTS / '66-lightbox.png'))
    pgA.keyboard.press('Escape')
    pgA.wait_for_timeout(400)
    check('Esc fecha a lightbox',
          pgA.locator('div[role="dialog"][aria-modal="true"]').count() == 0)

    # --- 4. grade de várias imagens ------------------------------------------
    # A ordem importa: azul primeiro, verde depois. O upload dos dois corre em
    # paralelo e o menor pode terminar antes — sem `sort_order`, a grade sairia
    # na ordem em que os uploads acabaram.
    pgA.set_input_files('input[type="file"]', [str(azul), str(verde)])
    pgA.wait_for_timeout(2500)
    check('dois arquivos viram duas miniaturas',
          faixa.locator('div[data-estado]').count() == 2)

    pgA.fill('#compositor', f'as duas versões {marca}')
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(2500)

    grade = pgA.locator('article[class*="mensagem"]').last.locator('div[data-quantas]')
    check('duas imagens viram uma grade de dois', grade.get_attribute('data-quantas') == '2',
          str(grade.get_attribute('data-quantas')))
    check('e a legenda vai junto',
          marca in pgA.locator('article[class*="mensagem"]').last.inner_text())

    alts = grade.locator('img').evaluate_all('els => els.map(e => e.alt)')
    check('a grade respeita a ordem em que os arquivos foram escolhidos',
          alts == ['azul.png', 'verde.png'], str(alts))

    # Com mais de uma imagem, a lightbox anda entre elas.
    pgA.locator('article[class*="mensagem"]').last.locator('img').first.click()
    pgA.wait_for_timeout(500)
    contagem = pgA.locator('div[role="dialog"] >> text=/\\d+ de \\d+/')
    check('a lightbox diz em qual imagem você está', contagem.count() == 1)
    pgA.keyboard.press('ArrowRight')
    pgA.wait_for_timeout(300)
    check('a seta anda para a próxima', '2 de 2' in contagem.inner_text(),
          contagem.inner_text())
    pgA.keyboard.press('Escape')
    pgA.wait_for_timeout(300)

    # --- 5. arquivo que não é imagem -----------------------------------------
    pgA.set_input_files('input[type="file"]', str(doc))
    pgA.wait_for_timeout(2500)
    check('arquivo sem miniatura mostra o nome', 'ata-da-reuniao' in faixa.inner_text(),
          faixa.inner_text()[:60])

    pgA.click('button[aria-label="Enviar"]')
    pgA.wait_for_timeout(2200)

    linha = pgA.locator('article[class*="mensagem"]').last.locator('a[download]')
    check('arquivo comum vira uma linha para baixar', linha.count() == 1)
    check('com o nome original', 'ata-da-reuniao.txt' in linha.inner_text(),
          linha.inner_text())
    check('e com o tamanho', 'KB' in linha.inner_text() or 'B' in linha.inner_text(),
          linha.inner_text())
    pgA.screenshot(path=str(SHOTS / '67-anexos-na-conversa.png'))

    # --- 6. remover um pendente ----------------------------------------------
    pgA.set_input_files('input[type="file"]', str(azul))
    pgA.wait_for_timeout(1800)
    check('anexado de novo', faixa.locator('div[data-estado]').count() == 1)
    pgA.locator('div[aria-label="Arquivos anexados"] button[aria-label^="Remover"]').click()
    pgA.wait_for_timeout(400)
    check('o botão de remover tira o anexo', faixa.count() == 0)

    # --- 7. o botão de enviar espera o upload --------------------------------
    check('sem texto e sem anexo, enviar fica desligado',
          pgA.locator('button[aria-label="Enviar"]').is_disabled())

    # --- 8. prévia de link ----------------------------------------------------
    pgA.fill('#compositor', f'olha isto https://example.com/ {marca}')
    pgA.keyboard.press('Enter')
    # A busca sai do servidor e pode levar alguns segundos na primeira vez.
    try:
        pgA.wait_for_selector('a[data-com-imagem]', timeout=20000)
        cartao = pgA.locator('a[data-com-imagem]').last
        check('o link ganha cartão', cartao.count() == 1)
        check('com o título vindo do servidor', 'Example Domain' in cartao.inner_text(),
              cartao.inner_text()[:80])
        check('e o nome do site', 'example.com' in cartao.inner_text().lower())
        # A regra que importa: nada no cartão aponta para fora.
        img_do_cartao = cartao.locator('img')
        externa = (img_do_cartao.get_attribute('src') or '') if img_do_cartao.count() else ''
        check('a miniatura, se houver, vem do nosso domínio',
              externa == '' or externa.startswith('/api/link-preview/thumb/'), externa)
        pgA.screenshot(path=str(SHOTS / '68-previa-de-link.png'))
    except Exception as e:  # noqa: BLE001
        check('o link ganha cartão', False, f'{type(e).__name__}: {str(e)[:80]}')

    # --- 9. link dentro de bloco de código não vira cartão -------------------
    quantos = pgA.locator('a[data-com-imagem]').count()
    pgA.fill('#compositor', '`https://example.com/` num exemplo')
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(3000)
    check('URL dentro de crase não vira cartão',
          pgA.locator('a[data-com-imagem]').count() == quantos,
          f'{quantos} -> {pgA.locator("a[data-com-imagem]").count()}')

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
