"""Ações da mensagem: guardar, fixar, responder, reagir e o teclado.

Fatia 3 da fase 5. Duas contas, porque metade do que se verifica aqui é
justamente o que **não** atravessa de uma pessoa para a outra.

Precisa do elenco e do histórico semeados:

    pnpm dev:seed
    docker compose exec -T postgres psql -U trindade -d trindade \
        < e2e/semear-historico.sql
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


def entrar(pg, usuario, senha):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.goto(f'{BASE}/c/geral', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1200)


def ultima(pg):
    return pg.locator('article[class*="mensagem"]').last


def escrever(pg, texto):
    pg.click('#compositor')
    pg.fill('#compositor', texto)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1000)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark')
    pgA = ctxA.new_page()
    erros = []
    pgA.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgA, 'alex', 'cavalo-bateria-grampo-9')

    ctxB = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
    pgB = ctxB.new_page()
    pgB.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgB, 'daniel', 'cavalo-bateria-grampo-9')

    marca = str(int(time.time()))[-6:]
    alvo_txt = f'mensagem alvo {marca}'
    escrever(pgA, alvo_txt)
    pgB.wait_for_selector(f'text={alvo_txt}', timeout=8000)

    alvoA = ultima(pgA)
    alvoB = ultima(pgB)

    # --- 1. a barra aparece no hover, sem atraso ---------------------------
    alvoA.hover()
    pgA.wait_for_timeout(250)
    barra = alvoA.locator('div[class*="acoes"]')
    check('a barra de ações aparece no hover', barra.is_visible())

    transicao = barra.evaluate('el => getComputedStyle(el).transitionDuration')
    # Transição de opacidade a cada movimento do mouse cintila numa lista
    # longa: a barra pisca dezenas de vezes enquanto o ponteiro atravessa.
    check('e sem transição', transicao in ('0s', '0s, 0s'), transicao)
    pgA.screenshot(path=str(SHOTS / '55-acoes.png'))

    # --- 2. guardar é só seu ------------------------------------------------
    alvoA.locator('button[aria-label*="Guardar"]').click()
    pgA.wait_for_timeout(900)
    check(
        'o botão de guardar troca de estado',
        alvoA.locator('button[aria-label*="Tirar das guardadas"]').count() == 1,
    )

    # A linha não pode mudar de aparência: a mesma conversa pareceria
    # diferente para cada pessoa.
    marcaNaLinha = alvoA.evaluate(
        "el => el.className + ' ' + JSON.stringify(el.dataset)"
    )
    check('guardar não marca a mensagem no histórico', 'guardada' not in marcaNaLinha.lower())

    alvoB.hover()
    pgB.wait_for_timeout(250)
    check(
        'a outra pessoa não vê a mensagem como guardada',
        alvoB.locator('button[aria-label*="Guardar para você"]').count() == 1,
    )

    # --- 3. o painel de guardadas -------------------------------------------
    pgA.keyboard.press('Control+Shift+B')
    pgA.wait_for_timeout(1200)
    painel = pgA.locator('aside[aria-label="Guardadas"]')
    check('Ctrl ⇧ B abre as guardadas', painel.count() == 1)
    check(
        'a linha nomeia o canal de origem',
        pgA.locator('span[class*="linhaCanal"]').first.inner_text() == '#geral',
    )
    pgA.screenshot(path=str(SHOTS / '56-guardadas.png'))

    pgB.keyboard.press('Control+Shift+B')
    pgB.wait_for_timeout(1200)
    # Escopado ao painel: a mensagem está visível no canal atrás dele, e uma
    # busca na página inteira encontraria ela ali e passaria por engano.
    check(
        'a lista do outro não tem a mensagem',
        pgB.locator('aside[aria-label="Guardadas"]').locator(f'text={alvo_txt}').count() == 0,
    )
    pgB.keyboard.press('Control+Shift+B')
    pgA.keyboard.press('Control+Shift+B')
    pgA.wait_for_timeout(500)

    # --- 4. fixar é de todo mundo -------------------------------------------
    alvoA.hover()
    pgA.wait_for_timeout(250)
    alvoA.locator('button[aria-label*="Fixar"]').click()
    pgA.wait_for_timeout(1200)

    check('fixar marca a mensagem para quem fixou', alvoA.locator('span[class*="selo"]').count() == 1)
    check(
        'e para todo mundo, em tempo real',
        alvoB.locator('span[class*="selo"]').count() == 1,
    )

    pgB.keyboard.press('Control+p')
    pgB.wait_for_timeout(1200)
    check('Ctrl P abre as fixadas do canal', pgB.locator('aside[aria-label="Fixadas"]').count() == 1)
    check(
        'a fixada aparece para o outro',
        pgB.locator('aside[aria-label="Fixadas"]').locator(f'text={alvo_txt}').count() > 0,
    )
    pgB.keyboard.press('Control+p')

    # --- 5. reagir ----------------------------------------------------------
    alvoA.hover()
    pgA.wait_for_timeout(250)
    alvoA.locator('button[aria-label="Reagir com 👍"]').click()
    pgA.wait_for_timeout(1000)
    check('a reação rápida entra', alvoA.locator('button[class*="reacao"]').count() >= 1)
    check('e chega no outro lado', alvoB.locator('button[class*="reacao"]').count() >= 1)

    # --- 6. seletor de emoji -------------------------------------------------
    alvoA.hover()
    pgA.wait_for_timeout(250)
    alvoA.locator('button[aria-label="Escolher emoji"]').click()
    pgA.wait_for_timeout(500)
    grade = pgA.locator('div[role="listbox"][aria-label="Emojis"]')
    check('o seletor de emoji abre', grade.count() == 1)

    pgA.fill('input[aria-label="Buscar emoji"]', 'fogo')
    pgA.wait_for_timeout(300)
    primeiro = pgA.locator('button[role="option"]').first
    check('a busca em português encontra', primeiro.inner_text() == '🔥', primeiro.inner_text())
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(1000)
    check(
        'escolher pelo teclado adiciona a reação',
        alvoA.locator('button[class*="reacao"]').count() >= 2,
    )
    pgA.screenshot(path=str(SHOTS / '57-emoji.png'))

    # --- 7. responder --------------------------------------------------------
    alvoA.hover()
    pgA.wait_for_timeout(250)
    alvoA.locator('button[aria-label="Responder"]').click()
    pgA.wait_for_timeout(400)
    check('a barra de resposta aparece', pgA.locator('div[class*="barraContexto"]').count() == 1)

    resposta_txt = f'esta é a resposta {marca}'
    pgA.fill('#compositor', resposta_txt)
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(1400)

    nova = ultima(pgA)
    check('a resposta carrega a citação', nova.locator('button[class*="citacaoTexto"]').count() == 1)
    check(
        'e a citação mostra o texto original',
        alvo_txt in nova.locator('button[class*="citacaoTexto"]').inner_text(),
    )
    pgA.screenshot(path=str(SHOTS / '58-resposta.png'))

    # Clicar na citação rola até a original e a pisca.
    nova.locator('button[class*="citacaoTexto"]').click()
    pgA.wait_for_timeout(300)
    check(
        'clicar na citação acende a mensagem original',
        pgA.locator('article[data-destacada]').count() == 1,
    )
    pgA.wait_for_timeout(1000)
    check('e o destaque apaga sozinho', pgA.locator('article[data-destacada]').count() == 0)

    # --- 8. teclado ----------------------------------------------------------
    pgA.click('#compositor')
    pgA.keyboard.down('Shift')
    pgA.keyboard.press('Tab')
    pgA.keyboard.up('Shift')
    pgA.wait_for_timeout(500)
    ativo = pgA.evaluate("() => document.activeElement?.tagName")
    check('⇧ Tab entra na lista', ativo == 'ARTICLE', str(ativo))

    if ativo == 'ARTICLE':
        antes = pgA.evaluate("() => document.activeElement.getAttribute('data-id')")
        pgA.keyboard.press('ArrowUp')
        pgA.wait_for_timeout(400)
        depois = pgA.evaluate("() => document.activeElement.getAttribute('data-id')")
        check('↑ move o foco para a mensagem anterior', antes != depois)

        pgA.keyboard.press('s')
        pgA.wait_for_timeout(900)
        check(
            'S guarda a mensagem em foco',
            pgA.evaluate(
                "() => document.activeElement.querySelector('button[aria-label*=\"Tirar\"]') !== null"
            ),
        )

        pgA.keyboard.press('x')
        pgA.wait_for_timeout(400)
        check(
            'uma letra qualquer vai para o compositor, com a letra',
            pgA.input_value('#compositor') == 'x',
            repr(pgA.input_value('#compositor')),
        )
        pgA.fill('#compositor', '')

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

passou = sum(1 for _, ok, _ in resultados if ok)
print(f'\n{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
