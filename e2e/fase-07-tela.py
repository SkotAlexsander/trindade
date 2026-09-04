"""Compartilhar tela: transmitir, e assistir só por escolha.

A verificação que importa é a de que **quem não clicou em "Assistir" não recebe
pacote nenhum**. É o que faz uma tela em 4K ser viável numa equipe pequena: o
custo é pago só por quem está olhando, e isso se confere em `getStats`, não na
interface.

Neste Chrome headless o `getDisplayMedia` **nunca resolve**: não há tela, o
seletor não abre e nem `--auto-select-desktop-capture-source` acha uma fonte —
a promessa fica pendurada para sempre. Então o roteiro troca só essa função por
uma que devolve um `<canvas>` animado. Tudo o mais é o caminho de verdade:
publicação como fonte de tela, cartão de convite, assinatura por escolha,
contagem de bytes, foco e contador de espectadores. O que fica de fora é a
escolha da janela, que é coisa de olhar.

    docker compose up -d
    pnpm dev
    pnpm dev:seed
"""

import sys
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


def aparece(pg, funcao, tentativas=60, intervalo=250):
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

# Bytes de vídeo recebidos, somando todas as conexões da página. É a prova de
# que a assinatura não aconteceu: sem clicar, o número não sai do zero.
BYTES_DE_VIDEO = """
async () => {
  let bytes = 0;
  let trilhas = 0;
  for (const pc of window.__conexoes || []) {
    const stats = await pc.getStats();
    stats.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        bytes += s.bytesReceived || 0;
        trilhas += 1;
      }
    });
  }
  return { bytes, trilhas };
}
"""

