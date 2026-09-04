"""Cartão de perfil e permissões na interface.

Fatia 2 da fase 6. O atraso de 300ms ao sair do mouse é o assunto principal:
sem ele, atravessar a borda do cartão o fecha na cara de quem ia clicar.

    pnpm dev:seed
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
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


CARTAO = 'div[aria-label^="Perfil de"]'

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pg, 'daniel')

    # --- 1. abre no hover, mas não na hora -----------------------------------
    alguem = pg.locator('[aria-label="Elenco"] button').nth(1)
    alguem.hover()
    pg.wait_for_timeout(200)
    check('não abre antes dos 400ms', pg.locator(CARTAO).count() == 0)

    pg.wait_for_timeout(700)
    check('abre no hover depois de 400ms', pg.locator(CARTAO).count() == 1)
    pg.screenshot(path=str(SHOTS / '70-cartao-de-perfil.png'))

    # --- 2. o atraso de 300ms ao sair ---------------------------------------
    #
    # O ponto inteiro do atraso: quem vai do avatar até o botão dentro do
    # cartão passa por fora dos dois retângulos. Fechar na hora tornaria o
    # cartão inalcançável pelo mouse.
    caixa = pg.locator(CARTAO).bounding_box()
    pg.mouse.move(caixa['x'] - 60, caixa['y'] + 40)
    pg.wait_for_timeout(120)
    check('não fecha na hora em que o mouse sai', pg.locator(CARTAO).count() == 1)
    pg.wait_for_timeout(700)
    check('mas fecha depois de 300ms', pg.locator(CARTAO).count() == 0)

    # --- 3. o conteúdo -------------------------------------------------------
    alguem.hover()
    pg.wait_for_selector(CARTAO, timeout=5000)
    cartao = pg.locator(CARTAO)
    texto = cartao.inner_text()
    check('mostra o @usuario', '@' in texto, texto.split('\n')[1] if '\n' in texto else texto)
    check('mostra desde quando a pessoa está aqui', 'Está aqui desde' in texto)
    check('e o status por extenso', any(
        s in texto for s in ('Disponível', 'Ausente', 'Ocupado', 'Offline')), texto)

    # A faixa do topo existe e não é da cor do cartão — o padrão `--mid` do
    # documento era literalmente `--bg-raised` e sumia.
    faixa = pg.evaluate(
        """() => {
            const c = document.querySelector('div[aria-label^="Perfil de"]');
            return {
                faixa: getComputedStyle(c.firstElementChild).backgroundColor,
                altura: c.firstElementChild.getBoundingClientRect().height,
                cartao: getComputedStyle(c).backgroundColor,
            };
        }"""
    )
    check('a faixa do topo tem 56px', abs(faixa['altura'] - 56) < 2, str(faixa['altura']))
    check('e não é da mesma cor do cartão', faixa['faixa'] != faixa['cartao'], str(faixa))

    # --- 4. chip de cargo legível -------------------------------------------
    contraste = pg.evaluate(
        """() => {
            function lum(c) {
                const [r,g,b] = c.match(/\\d+/g).map(Number).map(v => {
                    const s = v/255; return s <= 0.03928 ? s/12.92 : ((s+0.055)/1.055)**2.4;
                });
                return 0.2126*r + 0.7152*g + 0.0722*b;
            }
            const c = document.querySelector('div[aria-label^="Perfil de"]');
            const chips = [...c.querySelectorAll('span')].filter(
                e => e.children.length === 1 && e.textContent.trim().length > 0
                     && getComputedStyle(e).borderRadius.startsWith('999'));
            return chips.map(ch => {
                const s = getComputedStyle(ch);
                const a = lum(s.color), b = lum(s.backgroundColor);
                return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
            });
        }"""
    )
    check('todo chip de cargo passa de 4.5:1', bool(contraste) and all(r >= 4.5 for r in contraste),
          str([round(r, 1) for r in contraste]))

    # --- 5. o cartão de outra pessoa oferece mensagem; o seu, edição --------
    check('no cartão de outro o botão é "Mandar mensagem"', 'Mandar mensagem' in texto, texto)

    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)
    check('Esc fecha o cartão', pg.locator(CARTAO).count() == 0)

    eu = pg.locator('[aria-label="Elenco"] button[aria-label^="Daniel"]').first
    if eu.count() == 0:
        eu = pg.locator('[aria-label="Elenco"] button').first
    eu.hover()
    pg.wait_for_selector(CARTAO, timeout=5000)
    check('no seu próprio cartão o botão vira "Editar perfil"',
          'Editar perfil' in pg.locator(CARTAO).inner_text(),
          pg.locator(CARTAO).inner_text()[-40:])

    # --- 6. clicar num avatar de mensagem também abre ------------------------
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)
    avatar = pg.locator('article[class*="mensagem"] span[class*="Avatar"]').first
    if avatar.count() == 0:
        avatar = pg.locator('article[class*="mensagem"]').first.locator('span').first
    avatar.hover()
    pg.wait_for_timeout(900)
    check('o avatar na conversa também abre o cartão', pg.locator(CARTAO).count() == 1)

    # --- 7. permissões escondem o que não dá para fazer ---------------------
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    pg.click('button[aria-haspopup="menu"]')
    pg.wait_for_selector('[role="menu"]', timeout=5000)
    itens = pg.evaluate(
        """() => [...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())"""
    )
    check('membro comum não vê "Cargos e permissões"',
          'Cargos e permissões' not in itens, str(itens))
    # Escondido, nunca esmaecido: item desabilitado ensina que existe algo que
    # a pessoa não pode fazer, e não há nada a ensinar aqui.
    check('e nada aparece desabilitado',
          pg.locator('[role="menuitem"][aria-disabled="true"]').count() == 0)

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
