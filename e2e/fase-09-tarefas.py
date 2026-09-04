"""O quadro de tarefas: da conversa para a coluna, e de volta.

O aceite da fase 9 para tarefas é o caminho inteiro num navegador de verdade:
uma mensagem vira cartão em um clique, o cartão aparece na tela da outra pessoa
sem ninguém recarregar nada, arrastar muda a coluna dos dois lados, concluir
deixa uma linha no canal, e a mensagem de origem sabe que virou tarefa.

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
    # O quadro é por canal: sem fixar o mesmo, cada um cai no seu primeiro não
    # lido e o roteiro compara quadros diferentes.
    pg.goto(f'{BASE}/c/geral', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    return ctx, pg, erros


def abrir_tarefas(pg):
    pg.locator('button[aria-label="Tarefas"]').click()
    pg.wait_for_selector('text=A fazer', timeout=10000)
    pg.wait_for_timeout(400)


def cartao(pg, titulo):
    return pg.locator('article', has_text=titulo).last


def coluna_tem(pg, nome, texto):
    """O cabeçalho da coluna é caixa alta por CSS — `innerText` devolve "FAZENDO".

    Comparar sem normalizar foi o que fez este roteiro acusar um arrasto que
    tinha funcionado.
    """
    return f"""() => {{
        const s = [...document.querySelectorAll('section[class*="coluna"]')]
            .find((e) => e.innerText.toLowerCase().startsWith({nome.lower()!r}));
        return Boolean(s) && s.innerText.includes({texto!r});
    }}"""


def arrastar(pg, origem, destino):
    """dnd-kit só começa a arrastar depois de 6px, e só com passos de mouse.

    Um `drag_to` direto não move nada: o sensor de ponteiro precisa ver o
    caminho, não o salto.
    """
    a = origem.bounding_box()
    b = destino.bounding_box()
    pg.mouse.move(a['x'] + a['width'] / 2, a['y'] + a['height'] / 2)
    pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(
            a['x'] + a['width'] / 2 + (b['x'] + b['width'] / 2 - a['x'] - a['width'] / 2) * i / 10,
            a['y'] + a['height'] / 2 + (b['y'] + b['height'] / 2 - a['y'] - a['height'] / 2) * i / 10,
        )
        pg.wait_for_timeout(30)
    pg.mouse.up()
    pg.wait_for_timeout(600)


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, pgA, errosA = entrar(b, 'alex')
    ctxB, pgB, errosB = entrar(b, 'bruno')

    abrir_tarefas(pgA)
    abrir_tarefas(pgB)

    check('o quadro abre com as três colunas',
          all(pgA.locator(f'text={nome}').count() >= 1
              for nome in ('A fazer', 'Fazendo', 'Feito')))

    # --- criar pelo formulário ------------------------------------------------
    titulo = f'Revisar a migração {marca}'
    pgA.fill('input[id*="nova"], input[placeholder="O que precisa ser feito?"]', titulo)
    pgA.locator('button[type="submit"]', has_text='Criar').click()

    check('a tarefa criada aparece no quadro de quem criou',
          aparece(pgA, f"""() => (document.body.innerText || '').includes({titulo!r})"""))

    # O `TASK_UPDATE` é o que faz o quadro ser do grupo e não de cada um.
    check('e chega no quadro do outro sem recarregar nada',
          aparece(pgB, f"""() => (document.body.innerText || '').includes({titulo!r})"""))
    pgA.screenshot(path=str(SHOTS / 'b1-quadro.png'))

    # --- da mensagem para o cartão -------------------------------------------
    recado = f'combinar o deploy de sexta {marca}'
    pgA.fill('#compositor', f'{recado}\ne o resto do texto fica na mensagem')
    pgA.keyboard.press('Enter')
    pgA.wait_for_timeout(900)

    linha = pgA.locator('[class*="mensagem"]', has_text=recado).last
    linha.hover()
    pgA.wait_for_timeout(300)
    linha.locator('button[aria-label="Mais ações"]').click()
    pgA.wait_for_timeout(300)
    pgA.locator('[role="menuitem"]', has_text='Criar tarefa').click()

    # A primeira linha é o título; o resto continua na mensagem. Abrir um
    # formulário para confirmar isso é a fricção que faz ninguém usar o quadro.
    check('"criar tarefa" leva a primeira linha da mensagem para o quadro',
          aparece(pgA, f"""() => {{
              const p = document.querySelector('[class*="painelCorpo"]');
              return Boolean(p) && p.innerText.includes({recado!r})
                  && !p.innerText.includes('o resto do texto');
          }}"""))

    check('e a mensagem passa a dizer que virou tarefa, com a coluna',
          aparece(pgA, """() => {
              const el = [...document.querySelectorAll('[class*="rodapeTarefa"]')];
              return el.some((e) => e.innerText.includes('Virou tarefa')
                                 && e.innerText.includes('A fazer'));
          }"""),
          pgA.locator('[class*="rodapeTarefa"]').last.inner_text().replace('\n', ' ')
          if pgA.locator('[class*="rodapeTarefa"]').count() else '')
    pgA.screenshot(path=str(SHOTS / 'b2-virou-tarefa.png'))

    # --- arrastar -------------------------------------------------------------
    origem = cartao(pgA, recado)
    fazendo = pgA.locator('section', has_text='Fazendo').last
    arrastar(pgA, origem, fazendo)

    check('arrastar move o cartão de coluna', aparece(pgA, coluna_tem(pgA, 'Fazendo', recado)))

    check('e a mesma coluna aparece na mensagem e na tela do outro',
          aparece(pgA, """() => [...document.querySelectorAll('[class*="rodapeTarefa"]')]
                      .some((e) => e.innerText.includes('Fazendo'))""")
          and aparece(pgB, coluna_tem(pgB, 'Fazendo', recado)))

    # --- concluir -------------------------------------------------------------
    cartao(pgA, recado).locator('button[aria-label="Concluir tarefa"]').click()

    check('concluir deixa uma linha no canal, para todo mundo',
          aparece(pgB, f"""() => [...document.querySelectorAll('[class*="sistema"]')]
                      .some((e) => e.innerText.includes({recado!r}))"""),
          pgB.locator('[class*="sistema"]').last.inner_text().replace('\n', ' ')
          if pgB.locator('[class*="sistema"]').count() else '')

    # A linha de sistema é o canal falando: sem avatar, sem barra de ações.
    check('e essa linha não tem avatar nem barra de ações',
          pgB.evaluate("""() => {
              const el = [...document.querySelectorAll('[class*="sistema"]')].pop();
              return Boolean(el) && !el.querySelector('img')
                  && !el.querySelector('button[aria-label="Mais ações"]');
          }"""))
    pgB.screenshot(path=str(SHOTS / 'b3-linha-de-sistema.png'))

    # Concluída some da conversa? Não: continua no quadro, em Feito recolhido.
    # Pelo "mostrar" da própria coluna recolhida. Por texto "Feito" o clique
    # acerta o rodapé da mensagem, que também diz "Feito"; por `aria-expanded`
    # acerta o botão de dono, que o floating-ui também marca assim.
    pgA.locator('section[class*="coluna"] button', has_text='mostrar').click()
    pgA.wait_for_timeout(400)
    check('a concluída fica guardada em "Feito"',
          aparece(pgA, coluna_tem(pgA, 'Feito', recado)))

    # --- dono e prazo ---------------------------------------------------------
    #
    # "sem dono" é um convite; convite que não dá para aceitar é decoração.
    cartao(pgA, recado).locator('button[aria-label="Assumir ou atribuir"]').click()
    pgA.wait_for_timeout(300)
    pgA.locator('[role="menuitem"]', has_text='Bruno Lima').click()

    # "Feito" está recolhida para o Bruno — cada um recolhe a sua. Sem abrir,
    # o cartão nem está na página dele e a verificação diria "não chegou".
    pgB.locator('section[class*="coluna"] button', has_text='mostrar').click()
    pgB.wait_for_timeout(400)

    check('assumir o cartão mostra o dono, e mostra na tela do outro',
          aparece(pgA, coluna_tem(pgA, 'Feito', 'Bruno'))
          and aparece(pgB, coluna_tem(pgB, 'Feito', 'Bruno')))

    # --- o elo de volta -------------------------------------------------------
    #
    # Sem ele, o quadro é um Trello pior: o cartão perde o porquê.
    cartao(pgA, recado).locator('button[aria-label="Ver a mensagem de origem"]').click()
    pgA.wait_for_timeout(800)
    # Com o painel fechado, o rodapé da mensagem é o caminho de ida para o
    # quadro. Sem isso ele seria só um rótulo.
    pgB.locator('button[aria-label="Fechar painel"]').click()
    pgB.wait_for_timeout(500)
    fechado = pgB.evaluate(
        """() => document.querySelector('[class*="painelSlot"]')
                  .getAttribute('aria-hidden') === 'true'""")
    pgB.locator('[class*="rodapeTarefa"]').last.click()

    check('o rodapé da mensagem abre o quadro',
          fechado and aparece(pgB, """() => {
              const p = document.querySelector('[class*="painelSlot"]');
              return Boolean(p) && p.getAttribute('aria-hidden') !== 'true'
                  && p.innerText.toLowerCase().includes('a fazer');
          }"""))

    check('o cartão volta para a mensagem que o originou',
          aparece(pgA, f"""() => {{
              const p = document.querySelector('[class*="painelCorpo"]');
              return Boolean(p) && p.innerText.includes({recado!r});
          }}"""))
    pgA.screenshot(path=str(SHOTS / 'b4-elo-de-volta.png'))

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
