"""Modo apresentação: quem conduz, quem segue, e quem soltou.

O aceite da fase 10 para a apresentação, num navegador de verdade: a borda ao
vivo dos dois lados, o espectador seguindo o enquadramento de quem apresenta,
soltar e voltar a seguir sem afetar ninguém, a linha na lista de canais, e as
mensagens de sistema no canal ao começar e ao encerrar.

O zoom é o que se mede: é o único pedaço da viewport que aparece escrito na
tela (o "100%" do rodapé do Excalidraw). Rolagem seguiria pelo mesmo caminho e
não teria como ser lida sem inventar uma sonda.

    docker compose up -d
    pnpm dev
    pnpm dev:seed

    python e2e/fase-10-apresentacao.py <pasta> [quem-apresenta] [quem-assiste]
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

QUEM_APRESENTA, QUEM_ASSISTE = (
    (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('alex', 'bruno')
)

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def espera(pg, funcao, tentativas=60, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


def entrar(b, usuario, senha='cavalo-bateria-grampo-9'):
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(600)
    return ctx, pg, erros


def abrir_painel(pg):
    if pg.locator('aside[aria-label="Quadros"]').count() == 0:
        pg.locator('button[aria-label="Quadros"]').first.click()
    pg.wait_for_selector('aside[aria-label="Quadros"]', timeout=10000)
    pg.wait_for_timeout(400)


def zoom(pg):
    """O que o rodapé do Excalidraw diz. É a viewport que dá para ler."""
    return pg.evaluate("""() => {
        const achado = (document.body.innerText || '').match(/(\d+)%/);
        return achado ? Number(achado[1]) : -1;
    }""")


def apresentando(pg):
    return pg.evaluate("""() => document.querySelector('[data-elementos] header')
        ?.getAttribute('data-apresentando')""")


marca = str(int(time.time()))[-5:]
NOME = f'Apresentacao {marca}'

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, quem, errosA = entrar(b, QUEM_APRESENTA)
    ctxB, plateia, errosB = entrar(b, QUEM_ASSISTE)

    # --- um quadro com alguma coisa dentro -----------------------------------
    abrir_painel(quem)
    quem.fill('input[aria-label="Nome do quadro novo"]', NOME)
    quem.locator('aside[aria-label="Quadros"] button[type="submit"]').click()
    quem.wait_for_selector('canvas', timeout=25000)
    quem.wait_for_timeout(1500)

    caixa = quem.locator('canvas').first.bounding_box()
    quem.mouse.click(caixa['x'] + 120, caixa['y'] + 500)
    quem.keyboard.press('r')
    quem.mouse.move(caixa['x'] + 320, caixa['y'] + 260)
    quem.mouse.down()
    quem.mouse.move(caixa['x'] + 520, caixa['y'] + 400, steps=6)
    quem.mouse.up()
    quem.wait_for_timeout(900)

    abrir_painel(plateia)
    plateia.locator('aside[aria-label="Quadros"] button', has_text=NOME).first.click()
    plateia.wait_for_selector('canvas', timeout=25000)
    plateia.wait_for_timeout(1500)

    # --- apresentar -----------------------------------------------------------
    quem.locator('[data-elementos] header button', has_text='Apresentar').click()

    check('a barra acende dos dois lados',
          espera(quem, """() => document.querySelector('[data-elementos] header')
              ?.getAttribute('data-apresentando') === 'true'""")
          and espera(plateia, """() => document.querySelector('[data-elementos] header')
              ?.getAttribute('data-apresentando') === 'true'"""),
          f'{apresentando(quem)} / {apresentando(plateia)}')

    check('quem assiste vê que está seguindo',
          espera(plateia, """() => (document.querySelector('[data-elementos] header')?.innerText
              || '').includes('Seguindo')"""),
          plateia.evaluate("""() => document.querySelector('[data-elementos] header')?.innerText
              .split('\\n').join(' · ')"""))

    check('e as ferramentas de desenho somem para ela',
          plateia.locator('.App-toolbar').count() == 0,
          f'{plateia.locator(".App-toolbar").count()} barras de ferramenta')
    plateia.screenshot(path=str(SHOTS / 'a1-plateia.png'))

    # --- seguir o enquadramento ----------------------------------------------
    for _ in range(3):
        quem.locator('.zoom-out-button').click()
        quem.wait_for_timeout(200)
    quem.wait_for_timeout(1200)

    check('o espectador segue o zoom de quem apresenta',
          espera(plateia, f"""() => {{
              const achado = (document.body.innerText || '').match(/(\\d+)%/);
              return achado && Number(achado[1]) === {zoom(quem)};
          }}"""),
          f'{zoom(quem)}% e {zoom(plateia)}%')

    # --- soltar ---------------------------------------------------------------
    plateia.locator('[data-elementos] header button', has_text='Seguindo').click()
    plateia.wait_for_timeout(400)
    antes = zoom(plateia)

    for _ in range(2):
        quem.locator('.zoom-out-button').click()
        quem.wait_for_timeout(200)
    quem.wait_for_timeout(1200)

    check('soltar para de seguir, e não interrompe quem apresenta',
          zoom(plateia) == antes and zoom(quem) != antes,
          f'plateia {zoom(plateia)}% · apresentando {zoom(quem)}%')

    plateia.locator('[data-elementos] header button', has_text='Voltar a seguir').click()
    quem.locator('.zoom-out-button').click()
    quem.wait_for_timeout(1200)

    check('voltar a seguir alcança o enquadramento de novo',
          espera(plateia, f"""() => {{
              const achado = (document.body.innerText || '').match(/(\\d+)%/);
              return achado && Number(achado[1]) === {zoom(quem)};
          }}"""),
          f'{zoom(quem)}% e {zoom(plateia)}%')

    # --- fora do quadro -------------------------------------------------------
    plateia.locator('button[aria-label="Voltar para a conversa"]').click()
    plateia.wait_for_timeout(1200)

    check('a mensagem de sistema aparece no canal',
          espera(plateia, """() => (document.body.innerText || '')
              .includes('está apresentando')"""))

    check('e a apresentação aparece indentada na lista de canais',
          espera(plateia, f"""() => [...document.querySelectorAll('nav[aria-label="Canais"] button')]
              .some((b) => b.innerText.includes({NOME!r}))"""))
    plateia.screenshot(path=str(SHOTS / 'a2-na-lista.png'))

    # O nome do quadro na linha de sistema é um link de verdade: quem lê depois
    # quer entrar, não só saber que aconteceu.
    plateia.locator('a', has_text=NOME).first.click()
    plateia.wait_for_selector('canvas', timeout=25000)
    plateia.wait_for_timeout(800)

    check('o nome do quadro na linha de sistema abre a apresentação',
          plateia.locator('[data-elementos]').count() == 1)

    plateia.locator('button[aria-label="Voltar para a conversa"]').click()
    plateia.wait_for_timeout(800)

    # A linha da barra lateral é o outro caminho de volta.
    plateia.locator('nav[aria-label="Canais"] button', has_text=NOME).first.click()
    plateia.wait_for_selector('canvas', timeout=25000)
    plateia.wait_for_timeout(1200)

    check('clicar nela leva de volta para o quadro',
          plateia.locator('[data-elementos]').count() == 1)

    # --- a caneta -------------------------------------------------------------
    quem.locator('[data-elementos] header button[aria-label^="Dar a caneta"]').first.click()
    quem.wait_for_timeout(1200)

    check('quem recebe a caneta volta a ter as ferramentas',
          espera(plateia, """() => document.querySelectorAll('.App-toolbar').length > 0"""),
          f'{plateia.locator(".App-toolbar").count()} barras de ferramenta')
    plateia.screenshot(path=str(SHOTS / 'a3-com-caneta.png'))

    # --- encerrar -------------------------------------------------------------
    quem.locator('[data-elementos] header button', has_text='Encerrar').click()
    quem.wait_for_timeout(1500)

    check('encerrar apaga a borda dos dois lados',
          espera(quem, """() => document.querySelector('[data-elementos] header')
              ?.getAttribute('data-apresentando') === 'false'""")
          and espera(plateia, """() => document.querySelector('[data-elementos] header')
              ?.getAttribute('data-apresentando') === 'false'"""),
          f'{apresentando(quem)} / {apresentando(plateia)}')

    plateia.locator('button[aria-label="Voltar para a conversa"]').click()
    plateia.wait_for_timeout(1000)

    check('e o canal registra o fim',
          espera(plateia, """() => (document.body.innerText || '')
              .includes('encerrou a apresentação')"""))

    check('a linha some da lista de canais',
          espera(plateia, f"""() => ![...document.querySelectorAll('nav[aria-label="Canais"] button')]
              .some((b) => b.innerText.includes({NOME!r}))"""))

    check('nenhum erro de página', not errosA and not errosB,
          '; '.join((errosA + errosB)[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
falhas = [nome for nome, ok, _ in resultados if not ok]
print(f'{len(resultados) - len(falhas)}/{len(resultados)} passaram')
if falhas:
    print('falhou: ' + ', '.join(falhas))
sys.exit(1 if falhas else 0)
