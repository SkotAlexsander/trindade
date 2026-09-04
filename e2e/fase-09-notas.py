"""Notas colaborativas: duas pessoas no mesmo documento.

O aceite da fase 9 é direto — duas pessoas editam ao mesmo tempo sem conflito,
com cursores visíveis, e fechar a aba no meio da edição não perde nada. É isso
que este roteiro faz, com dois navegadores de verdade contra o mesmo servidor.

    docker compose up -d
    pnpm dev
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


def aparece(pg, funcao, tentativas=40, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


def entrar(b, usuario, senha='cavalo-bateria-grampo-9'):
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    # **O mesmo canal para todo mundo.** Cada pessoa cai no seu primeiro não
    # lido, e a nota é por canal: sem fixar, o roteiro compara documentos
    # diferentes e conclui que a sincronia não funciona.
    pg.goto(f'{BASE}/c/geral', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    return ctx, pg, erros


def abrir_notas(pg):
    pg.locator('button[aria-label="Notas"]').click()
    pg.wait_for_selector('[aria-label^="Notas de"]', timeout=10000)
    pg.wait_for_timeout(600)


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, pgA, errosA = entrar(b, 'alex')
    ctxB, pgB, errosB = entrar(b, 'bruno')

    abrir_notas(pgA)
    check('o painel de notas abre com editor', pgA.locator('[aria-label^="Notas de"]').count() == 1)
    check('e é editável para quem tem a permissão',
          pgA.evaluate("""() => document.querySelector('[aria-label^="Notas de"]')
                          .getAttribute('contenteditable') === 'true'"""))

    # --- duas pessoas ao mesmo tempo -----------------------------------------
    abrir_notas(pgB)
    check('a faixa de "editando" aparece para quem já estava',
          aparece(pgA, """() => (document.body.innerText || '').includes('editando')"""),
          pgA.inner_text('[class*="editando"]') if pgA.locator('[class*="editando"]').count() else '')

    editorA = pgA.locator('[aria-label^="Notas de"]')
    editorB = pgB.locator('[aria-label^="Notas de"]')

    editorA.click()
    pgA.keyboard.type(f'Decisões {marca}')
    pgA.keyboard.press('Enter')
    pgA.keyboard.type('Migração sobe dia 12.')

    check('o que um escreve chega no outro',
          aparece(pgB, f"""() => document.querySelector('[aria-label^="Notas de"]')
                           .innerText.includes('Decisões {marca}')"""),
          editorB.inner_text()[:60])

    # A prova de CRDT: os dois escrevem sem esperar um pelo outro, e ninguém
    # perde texto. Com "quem salvou por último ganha", um dos dois sumiria.
    editorB.click()
    pgB.keyboard.press('Control+End')
    pgB.keyboard.press('Enter')
    pgB.keyboard.type(f'Rollback com a Carla {marca}')

    editorA.click()
    pgA.keyboard.press('Control+End')
    pgA.keyboard.press('Enter')
    pgA.keyboard.type(f'Avisar o cliente {marca}')

    pgA.wait_for_timeout(1500)

    def texto_limpo(pg):
        # O rótulo do cursor de quem está junto entra no `innerText`; ele é
        # decoração, não conteúdo do documento.
        return pg.evaluate("""() => {
            const raiz = document.querySelector('[aria-label^="Notas de"]').cloneNode(true);
            raiz.querySelectorAll('[class*="collaboration-carets"]').forEach((e) => e.remove());
            return raiz.innerText.trim();
        }""")

    textoA = texto_limpo(pgA)
    textoB = texto_limpo(pgB)

    check('as duas edições sobrevivem, nos dois lados',
          f'Rollback com a Carla {marca}' in textoA
          and f'Avisar o cliente {marca}' in textoA
          and f'Rollback com a Carla {marca}' in textoB
          and f'Avisar o cliente {marca}' in textoB,
          textoA.replace('\n', ' | ')[:120])

    check('e os dois documentos convergem para o mesmo texto',
          textoA.strip() == textoB.strip(),
          f'A: {textoA[-40:]!r} B: {textoB[-40:]!r}')

    # O cursor do outro é uma barra na cor da pessoa.
    check('o cursor de quem está junto aparece',
          aparece(pgA, """() => document.querySelectorAll(
              '[class*="collaboration-carets"]').length >= 1"""),
          str(pgA.locator('[class*="collaboration-carets"]').count()))
    pgA.screenshot(path=str(SHOTS / 'a1-notas.png'))

    # --- fechar a aba no meio da edição --------------------------------------
    #
    # O debounce de gravação é de 2s; fechar antes disso é o caso que perde
    # texto se o servidor não gravar ao sair o último.
    editorB.click()
    pgB.keyboard.press('Control+End')
    pgB.keyboard.press('Enter')
    pgB.keyboard.type(f'escrito antes de fechar {marca}')
    pgB.wait_for_timeout(200)
    ctxB.close()

    # Alex sai também: só quando o **último** fecha é que o servidor grava na
    # hora e solta a nota da memória.
    pgA.wait_for_timeout(400)
    ctxA.close()
    time.sleep(1.5)

    # Ninguém mais com a nota aberta: o servidor grava na hora e solta a
    # memória. Uma sessão nova prova que foi para o banco, e não ficou só ali.
    ctxC, pgC, errosC = entrar(b, 'carla')
    abrir_notas(pgC)
    texto = pgC.locator('[aria-label^="Notas de"]').inner_text()

    check('fechar a aba no meio da edição não perde nada',
          f'escrito antes de fechar {marca}' in texto, texto.replace('\n', ' | ')[-80:])
    check('e o resto do documento continua lá',
          f'Decisões {marca}' in texto and f'Avisar o cliente {marca}' in texto)
    pgC.screenshot(path=str(SHOTS / 'a2-notas-recarregada.png'))

    # --- da conversa para a nota ---------------------------------------------
    #
    # O gesto central: a decisão tomada no chat vira registro em um clique.
    recado = f'decisão importante {marca}'
    pgC.fill('#compositor', recado)
    pgC.keyboard.press('Enter')
    pgC.wait_for_timeout(900)

    linha = pgC.locator('[class*="mensagem"]', has_text=recado).last
    linha.hover()
    pgC.wait_for_timeout(300)
    linha.locator('button[aria-label="Mais ações"]').click()
    pgC.wait_for_timeout(300)
    pgC.locator('[role="menuitem"]', has_text='Adicionar às notas').click()

    check('"adicionar às notas" leva a mensagem para a nota',
          aparece(pgC, f"""() => document.querySelector('[aria-label^="Notas de"]')
                          .innerText.includes({recado!r})"""),
          pgC.locator('[aria-label^="Notas de"]').inner_text()[-100:])

    # Sem a origem, a nota vira cópia sem procedência e ninguém confia nela.
    nota = pgC.locator('[aria-label^="Notas de"]').inner_text()
    check('com o autor e o link de volta',
          'Carla' in nota.split(recado)[-1] and '/c/geral?m=' in nota,
          nota.split(recado)[-1][:90])
    pgC.screenshot(path=str(SHOTS / 'a3-citacao.png'))

    check('nenhum erro de página', not errosA and not errosB and not errosC,
          '; '.join((errosA + errosB + errosC)[:2]))

    ctxC.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
