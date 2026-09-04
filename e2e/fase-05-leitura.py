"""Estado de leitura e autocompletar — o fim da fase 5.

Duas janelas: o não lido de uma só existe porque a outra escreveu.

    pnpm dev:seed
"""

import sys
import time
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
    pg.wait_for_timeout(1500)


def estado(pg, slug):
    return pg.evaluate(
        """(slug) => {
            const link = [...document.querySelectorAll('a[href^="/c/"]')]
                .find(a => a.getAttribute('href') === '/c/' + slug);
            if (!link) return null;
            return {
                naoLido: link.dataset.unread ?? link.getAttribute('data-unread'),
                mencoes: link.textContent.match(/\\d+$/)?.[0] ?? null,
                peso: getComputedStyle(link.querySelector('span, strong') || link).fontWeight,
            };
        }""",
        slug,
    )


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark')
    pgA = ctxA.new_page()
    erros = []
    pgA.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgA, 'alex', 'geral')

    ctxB = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
    pgB = ctxB.new_page()
    pgB.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgB, 'daniel', 'produto')

    marca = str(int(time.time()))[-6:]

    # --- 1. o canal aberto não fica não lido ------------------------------
    inicial = estado(pgA, 'geral')
    check('o canal aberto começa lido', inicial and inicial['naoLido'] != 'true', str(inicial))

    # --- 2. mensagem em outro canal marca não lido ------------------------
    pgB.click('#compositor')
    pgB.fill('#compositor', f'chegando em produto {marca}')
    pgB.keyboard.press('Enter')
    pgA.wait_for_timeout(1800)

    produto = estado(pgA, 'produto')
    check('outro canal fica não lido', produto and produto['naoLido'] == 'true', str(produto))
    check('e o não lido não depende só de cor', produto and int(produto['peso']) >= 600,
          str(produto))
    pgA.screenshot(path=str(SHOTS / '63-nao-lido.png'))

    # --- 3. menção soma no distintivo -------------------------------------
    #
    # Mede o incremento, não o valor: o banco de desenvolvimento acumula
    # menções pendentes de execuções anteriores, e exigir "1" faria o teste
    # passar só na primeira vez depois de recriar o banco.
    antesDaMencao = int((estado(pgA, 'produto') or {}).get('mencoes') or 0)

    pgB.fill('#compositor', f'@alex olha isso {marca}')
    pgB.keyboard.press('Enter')
    pgA.wait_for_timeout(1800)

    comMencao = estado(pgA, 'produto')
    depoisDaMencao = int((comMencao or {}).get('mencoes') or 0)
    check('menção soma um no distintivo', depoisDaMencao == antesDaMencao + 1,
          f'{antesDaMencao} -> {depoisDaMencao}')

    # --- 4. abrir o canal zera --------------------------------------------
    pgA.click('a[href="/c/produto"]')
    pgA.wait_for_timeout(2500)
    depois = estado(pgA, 'produto')
    check('abrir o canal zera o não lido', depois and depois['naoLido'] != 'true', str(depois))
    check('e o distintivo de menção some', depois and depois['mencoes'] is None, str(depois))

    # --- 5. o estado sobrevive ao recarregar ------------------------------
    pgB.goto(f'{BASE}/c/bugs', wait_until='networkidle')
    pgB.wait_for_selector('#compositor')
    pgB.wait_for_timeout(1000)
    pgB.click('#compositor')
    pgB.fill('#compositor', f'agora em bugs {marca}')
    pgB.keyboard.press('Enter')
    pgA.wait_for_timeout(1500)

    pgA.reload(wait_until='networkidle')
    pgA.wait_for_timeout(2500)
    bugs = estado(pgA, 'bugs')
    # Antes desta fatia o não lido vinha do índice na lista e o F5 devolvia
    # sempre a mesma mentira.
    check('o não lido vem do servidor e sobrevive ao F5',
          bugs and bugs['naoLido'] == 'true', str(bugs))

    # --- 6. autocompletar de pessoa ---------------------------------------
    pgA.click('#compositor')
    pgA.fill('#compositor', '')
    pgA.type('#compositor', '@')
    pgA.wait_for_timeout(400)
    lista = pgA.locator('div[role="listbox"][aria-label="Sugestões"]')
    check('`@` sozinho abre a lista', lista.count() == 1)
    itens = pgA.locator('div[aria-label="Sugestões"] button[role="option"]')
    check('e já mostra o elenco todo', itens.count() >= 5, f'{itens.count()} itens')
    pgA.screenshot(path=str(SHOTS / '64-autocompletar.png'))

    pgA.type('#compositor', 'car')
    pgA.wait_for_timeout(400)
    check('digitar filtra', pgA.locator('div[aria-label="Sugestões"] button').count() == 1)

    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(300)
    valor = pgA.input_value('#compositor')
    check('Enter completa com o nome de usuário', valor == '@carla ', repr(valor))
    check('e a lista fecha', pgA.locator('div[aria-label="Sugestões"]').count() == 0)

    # Enter com a lista aberta não envia.
    antes = pgA.locator('article[class*="mensagem"]').count()
    pgA.fill('#compositor', '')
    pgA.type('#compositor', '@al')
    pgA.wait_for_timeout(400)
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(600)
    check('Enter com a lista aberta escolhe, não envia',
          pgA.locator('article[class*="mensagem"]').count() == antes)

    # --- 7. canal e emoji --------------------------------------------------
    pgA.fill('#compositor', '')
    pgA.type('#compositor', '#ger')
    pgA.wait_for_timeout(400)
    check('`#` sugere canal',
          '#geral' in pgA.locator('div[aria-label="Sugestões"]').inner_text())

    pgA.fill('#compositor', '')
    pgA.type('#compositor', ':fog')
    pgA.wait_for_timeout(400)
    check('`:` sugere emoji',
          '🔥' in pgA.locator('div[aria-label="Sugestões"]').inner_text())
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(300)
    check('e completa com o próprio emoji', pgA.input_value('#compositor') == '🔥 ',
          repr(pgA.input_value('#compositor')))

    # `Esc` fecha sem apagar o texto.
    pgA.fill('#compositor', '')
    pgA.type('#compositor', '@al')
    pgA.wait_for_timeout(400)
    pgA.keyboard.press('Escape')
    pgA.wait_for_timeout(300)
    check('Esc fecha a lista', pgA.locator('div[aria-label="Sugestões"]').count() == 0)
    check('sem apagar o que estava escrito', pgA.input_value('#compositor') == '@al')

    # E não abre no meio de uma palavra.
    pgA.fill('#compositor', '')
    pgA.type('#compositor', 'alguem@exe')
    pgA.wait_for_timeout(400)
    check('não abre dentro de um e-mail',
          pgA.locator('div[aria-label="Sugestões"]').count() == 0)

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

passou = sum(1 for _, ok, _ in resultados if ok)
print(f'\n{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