ESPIAO = """
(() => {
  const Original = window.RTCPeerConnection;
  window.__conexoes = [];
  class Espiao extends Original {
    constructor(...a) { super(...a); window.__conexoes.push(this); }
  }
  window.RTCPeerConnection = Espiao;

  // A única troca: uma "tela" desenhada num canvas, com movimento para o codec
  // ter o que codificar. O resto do caminho é o de verdade.
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let n = 0;
    setInterval(() => {
      n += 7;
      ctx.fillStyle = '#101a2e';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#e879f9';
      ctx.fillRect((n * 3) % 1180, 300, 100, 100);
      ctx.fillStyle = '#e8f3fa';
      ctx.font = '48px sans-serif';
      ctx.fillText('tela de teste ' + n, 60, 120);
    }, 66);
    return canvas.captureStream(15);
  };
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=[
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
        ],
    )

    def abrir(nome):
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='dark',
                            permissions=['microphone', 'camera'])
        ctx.add_init_script(ESPIAO)
        pg = ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        entrar(pg, nome)
        return ctx, pg, erros

    ctxA, pgA, errosA = abrir('alex')
    ctxB, pgB, errosB = abrir('bruno')

    for pg in (pgA, pgB):
        pg.locator('button', has_text='sala').first.click()
    check('os dois entram na chamada',
          aparece(pgA, CONECTADO) and aparece(pgB, CONECTADO))

    barraA = pgA.locator('section[aria-label="Chamada em andamento"]')

    # --- o diálogo antes do seletor nativo -----------------------------------
    barraA.locator('button[aria-label="Compartilhar tela"]').click()
    pgA.wait_for_selector('dialog[open]', timeout=5000)
    dialogo = pgA.locator('dialog[open]')
    texto = dialogo.inner_text()

    check('o diálogo nomeia os presets por finalidade',
          'Texto e código' in texto and 'Nítido e fluido' in texto, texto[:100])
    check('e mostra os números ao lado', '1080p · 15 fps' in texto and '1440p · 60 fps' in texto)
    check('a caixa de áudio do sistema existe',
          dialogo.locator('[role="switch"]').count() == 1)
    pgA.screenshot(path=str(SHOTS / '85-escolher-preset.png'))

    dialogo.locator('input[value="texto"]').check()
    dialogo.locator('button', has_text='Escolher').click()

    check('a barra passa a dizer que você está transmitindo',
          aparece(pgA, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                          ?.textContent || '').includes('Você está transmitindo')"""),
          barraA.inner_text()[:120])
    check('e diz que ninguém está assistindo',
          'ninguém assistindo' in barraA.inner_text(), barraA.inner_text()[:160])

    # --- do outro lado: o convite, não a imagem ------------------------------
    pgB.locator('section[aria-label="Chamada em andamento"] '
                'button[aria-label="Grade de participantes"]').click()
    pgB.wait_for_selector('section[aria-label="Participantes da chamada"]', timeout=5000)
    gradeB = pgB.locator('section[aria-label="Participantes da chamada"]')

    check('quem transmite aparece com o cartão "está transmitindo"',
          aparece(pgB, """() => (document.querySelector(
              'section[aria-label="Participantes da chamada"]')?.textContent || '')
              .includes('está transmitindo')"""),
          gradeB.inner_text()[:120])
    # `>= 1` e não `== 1`: uma corrida interrompida deixa participante fantasma
    # na sala do LiveKit, e o número de cartões varia sem que nada esteja
    # errado. Ver e2e/README.md.
    check('com um botão de Assistir', gradeB.locator('button', has_text='Assistir').count() >= 1)
    check('e sem vídeo nenhum na tela', gradeB.locator('video').count() == 0)
    pgB.screenshot(path=str(SHOTS / '86-convite-assistir.png'))

    # A verificação que importa: sem clicar, o servidor não manda nada.
    pgB.wait_for_timeout(4000)
    antes = pgB.evaluate(BYTES_DE_VIDEO)
    check('e o servidor não envia um byte daquela tela',
          antes['bytes'] == 0, str(antes))

    # --- assistir ------------------------------------------------------------
    gradeB.locator('button', has_text='Assistir').first.click()
    check('clicar em Assistir traz a imagem, numa caixa própria',
          aparece(pgB, """() => document.querySelectorAll(
              'section[aria-label="Participantes da chamada"] [data-tela="true"] video')
              .length >= 1"""),
          str(gradeB.locator('[data-tela="true"] video').count()))

    # A tela é mais uma caixa ao lado das pessoas, e não uma troca de layout:
    # quem transmite continua na grade como todo mundo.
    check('e as pessoas continuam na grade',
          gradeB.locator('[class*="cartao"]:not([data-tela="true"])').count() >= 2,
          str(gradeB.locator('[class*="cartao"]').count()))

    check('e aí, sim, chegam pacotes',
          aparece(pgB, """async () => {
              for (const pc of window.__conexoes || []) {
                const stats = await pc.getStats();
                let bytes = 0;
                stats.forEach((s) => {
                  if (s.type === 'inbound-rtp' && s.kind === 'video') bytes += s.bytesReceived || 0;
                });
                if (bytes > 0) return true;
              }
              return false;
          }"""),
          str(pgB.evaluate(BYTES_DE_VIDEO)))

    # O contador de quem assiste é o mais útil da barra: transmitir para
    # ninguém é comum, e a pessoa deve saber.
    check('e quem transmite passa a ver "1 assistindo"',
          aparece(pgA, """() => (document.querySelector('section[aria-label="Chamada em andamento"]')
                          ?.textContent || '').includes('1 assistindo')"""),
          barraA.inner_text()[:160])

    # A conversa não sai da tela: em `ambos`, a chamada fica no centro e as
    # mensagens numa faixa ao lado — que é como se usa uma chamada de verdade.
    check('a conversa continua ao lado da chamada',
          pgB.locator('#compositor').is_visible()
          and pgB.locator('section[aria-label="Participantes da chamada"]').is_visible())

    lado = pgB.evaluate(
        """() => {
            const chamada = document.querySelector(
              'section[aria-label="Participantes da chamada"]').getBoundingClientRect();
            const conversa = document.querySelector('#compositor').getBoundingClientRect();
            return { chamadaAEsquerda: chamada.right <= conversa.left + 1,
                     larguraDaConversa: Math.round(conversa.width) };
        }"""
    )
    check('uma de cada lado, sem sobrepor', lado['chamadaAEsquerda'], str(lado))

    # Três estados, e a escolha é de quem está na sala.
    pgB.locator('button', has_text='Só a chamada').click()
    pgB.wait_for_timeout(400)
    check('"só a chamada" esconde a conversa', not pgB.locator('#compositor').is_visible())

    pgB.locator('button', has_text='Só a conversa').click()
    pgB.wait_for_timeout(400)
    check('"só a conversa" esconde a chamada, sem sair dela',
          pgB.locator('section[aria-label="Participantes da chamada"]').count() == 0
          and pgB.locator('#compositor').is_visible()
          and 'Conectado' in pgB.locator('section[aria-label="Chamada em andamento"]').inner_text())

    pgB.locator('section[aria-label="Chamada em andamento"] '
                'button[aria-label="Grade de participantes"]').click()
    pgB.wait_for_selector('section[aria-label="Participantes da chamada"]', timeout=5000)
    # O seletor é do grupo, não da página: o rail também marca o espaço ativo
    # com `data-ativo`.
    escolhido = pgB.locator('[aria-label="O que mostrar"] button[data-ativo="true"]')
    # A última escolha de **layout** volta — e "só a conversa" não é layout, é
    # "esconda a chamada agora": guardá-la faria o botão de reabrir não reabrir.
    check('e a última escolha de layout volta ao reabrir',
          escolhido.inner_text() == 'Só a chamada', escolhido.inner_text())

    # Clicar na caixa põe aquela tela em primeiro plano — "quero ver só a tela
    # dela" é um clique, e não um modo escondido.
    gradeB.locator('[data-tela="true"]').first.click()
    check('clicar na caixa põe a tela em primeiro plano',
          aparece(pgB, """() => document.querySelector('[class*="telaCheia"]') !== null"""))

    check('o espectador escolhe a própria qualidade',
          gradeB.locator('select').count() == 1
          and 'Automática' in gradeB.locator('select').inner_text(),
          gradeB.locator('select').inner_text()[:80] if gradeB.locator('select').count() else '')

    # A tela ocupa o principal e os participantes viram fileira lateral.
    layout = pgB.evaluate(
        """() => {
            const tela = document.querySelector('[class*="telaCheia"]');
            const fileira = document.querySelector('[class*="fileira"]');
            if (!tela || !fileira) return null;
            const t = tela.getBoundingClientRect();
            const f = fileira.getBoundingClientRect();
            return { larguraDaTela: Math.round(t.width), larguraDaFileira: Math.round(f.width),
                     ajuste: getComputedStyle(tela).objectFit };
        }"""
    )
    check('a tela ocupa o principal, com a fileira ao lado',
          layout and layout['larguraDaTela'] > layout['larguraDaFileira'] * 3, str(layout))
    # `contain`, nunca `cover`: cortar a tela de alguém esconde justamente o
    # canto onde estava o que ela queria mostrar.
    check('e a imagem cabe inteira, sem cortar', layout and layout['ajuste'] == 'contain',
          str(layout))
    pgB.screenshot(path=str(SHOTS / '87-assistindo.png'))

    # --- parar ---------------------------------------------------------------
    barraA.locator('button[aria-label="Transmitindo"]').click()
    check('parar tira a transmissão da barra',
          aparece(pgA, """() => !(document.querySelector('section[aria-label="Chamada em andamento"]')
                          ?.textContent || '').includes('Você está transmitindo')"""))
    check('e devolve o espectador à grade, sem vídeo preso',
          aparece(pgB, """() => {
              const g = document.querySelector('section[aria-label="Participantes da chamada"]');
              return g && g.querySelectorAll('video').length === 0;
          }"""))

    for pg in (pgA, pgB):
        pg.locator('section[aria-label="Chamada em andamento"] button', has_text='Sair').click()
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
