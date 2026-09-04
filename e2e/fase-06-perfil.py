"""Editar perfil, recortar a foto e segurança da conta.

Fatia 3 da fase 6.

    pnpm dev:seed
"""

import sys
import time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
import fixturas  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
TMP = Path(__file__).parent / '.tmp'
BASE = 'http://localhost:5173'
API = 'http://localhost:3000'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def entrar(pg, usuario):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1200)


def abrir(pg, aba='Editar perfil'):
    pg.locator('button[aria-haspopup="menu"]', has_text='Eva').first.click()
    pg.wait_for_timeout(400)
    pg.locator('[role="menuitem"]', has_text=aba).click()
    pg.wait_for_selector('dialog[open]', timeout=5000)
    pg.wait_for_timeout(400)


foto = fixturas.foto_com_exif(TMP / 'retrato.jpg', cor=(40, 160, 90), tamanho=(900, 600))
marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg, 'eva')

    # --- 1. o diálogo -------------------------------------------------------
    abrir(pg)
    dialogo = pg.locator('dialog[open]')
    check('o menu do rodapé abre o diálogo', dialogo.count() == 1)

    caixa = dialogo.bounding_box()
    check('tem 560px de largura', abs(caixa['width'] - 560) < 2, str(caixa['width']))
    # O reset de `globals.css` zera a margem de tudo, e zerar a do `<dialog>`
    # desliga o `margin: auto` que o centraliza. Ele nascia no canto.
    centro = caixa['x'] + caixa['width'] / 2
    check('e nasce centralizado', abs(centro - 1500 / 2) < 4, f'centro em {centro}')

    # --- 2. nome de usuário é texto, não campo ------------------------------
    check('o nome de usuário aparece como texto',
          '@eva' in dialogo.inner_text() and dialogo.locator('input[value="eva"]').count() == 0)
    check('com a explicação ao lado', 'Não pode ser alterado' in dialogo.inner_text())
    check('e nenhum campo desabilitado no diálogo',
          dialogo.locator('input:disabled, textarea:disabled').count() == 0)

    # --- 3. salvar só com alteração -----------------------------------------
    salvar = dialogo.locator('button', has_text='Salvar').first
    check('Salvar começa desligado', salvar.is_disabled())

    campoNome = dialogo.locator('input:not([type="file"]):not([type="range"])').first
    campoNome.fill(f'Eva M {marca}')
    pg.wait_for_timeout(300)
    check('e liga quando algo muda', not salvar.is_disabled())

    # --- 4. contador só a partir de 80% -------------------------------------
    bio = dialogo.locator('textarea').first
    bio.fill('a' * 200)
    pg.wait_for_timeout(300)
    check('o contador não aparece a 200 de 280', '200/280' not in dialogo.inner_text())
    bio.fill('a' * 230)
    pg.wait_for_timeout(300)
    check('e aparece a partir de 224 (80%)', '230/280' in dialogo.inner_text())
    bio.fill(f'construindo o produto {marca}')
    pg.wait_for_timeout(200)

    # --- 5. fechar com mudança pendente pergunta ----------------------------
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)
    check('fechar com alteração pendente pergunta antes',
          pg.locator('[role="alertdialog"]').count() == 1)
    pg.locator('button', has_text='Continuar editando').click()
    pg.wait_for_timeout(300)
    check('e continuar editando mantém o que estava escrito',
          marca in pg.locator('dialog[open] input:not([type="file"])').first.input_value())

    # --- 6. cor de destaque + salvar ----------------------------------------
    dialogo.locator('button[aria-label^="Usar #"]').nth(2).click()
    pg.wait_for_timeout(200)
    pg.screenshot(path=str(SHOTS / '72-editar-perfil.png'))
    salvar.click()
    pg.wait_for_timeout(1500)
    check('salvar fecha o diálogo', pg.locator('dialog[open]').count() == 0)

    check('e o nome novo aparece no rodapé na hora',
          marca in pg.locator('button[aria-haspopup="menu"]').last.inner_text()
          or marca in pg.inner_text('body'))

    # --- 7. a foto ----------------------------------------------------------
    abrir(pg)
    pg.set_input_files('dialog[open] input[type="file"]', str(foto))
    pg.wait_for_timeout(800)
    check('escolher a foto abre o recortador',
          pg.locator('canvas[aria-label="Arraste para enquadrar"]').count() == 1)
    # O `close` programático do `<dialog>` é síncrono e chegava ao listener do
    # render anterior, com o estado velho: salvar reabria a pergunta de
    # descartar. E o StrictMode acendia "não consegui abrir essa imagem" por
    # cima de uma imagem que tinha carregado.
    check('e sem sobras de estado na tela',
          'não consegui abrir' not in pg.locator('dialog[open]').inner_text()
          and pg.locator('[role="alertdialog"]').count() == 0,
          pg.locator('dialog[open]').inner_text()[:60])
    check('com controle de aproximação',
          pg.locator('dialog[open] input[type="range"]').count() == 1)
    pg.screenshot(path=str(SHOTS / '73-recortar-foto.png'))

    pg.locator('dialog[open] button', has_text='Usar esta foto').click()
    pg.wait_for_function(
        """() => {
            const img = document.querySelector('dialog[open] img');
            return img && img.src.includes('/api/files/avatares/');
        }""",
        timeout=20000,
    )
    check('a foto sobe e vira o avatar', True)

    url = pg.evaluate(
        """() => document.querySelector('dialog[open] img').getAttribute('src')"""
    )
    servida = requests.get(f'{API}{url}')
    check('servida como WebP', servida.headers.get('content-type') == 'image/webp',
          str(servida.headers.get('content-type')))
    check('quadrada de 256', servida.content[:4] == b'RIFF', repr(servida.content[:4]))
    # A promessa que está escrita na tela, verificada de verdade.
    check('e sem o metadado que a tela promete remover',
          not fixturas.tem_exif(servida.content))
    check('a linha sobre privacidade está lá',
          'A localização e outros dados da foto são removidos ao enviar'
          in pg.locator('dialog[open]').inner_text())

    # --- 8. aba de segurança -------------------------------------------------
    pg.locator('dialog[open] [role="tab"]', has_text='Conta e segurança').click()
    pg.wait_for_timeout(1200)
    seguranca = pg.locator('dialog[open]').inner_text()
    check('a aba de segurança abre', 'Sessões abertas' in seguranca)
    check('e diz por que não há IP', 'Sem IP' in seguranca, seguranca[:60])

    # A regra do produto inteiro: não registramos IP, então não há o que exibir.
    check('nenhuma sessão mostra endereço de IP',
          not __import__('re').search(r'\b\d{1,3}(\.\d{1,3}){3}\b', seguranca), seguranca[:200])
    check('a sessão atual está marcada', 'esta sessão' in seguranca)
    check('e o segundo fator aparece', 'Verificação em duas etapas' in seguranca)
    pg.screenshot(path=str(SHOTS / '74-seguranca.png'))

    # --- 9. ativar 2FA: os três passos --------------------------------------
    pg.locator('dialog[open] button', has_text='Ativar').first.click()
    pg.wait_for_timeout(1500)
    qr = pg.locator('dialog[open] img[alt*="QR"]')
    check('o passo 1 mostra o QR', qr.count() == 1)
    # `<img>` com data URI, nunca SVG injetado: em `<img>` o SVG é passivo.
    check('e o QR é imagem passiva, não HTML injetado',
          (qr.get_attribute('src') or '').startswith('data:image/svg+xml'),
          (qr.get_attribute('src') or '')[:40])
    check('com o segredo em texto para quem digita à mão',
          pg.locator('dialog[open] code').count() >= 1)

    pg.locator('dialog[open] button', has_text='Já adicionei').click()
    pg.wait_for_timeout(600)
    check('o passo 2 pede os seis dígitos',
          pg.locator('dialog[open] input[inputmode="numeric"]').count() == 6)

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
