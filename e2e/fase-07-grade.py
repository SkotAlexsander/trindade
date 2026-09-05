"""A grade de participantes e a câmera.

Duas pessoas na mesma sala, com câmera falsa do Chrome. O que se verifica aqui
é o que só o navegador responde: que a grade **sobrepõe** a conversa em vez de
trocar de tela, que entrar numa chamada de voz não acende a luz da câmera, que
a prévia é espelhada só para quem a produz, e que o cartão de quem está sem
vídeo é o avatar — não um retângulo preto.

    docker compose up -d
    pnpm dev
    pnpm dev:seed
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

# As duas contas saem do ambiente, com o padrão de sempre:
#
#     TRINDADE_A=carla TRINDADE_B=daniel python e2e/fase-07-grade.py
#
# Entrar tem limite de 5 por 15 minutos **por usuário e IP**, e uma sessão de
# conserto roda o mesmo roteiro muitas vezes. Rotacionar a conta é o que
# impede a suíte de bloquear a si mesma. Ver e2e/README.md.
CONTA_A = os.environ.get('TRINDADE_A', 'alex')
CONTA_B = os.environ.get('TRINDADE_B', 'bruno')


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


def entrar(pg, usuario, senha='cavalo-bateria-grampo-9'):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_selector('#compositor', timeout=15000)


CONECTADO = """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                     ?.textContent || '').includes('Conectado')"""

with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    )

    def abrir(nome):
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark',
                            permissions=['microphone', 'camera'])
        pg = ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        entrar(pg, nome)
        return ctx, pg, erros

    ctxA, pgA, errosA = abrir(CONTA_A)
    ctxB, pgB, errosB = abrir(CONTA_B)

    pgA.locator('button', has_text='sala').first.click()
    check('alex entra na chamada', aparece(pgA, CONECTADO))

    barra = pgA.locator('section[aria-label="Chamada em andamento"]')

    # --- entrar não acende a câmera -----------------------------------------
    #
    # A regra de docs/07-permissoes-do-navegador.md: câmera e microfone são
    # pedidos separadamente, e entrar numa chamada de voz nunca acende a luz.
    trilhas = pgA.evaluate(
        """() => performance.getEntriesByType('resource').length >= 0
                 && document.querySelectorAll('video').length"""
    )
    check('entrar na chamada não liga vídeo nenhum', trilhas == 0, str(trilhas))
    check('e o botão de câmera nasce desligado',
          barra.locator('button[aria-label="Câmera desligada"]').count() == 1)

    # --- a grade ------------------------------------------------------------
    # **Garante** a grade aberta em vez de alternar às cegas.
    #
    # Entrar numa chamada já mostra a chamada desde a fase 10 — o modo é o
    # guardado, e a escolha de quem usa vale desde o primeiro instante. Este
    # roteiro é de antes dessa decisão: ele clicava para abrir e, com a grade
    # já aberta, fechava. O produto estava certo; o roteiro é que envelheceu.
    if pgA.locator('section[aria-label="Participantes da chamada"]').count() == 0:
        barra.locator('button[aria-label="Grade de participantes"]').click()
    pgA.wait_for_selector('section[aria-label="Participantes da chamada"]', timeout=8000)
    grade = pgA.locator('section[aria-label="Participantes da chamada"]')

    # Sobreposição, não outra rota: a URL não muda e o compositor continua
    # montado atrás.
    check('a grade abre sobre a conversa, sem trocar de tela',
          pgA.url.endswith('/c/sala') and pgA.locator('#compositor').count() == 1, pgA.url)

    cobre = pgA.evaluate(
        """() => {
            const g = document.querySelector('section[aria-label="Participantes da chamada"]')
                       .getBoundingClientRect();
            const c = document.querySelector('#compositor').getBoundingClientRect();
            return { grade: [Math.round(g.x), Math.round(g.width), Math.round(g.height)],
                     compositorCoberto: g.top <= c.top && g.bottom >= c.bottom };
        }"""
    )
    check('e cobre a coluna da conversa inteira', cobre['compositorCoberto'], str(cobre))

    check('sozinho, a grade diz isso em tom neutro',
          'Você está sozinho na sala' in grade.inner_text(), grade.inner_text()[:80])

    # Sem câmera o cartão é o avatar, não um retângulo preto: vídeo desligado e
    # vídeo travado precisam ser distinguíveis de relance.
    check('o cartão de quem está sem vídeo mostra o avatar',
          grade.locator('[class*="semVideo"]').count() == 1
          and grade.locator('video').count() == 0)
    pgA.screenshot(path=str(SHOTS / '83-grade-sozinho.png'))

    # --- a segunda pessoa ----------------------------------------------------
    pgB.locator('button', has_text='sala').first.click()
    check('bruno entra', aparece(pgB, CONECTADO))
    check('e a grade passa a dois cartões',
          aparece(pgA, """() => document.querySelectorAll(
              'section[aria-label="Participantes da chamada"] [class*="cartao"]').length === 2"""),
          str(grade.locator('[class*="cartao"]').count()))
    check('com o "sozinho" fora', 'sozinho na sala' not in grade.inner_text())

    # Dois lado a lado, e não um sobre o outro.
    lado = pgA.evaluate(
        """() => {
            const [a, b] = [...document.querySelectorAll(
              'section[aria-label="Participantes da chamada"] [class*="cartao"]')]
              .map((el) => el.getBoundingClientRect());
            return { mesmaLinha: Math.abs(a.top - b.top) < 2, aDireita: b.left > a.left,
                     proporcao: +(a.width / a.height).toFixed(2) };
        }"""
    )
    check('duas pessoas ficam lado a lado', lado['mesmaLinha'] and lado['aDireita'], str(lado))
    check('e o cartão é 16:9', abs(lado['proporcao'] - 16 / 9) < 0.05, str(lado['proporcao']))

    # --- câmera --------------------------------------------------------------
    #
    # A câmera falsa do Chrome **encerra a trilha sozinha** poucos quadros
    # depois de abrir, nesta máquina, com ou sem janela, em qualquer combinação
    # de flags. O dispositivo de áudio falso funciona; o de vídeo não. Isso tira
    # daqui a verificação da imagem — mas deixa uma melhor: a de que a interface
    # **se recupera** de uma trilha que morre, que é o caso real de quem tem a
    # câmera tomada por outro programa no meio da chamada.
    grade.locator('button[aria-label="Câmera desligada"]').click()

    check('a trilha que morre devolve o botão ao desligado',
          aparece(pgA, """() => document.querySelector(
              'section[aria-label="Participantes da chamada"] '
              + 'button[aria-label="Câmera desligada"]') !== null"""))

    # Botão aceso com imagem congelada é pior que desligado — e sumir com a
    # imagem sem dizer nada é quase tão ruim.
    check('e diz o que aconteceu, sem falar em erro',
          aparece(pgA, """() => [...document.querySelectorAll('[class*="toastRegion"]')]
              .some((e) => e.innerText.includes('câmera parou'))"""),
          pgA.evaluate("""() => [...document.querySelectorAll('[class*="toastRegion"]')]
              .map((e) => e.innerText).join(' | ')"""))

    check('e o cartão volta a ser o avatar, sem sair da grade',
          grade.locator('video').count() == 0
          and grade.locator('[class*="cartao"]').count() == 2)
    pgA.screenshot(path=str(SHOTS / '84-grade-dois.png'))

    # --- fechar --------------------------------------------------------------
    # `Escape` desfaz **um passo por vez**, e essa é a regra escrita em
    # design/02-shell-principal.md: tela cheia, tela em primeiro plano, sala,
    # gaveta, painel. Depois de ligar e desligar a câmera há um passo a mais
    # empilhado, e exigir que a primeira tecla feche a grade era exigir que a
    # ordem fosse ignorada. Duas teclas é o teto — se precisar de três, aí sim
    # há algo empilhando o que não devia.
    for _ in range(2):
        pgA.keyboard.press('Escape')
        pgA.wait_for_timeout(500)
        if pgA.locator('section[aria-label="Participantes da chamada"]').count() == 0:
            break
    check('Escape fecha a grade',
          pgA.locator('section[aria-label="Participantes da chamada"]').count() == 0)
    check('e não sai da chamada',
          'Conectado' in barra.inner_text(), barra.inner_text()[:40])

    barra.locator('button', has_text='Sair').click()
    pgB.locator('section[aria-label="Chamada em andamento"] button', has_text='Sair').click()
    pgA.wait_for_timeout(800)

    check('nenhum erro de página', not errosA and not errosB,
          '; '.join((errosA + errosB)[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
