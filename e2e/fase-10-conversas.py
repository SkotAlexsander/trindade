"""Conversas privadas: só quem está nela vê, e a lista só mostra o que existe.

O aceite da fase 10 para conversas, num navegador de verdade: abrir a direta
pelo cartão de perfil, a conversa aparecer na barra lateral **só depois da
primeira mensagem**, o outro receber como menção, e uma terceira pessoa não ver
nada — nem na lista, nem no contador.

A prova de que o administrador não passa está no teste de API, que olha a
resposta crua: aqui só se vê o que foi desenhado.

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

QUEM_FALA, QUEM_RECEBE, TERCEIRA = (
    (sys.argv[2], sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else ('alex', 'bruno', 'carla')
)
NOMES = {
    'alex': 'Alex Souza',
    'bruno': 'Bruno Lima',
    'carla': 'Carla Nunes',
    'daniel': 'Daniel Prado',
    'eva': 'Eva Marques',
}

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def espera(pg, funcao, tentativas=40, intervalo=250):
    for _ in range(tentativas):
        if pg.evaluate(funcao):
            return True
        pg.wait_for_timeout(intervalo)
    return False


def entrar(b, usuario, senha='cavalo-bateria-grampo-9'):
    ctx = b.new_context(
        viewport={'width': 1500, 'height': 950},
        color_scheme='dark',
        permissions=['notifications'],
    )
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


def falar(pg, texto):
    pg.fill('#compositor', texto)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1200)


marca = str(int(time.time()))[-5:]

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    ctxA, quem, errosA = entrar(b, QUEM_FALA)
    ctxB, alvo, errosB = entrar(b, QUEM_RECEBE)
    ctxC, terceira, errosC = entrar(b, TERCEIRA)

    # --- abrir pelo cartão de perfil -----------------------------------------
    #
    # É **o** caminho principal: não existe "nova conversa" que pede para
    # digitar um nome. Ver design/10-conversas-privadas.md.
    quem.locator(f'[aria-label*="{NOMES[QUEM_RECEBE]}"]').first.click()
    quem.wait_for_timeout(600)
    quem.locator('button', has_text='Mandar mensagem').click()
    quem.wait_for_url('**/d/**', timeout=15000)
    quem.wait_for_selector('#compositor', timeout=15000)

    check('o cartão de perfil abre a conversa direta',
          '/d/' in quem.url, quem.url.split('/')[-1][:8])

    check('e a promessa de privacidade aparece, sem prometer o que não entrega',
          espera(quem, """() => {
              const t = document.body.innerText || '';
              return t.includes('Só vocês dois veem') && t.includes('ponta a ponta');
          }"""))
    quem.screenshot(path=str(SHOTS / 'i1-direta.png'))

    # Uma direta sem nada não ocupa espaço na lista de ninguém — e uma com
    # histórico ocupa. O roteiro roda contra um banco que já viu outras
    # corridas, então ele confere a regra nos dois sentidos em vez de exigir
    # que a conversa seja nova.
    # "Este é o começo da conversa" aparece quando **há** mensagens e não há
    # mais antigas; o vazio de verdade é o outro texto.
    vazia = quem.evaluate(
        """() => (document.body.innerText || '').includes('Nenhuma mensagem ainda')""")
    naLista = quem.evaluate(
        """() => document.querySelectorAll('nav[aria-label="Conversas"] a').length > 0""")

    check('a lista mostra a conversa se, e só se, ela tem mensagem',
          naLista != vazia,
          'vazia' if vazia else 'com histórico')

    # --- a primeira mensagem --------------------------------------------------
    recado = f'só entre nós {marca}'
    falar(quem, recado)

    check('depois da primeira mensagem, ela entra na lista dos dois',
          espera(quem, """() => Boolean(document.querySelector('nav[aria-label="Conversas"]'))""")
          and espera(alvo, """() => Boolean(document.querySelector('nav[aria-label="Conversas"]'))"""))

    # Conversa privada notifica como menção: som, desktop e badge.
    check('e conta como menção para quem recebeu',
          espera(alvo, """() => document.title.startsWith('(')"""),
          alvo.title())
    alvo.screenshot(path=str(SHOTS / 'i2-recebida.png'))

    # --- a terceira pessoa ----------------------------------------------------
    terceira.wait_for_timeout(1500)
    check('quem não é membro não vê a conversa nem o conteúdo',
          terceira.evaluate(f"""() => {{
              const t = document.body.innerText || '';
              return !t.includes({recado!r})
                  && document.querySelectorAll('nav[aria-label="Conversas"]').length === 0;
          }}"""),
          terceira.title())

    # --- abrir de novo --------------------------------------------------------
    #
    # Duas aberturas, uma conversa: a garantia do par único é da aplicação, com
    # transação e lock. Aqui se confere que a lista não ganhou uma segunda.
    quem.goto(f'{BASE}/c/geral', wait_until='networkidle')
    quem.wait_for_selector('#compositor', timeout=15000)
    quem.locator(f'[aria-label*="{NOMES[QUEM_RECEBE]}"]').first.click()
    quem.wait_for_timeout(500)
    quem.locator('button', has_text='Mandar mensagem').click()
    quem.wait_for_url('**/d/**', timeout=15000)
    quem.wait_for_timeout(1200)

    check('abrir a mesma direta de novo não cria uma segunda',
          quem.evaluate("""() => document.querySelectorAll(
              'nav[aria-label="Conversas"] a').length === 1"""),
          str(quem.locator('nav[aria-label="Conversas"] a').count()))

    check('e o histórico continua lá',
          espera(quem, f"""() => (document.body.innerText || '').includes({recado!r})"""))

    # --- responder ------------------------------------------------------------
    alvo.locator('nav[aria-label="Conversas"] a').first.click()
    alvo.wait_for_selector('#compositor', timeout=15000)
    alvo.wait_for_timeout(600)
    resposta = f'recebido {marca}'
    falar(alvo, resposta)

    check('a resposta chega para o outro lado',
          espera(quem, f"""() => (document.body.innerText || '').includes({resposta!r})"""))

    check('e o contador zera para quem abriu a conversa',
          espera(alvo, """() => document.title === 'Trindade'"""),
          alvo.title())
    quem.screenshot(path=str(SHOTS / 'i3-conversa.png'))

    check('nenhum erro de página', not errosA and not errosB and not errosC,
          '; '.join((errosA + errosB + errosC)[:2]))

    ctxA.close()
    ctxB.close()
    ctxC.close()
    b.close()

print()
falhas = [nome for nome, ok, _ in resultados if not ok]
print(f'{len(resultados) - len(falhas)}/{len(resultados)} passaram')
if falhas:
    print('falhou: ' + ', '.join(falhas))
sys.exit(1 if falhas else 0)
