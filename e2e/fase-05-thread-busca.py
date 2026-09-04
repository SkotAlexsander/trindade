"""Thread e busca — os dois painéis que faltavam.

Fatia 5 da fase 5. Duas janelas: uma resposta de thread não pode aparecer na
linha principal de ninguém, e é isso que a segunda janela verifica.

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


def entrar(pg, usuario, canal='geral'):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', 'cavalo-bateria-grampo-9')
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.goto(f'{BASE}/c/{canal}', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(1200)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctxA = b.new_context(viewport={'width': 1500, 'height': 900}, color_scheme='dark')
    pgA = ctxA.new_page()
    erros = []
    pgA.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgA, 'alex')

    ctxB = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
    pgB = ctxB.new_page()
    pgB.on('pageerror', lambda e: erros.append(str(e)))
    entrar(pgB, 'daniel')

    marca = str(int(time.time()))[-6:]

    def escrever(pg, texto):
        pg.click('#compositor')
        pg.fill('#compositor', texto)
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(900)

    def ultima(pg):
        return pg.locator('article[class*="mensagem"]').last

    # --- 1. abrir uma thread -------------------------------------------------
    mae = f'decisao para debater {marca}'
    escrever(pgA, mae)
    pgB.wait_for_selector(f'text={mae}', timeout=8000)

    alvo = ultima(pgA)
    antes = pgA.locator('article[class*="mensagem"]').count()

    alvo.hover()
    pgA.wait_for_timeout(250)
    alvo.locator('button[aria-label="Mais ações"]').click()
    pgA.wait_for_timeout(300)
    pgA.click('text=Abrir thread')
    pgA.wait_for_timeout(1200)

    painel = pgA.locator('aside[aria-label="Thread"]')
    check('o menu abre o painel de thread', painel.count() == 1)
    check('a mensagem-mãe aparece no topo', mae in painel.inner_text())
    check('e diz que ainda não há respostas', 'Sem respostas ainda' in painel.inner_text())

    # --- 2. responder na thread ----------------------------------------------
    resposta = f'resposta na thread {marca}'
    pgA.fill('textarea[aria-label="Responder na thread"]', resposta)
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(1500)

    check('a resposta entra na thread', resposta in painel.inner_text())
    check('o contador vira "1 resposta"', '1 resposta' in painel.inner_text())
    pgA.screenshot(path=str(SHOTS / '61-thread.png'))

    # A regra que importa: a resposta **não** volta para a linha principal.
    depois = pgA.locator('article[class*="mensagem"]').count()
    check('a resposta não entra na conversa de quem respondeu', depois == antes,
          f'{antes} -> {depois}')

    pgB.wait_for_timeout(1500)
    check(
        'nem na de quem só está olhando',
        pgB.locator('div[class*="rolagem"]').locator(f'text={resposta}').count() == 0,
    )

    # --- 3. o rodapé na mensagem-mãe -----------------------------------------
    rodape = pgA.locator('button[class*="rodapeThread"]').last
    check('a mãe ganha o rodapé com a contagem', rodape.count() == 1)
    check('que diz "1 resposta"', '1 resposta' in rodape.inner_text(), rodape.inner_text())
    check('e o instante da última', 'última' in rodape.inner_text())
    # O único ponto do projeto onde `·` separa meta. Num container flex o nó de
    # texto solto vira item e os espaços colapsam: já saiu "1 respostaúltima".
    check('com o separador entre os dois fatos', '·' in rodape.inner_text(),
          repr(rodape.inner_text()))

    # O outro lado recebe o rodapé em tempo real, sem recarregar.
    rodapeB = pgB.locator('button[class*="rodapeThread"]').last
    check('o rodapé aparece para o outro em tempo real', rodapeB.count() == 1)

    # --- 4. o rodapé abre a thread -------------------------------------------
    # O foco está no compositor da thread, dentro do painel — e a regra da
    # fase 4 diz que `Esc` só fecha o painel quando o foco está dentro dele.
    pgA.keyboard.press('Escape')
    pgA.wait_for_timeout(500)
    check('Esc com o foco dentro do painel fecha a thread',
          pgA.locator('aside[aria-label="Thread"]').count() == 0)

    rodape.click()
    pgA.wait_for_timeout(1000)
    check('clicar no rodapé reabre a thread',
          pgA.locator('aside[aria-label="Thread"]').count() == 1)

    # --- 5. a thread sobrevive ao recarregar ---------------------------------
    pgA.reload(wait_until='networkidle')
    pgA.wait_for_timeout(1800)
    check(
        'a resposta continua fora da linha principal depois do F5',
        pgA.locator('div[class*="rolagem"]').locator(f'text={resposta}').count() == 0,
    )
    check(
        'e o rodapé continua lá',
        pgA.locator('button[class*="rodapeThread"]').count() >= 1,
    )

    # --- 6. busca -------------------------------------------------------------
    unico = f'zebrado{marca}'
    escrever(pgA, f'palavra {unico} para achar, com migração também')
    pgA.wait_for_timeout(800)

    pgA.keyboard.press('Control+f')
    pgA.wait_for_timeout(600)
    busca = pgA.locator('aside[aria-label="Buscar"]')
    check('Ctrl F abre a busca', busca.count() == 1)

    campo = pgA.locator('input[aria-label="Buscar no canal"]')
    check('o campo já vem com o foco',
          pgA.evaluate("() => document.activeElement?.getAttribute('aria-label')")
          == 'Buscar no canal')

    campo.fill(unico)
    pgA.wait_for_timeout(1600)
    linhas = pgA.locator('button[class*="linhaPainel"]')
    check('a busca encontra', linhas.count() >= 1, f'{linhas.count()} linhas')
    check('e o termo aparece aceso', pgA.locator('mark[class*="aceso"]').count() >= 1)
    pgA.screenshot(path=str(SHOTS / '62-busca.png'))

    # Sem acento acha com acento — a mesma regra da migration 012.
    campo.fill('migracao')
    pgA.wait_for_timeout(1600)
    check('buscar sem acento encontra com acento',
          pgA.locator('button[class*="linhaPainel"]').count() >= 1)
    acesos = pgA.locator('mark[class*="aceso"]').all_inner_texts()
    check('e o destaque cai sobre a palavra acentuada',
          any('migraç' in a for a in acesos), str(acesos[:3]))

    # Filtro por autor.
    campo.fill(unico)
    pgA.wait_for_timeout(1400)
    comTodos = pgA.locator('button[class*="linhaPainel"]').count()
    pgA.select_option('select[aria-label="Filtrar por autor"]', label='Daniel Prado')
    pgA.wait_for_timeout(1400)
    comFiltro = pgA.locator('button[class*="linhaPainel"]').count()
    check('filtrar por outro autor esvazia', comFiltro < comTodos,
          f'{comTodos} -> {comFiltro}')

    check('e explica o vazio', 'Nada encontrado' in busca.inner_text())

    # Clicar num resultado pula e acende.
    pgA.select_option('select[aria-label="Filtrar por autor"]', label='todos')
    pgA.wait_for_timeout(1400)
    pgA.locator('button[class*="linhaPainel"]').first.click()
    pgA.wait_for_timeout(400)
    check('clicar num resultado acende a mensagem',
          pgA.locator('article[data-destacada]').count() == 1)

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

passou = sum(1 for _, ok, _ in resultados if ok)
print(f'\n{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
