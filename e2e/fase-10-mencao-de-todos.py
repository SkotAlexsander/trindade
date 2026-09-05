"""`@todos`: a menção que chama o grupo.

Quatro verificações num navegador de verdade: a sugestão aparece na frente das
pessoas, a menção sai destacada na mensagem, e quem **não** escreveu recebe o
chamado no contador do título — que é a diferença entre "isto é para o grupo" e
mais uma linha no canal.

    docker compose up -d
    pnpm dev
    pnpm dev:seed

    python e2e/fase-10-mencao-de-todos.py <pasta> [quem-escreve] [quem-recebe]
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

QUEM, RECEBE = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ('alex', 'bruno')

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def espera(pg, funcao, tentativas=50, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


def entrar(b, usuario):
    ctx = b.new_context(
        viewport={'width': 1400, 'height': 900},
        color_scheme='dark',
        permissions=['notifications'],
    )
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(600)
    return ctx, pg, erros


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, quem, errosA = entrar(b, QUEM)
    ctxB, recebe, errosB = entrar(b, RECEBE)

    # Quem recebe fica em **outro** canal: com o canal aberto e a janela à
    # frente, a regra de notificação não marca nada — e é o certo, porque a
    # pessoa está lendo. Ver design/09-notificacoes.md.
    recebe.locator('nav[aria-label="Canais"] a', has_text='produto').first.click()
    recebe.wait_for_timeout(800)

    # --- a sugestão -----------------------------------------------------------
    quem.click('#compositor')
    quem.keyboard.type('@', delay=40)
    quem.wait_for_timeout(700)

    check('`@` oferece `@todos` antes das pessoas',
          espera(quem, """() => {
              const lista = document.querySelector('[role="listbox"]');
              const primeiro = lista?.querySelectorAll('[role="option"]')[0];
              return Boolean(primeiro?.innerText.includes('@todos'));
          }"""),
          quem.evaluate("""() => document.querySelector('[role="listbox"]')
              ?.innerText.split('\\n').slice(0, 3).join(' · ')"""))
    quem.screenshot(path=str(SHOTS / 't1-sugestao.png'))

    # --- a menção -------------------------------------------------------------
    quem.keyboard.type('todos', delay=30)
    quem.wait_for_timeout(500)
    quem.keyboard.press('Enter')  # escolhe a sugestão
    quem.wait_for_timeout(300)
    quem.keyboard.type(f'reunião agora {marca}', delay=20)
    quem.keyboard.press('Enter')
    quem.wait_for_timeout(1500)

    check('a menção sai destacada na mensagem',
          espera(quem, """() => Boolean(document.querySelector('[data-todos="true"]'))"""),
          quem.evaluate("""() => document.querySelector('[data-todos="true"]')?.innerText"""))
    quem.screenshot(path=str(SHOTS / 't2-na-conversa.png'))

    # --- o chamado ------------------------------------------------------------
    check('e quem não escreveu recebe o chamado no título',
          espera(recebe, """() => document.title.startsWith('(')"""),
          recebe.title())

    check('quem escreveu não chama a si mesmo',
          quem.title() == 'Trindade', quem.title())

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
