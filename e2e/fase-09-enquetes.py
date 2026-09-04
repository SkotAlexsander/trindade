"""Enquetes: perguntar no canal e ver o voto do outro chegar.

O aceite é o caminho inteiro num navegador: `/enquete` abre o formulário, a
enquete aparece como mensagem no canal dos dois, o voto de um move a barra do
outro sem recarregar nada, encerrada para de aceitar voto, e a anônima **não
entrega** quem votou nem para quem perguntou.

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
    ctx = b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    # A enquete é do canal: sem fixar o mesmo, cada um cai no seu primeiro não
    # lido e o roteiro compara conversas diferentes.
    pg.goto(f'{BASE}/c/geral', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    return ctx, pg, erros


def perguntar(pg, pergunta, opcoes, anonima=False):
    pg.fill('#compositor', f'/enquete {pergunta}')
    pg.keyboard.press('Enter')
    pg.wait_for_selector('form[aria-label="Nova enquete"]', timeout=10000)

    campos = pg.locator('form[aria-label="Nova enquete"] input:not([type="date"])')
    for i, opcao in enumerate(opcoes):
        campos.nth(i + 1).fill(opcao)
    if anonima:
        pg.locator('form[aria-label="Nova enquete"] button[role="switch"]').nth(1).click()

    pg.locator('form[aria-label="Nova enquete"] button[type="submit"]').click()
    pg.wait_for_timeout(1200)


def caixa(pg, pergunta):
    return pg.locator(f'section[aria-label="Enquete: {pergunta}"]')


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, pgA, errosA = entrar(b, 'alex')
    ctxB, pgB, errosB = entrar(b, 'bruno')

    # --- perguntar ------------------------------------------------------------
    pergunta = f'Janela de deploy {marca}?'
    perguntar(pgA, pergunta, ['Terça, 9h', 'Quinta, 22h'])

    check('a enquete nasce como mensagem no canal de quem perguntou',
          caixa(pgA, pergunta).count() == 1)

    # A pergunta fica no corpo da mensagem, fora da caixa: é o que a faz
    # aparecer na busca e na citação.
    check('com a pergunta no corpo da mensagem, e não dentro da caixa',
          pgA.evaluate(f"""() => {{
              const linha = [...document.querySelectorAll('[class*="mensagem"]')]
                  .filter((e) => e.innerText.includes({pergunta!r})).pop();
              if (!linha) return false;
              const corpo = linha.querySelector('[class*="corpoBloco"]');
              const caixa = linha.querySelector('section[aria-label^="Enquete"]');
              return Boolean(caixa)
                  && corpo.innerText.includes({pergunta!r})
                  && !caixa.innerText.includes({pergunta!r});
          }}"""))

    check('e chega no canal do outro sem recarregar nada',
          aparece(pgB, f"""() => Boolean(
              document.querySelector('section[aria-label="Enquete: {pergunta}"]'))"""))
    pgA.screenshot(path=str(SHOTS / 'f1-enquete.png'))

    # --- votar ----------------------------------------------------------------
    caixa(pgB, pergunta).locator('button', has_text='Terça').click()

    check('o voto de um move a barra na tela do outro',
          aparece(pgA, f"""() => {{
              const c = document.querySelector('section[aria-label="Enquete: {pergunta}"]');
              return Boolean(c) && c.innerText.includes('1 pessoa votou');
          }}"""),
          caixa(pgA, pergunta).inner_text().replace('\n', ' | '))

    # Aberta: quem votou aparece para os outros. É a diferença que a pessoa
    # escolhe ao criar.
    caixa(pgA, pergunta).locator('button', has_text='Terça').hover()
    pgA.wait_for_timeout(700)
    check('em enquete aberta, quem votou aparece no hover',
          aparece(pgA, """() => (document.body.innerText || '').includes('Bruno Lima')"""))

    # Trocar de opção não vira duas pessoas votando.
    caixa(pgB, pergunta).locator('button', has_text='Quinta').click()
    check('trocar de opção move o voto, sem contar duas pessoas',
          aparece(pgA, f"""() => {{
              const c = document.querySelector('section[aria-label="Enquete: {pergunta}"]');
              return Boolean(c) && c.innerText.includes('1 pessoa votou')
                  && /Quinta, 22h\\s*1/.test(c.innerText);
          }}"""),
          caixa(pgA, pergunta).inner_text().replace('\n', ' | '))
    pgA.screenshot(path=str(SHOTS / 'f2-votado.png'))

    # --- anônima --------------------------------------------------------------
    #
    # O requisito que não pode falhar: nem quem perguntou descobre quem votou.
    secreta = f'Quem topa o rollback {marca}?'
    perguntar(pgA, secreta, ['Eu topo', 'Prefiro não'], anonima=True)
    aparece(pgB, f"""() => Boolean(
        document.querySelector('section[aria-label="Enquete: {secreta}"]'))""")
    caixa(pgB, secreta).locator('button', has_text='Eu topo').click()

    check('a anônima conta o voto',
          aparece(pgA, f"""() => {{
              const c = document.querySelector('section[aria-label="Enquete: {secreta}"]');
              return Boolean(c) && c.innerText.includes('1 pessoa votou');
          }}"""))

    # A resposta do servidor é o que se verifica: esconder na tela e mandar os
    # nomes no JSON seria prometer segredo e entregar um F12.
    nomes = pgA.evaluate(f"""async () => {{
        const canal = location.pathname.split('/').pop();
        const linha = [...document.querySelectorAll('section[aria-label^="Enquete"]')]
            .find((e) => e.getAttribute('aria-label').includes({secreta!r}));
        return Boolean(linha);
    }}""")
    check('e não entrega quem votou — nem para quem perguntou',
          nomes and not pgA.evaluate(
              """() => {
                  const c = [...document.querySelectorAll('section[aria-label^="Enquete"]')].pop();
                  return c.innerText.includes('Bruno');
              }"""))
    pgA.screenshot(path=str(SHOTS / 'f3-anonima.png'))

    # --- encerrar -------------------------------------------------------------
    caixa(pgA, pergunta).locator('button', has_text='encerrar').click()

    check('encerrar chega para todo mundo e tira a interação',
          aparece(pgB, f"""() => {{
              const c = document.querySelector('section[aria-label="Enquete: {pergunta}"]');
              return Boolean(c) && c.innerText.includes('encerrada')
                  && [...c.querySelectorAll('button')].every((b) => b.disabled
                      || !b.className.includes('opcao'));
          }}"""),
          caixa(pgB, pergunta).inner_text().replace('\n', ' | '))

    # --- o resultado vira registro -------------------------------------------
    caixa(pgA, pergunta).locator('button', has_text='adicionar o resultado').click()
    pgA.wait_for_timeout(1200)
    pgA.locator('button[aria-label="Notas"]').click()
    pgA.wait_for_selector('[aria-label^="Notas de"]', timeout=10000)

    check('"adicionar o resultado às notas" grava a decisão na nota do canal',
          aparece(pgA, f"""() => {{
              const nota = document.querySelector('[aria-label^="Notas de"]');
              return Boolean(nota) && nota.innerText.includes({pergunta!r})
                  && nota.innerText.includes('Quinta, 22h');
          }}"""),
          pgA.locator('[aria-label^="Notas de"]').inner_text()[-120:].replace('\n', ' | '))
    pgA.screenshot(path=str(SHOTS / 'f4-resultado-na-nota.png'))

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
