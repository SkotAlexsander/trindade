"""Percorre o aceite da fase 5 (fatia 2) num Chrome de verdade.

Duas janelas: alex e daniel. O que este roteiro procura não aparece em teste
de unidade — rolagem, altura, ordem de repintura, substituição sem piscar.

Antes de rodar, semeie o histórico (senão a paginação não tem o que paginar):

    docker compose exec -T postgres psql -U trindade -d trindade         < e2e/semear-historico.sql

A queda de conexão é feita **reiniciando a API** — que é o que o aceite da fase
pede. Duas alternativas foram descartadas por não derrubarem nada:
`context.set_offline`, que bloqueia HTTP e deixa o WebSocket já aberto de pé, e
`route_web_socket`, que trava a API síncrona do Playwright quando um `evaluate`
bloqueante coincide com tráfego no socket.

As regras de tempo da reconexão — backoff, jitter, fila — estão em
`packages/web/test/ws.test.ts`, contra um servidor WebSocket de verdade. Aqui
se confere só o que precisa de navegador: a faixa, a fila na tela, e o
histórico que volta.
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
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''), flush=True)


def etapa(nome):
    print(f'  ... {nome}', flush=True)


def entrar(pg, usuario, senha):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    # Sempre #geral: é o canal semeado, e o destino automático depende do
    # estado de leitura, que ainda é de espaço reservado.
    pg.goto(f'{BASE}/c/geral', wait_until='networkidle')
    pg.wait_for_selector('#compositor', timeout=15000)
    pg.wait_for_timeout(900)


def compositor(pg):
    return pg.locator('#compositor')


def corpos(pg):
    return pg.locator('article[class*="mensagem"] p[class*="corpo"]')


def escrever(pg, texto):
    compositor(pg).click()
    compositor(pg).fill(texto)
    compositor(pg).press('Enter')


def aparece(pg, texto, ms=12000):
    """Espera o texto surgir, em vez de dormir um tanto e torcer.

    Depois de reconectar há uma corrida real: a API acabou de reiniciar, a
    fila esvazia e o `?after=` busca o que passou. Um `wait_for_timeout` fixo
    aqui faz o teste passar ou falhar conforme o dia.
    """
    try:
        pg.wait_for_selector(f'text={texto}', timeout=ms)
        return True
    except Exception:  # noqa: BLE001
        return False


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

    pgA.screenshot(path=str(SHOTS / '51-conversa.png'))

    marca = str(int(time.time()))[-6:]

    # --- 1. envio otimista aparece antes da confirmação -------------------
    #
    # O que prova o otimismo não é "apareceu rápido" — a rede local responde em
    # milissegundos e o cronômetro não distinguiria. É o **estado** da linha no
    # instante em que ela entra no DOM: `data-local="enviando"` só existe antes
    # da confirmação do servidor.
    texto1 = f'primeira mensagem {marca}'
    compositor(pgA).click()
    compositor(pgA).fill(texto1)

    pgA.evaluate(
        """(t) => {
            window.__primeiroEstado = new Promise((resolve) => {
                const achar = () => [...document.querySelectorAll('article p')]
                    .find(e => e.textContent.includes(t));
                const obs = new MutationObserver(() => {
                    const p = achar();
                    if (!p) return;
                    obs.disconnect();
                    resolve(p.closest('article').dataset.local ?? 'sem-estado');
                });
                obs.observe(document.body, { childList: true, subtree: true, characterData: true });
                setTimeout(() => { obs.disconnect(); resolve('nunca apareceu'); }, 5000);
            });
        }""",
        texto1,
    )
    compositor(pgA).press('Enter')
    estadoInicial = pgA.evaluate('() => window.__primeiroEstado')
    check(
        'a linha entra no DOM já como enviada de forma otimista',
        estadoInicial == 'enviando',
        f'estado ao aparecer: {estadoInicial}',
    )

    pgA.wait_for_timeout(900)

    # --- 2. o campo esvazia e a mensagem confirma -------------------------
    check('o campo esvazia ao enviar', compositor(pgA).input_value() == '')

    opacidade = pgA.evaluate(
        """(t) => {
            const p = [...document.querySelectorAll('article p')].find(e => e.textContent.includes(t));
            return p ? getComputedStyle(p).opacity : null;
        }""",
        texto1,
    )
    check('confirmada, a mensagem perde a opacidade de envio', opacidade == '1', f'opacity={opacidade}')

    # --- 3. chega na outra janela ----------------------------------------
    pgB.wait_for_selector(f'text={texto1}', timeout=8000)
    check('a outra pessoa recebe em tempo real', True)

    # --- 4. agrupamento: segunda do mesmo autor não repete o cabeçalho ----
    texto2 = f'segunda seguida {marca}'
    escrever(pgA, texto2)
    pgA.wait_for_timeout(700)

    cabecas = pgA.evaluate(
        """(ts) => ts.map(t => {
            const p = [...document.querySelectorAll('article p')].find(e => e.textContent.includes(t));
            return p ? p.closest('article').dataset.cabeca : null;
        })""",
        [texto1, texto2],
    )
    check('a primeira do bloco tem cabeçalho e a segunda não', cabecas == ['true', 'false'], str(cabecas))

    # --- 5. autor diferente quebra o bloco --------------------------------
    texto3 = f'resposta do daniel {marca}'
    escrever(pgB, texto3)
    pgA.wait_for_selector(f'text={texto3}', timeout=8000)
    cabeca3 = pgA.evaluate(
        """(t) => {
            const p = [...document.querySelectorAll('article p')].find(e => e.textContent.includes(t));
            return p ? p.closest('article').dataset.cabeca : null;
        }""",
        texto3,
    )
    check('trocar de autor abre bloco novo', cabeca3 == 'true')

    # --- 6. o ritmo de 2px e 12px ----------------------------------------
    margens = pgA.evaluate(
        """() => {
            const artigos = [...document.querySelectorAll('article[class*="mensagem"]')];
            const cabeca = artigos.find(a => a.dataset.cabeca === 'true');
            const cont = artigos.find(a => a.dataset.cabeca === 'false');
            return [cabeca && getComputedStyle(cabeca).marginTop, cont && getComputedStyle(cont).marginTop];
        }"""
    )
    check('12px entre blocos e 0 dentro do bloco', margens == ['12px', '0px'], str(margens))

    # --- 7. divisor de dia existe, gruda, e um só por vez ------------------
    divisor = pgA.locator('div[class*="divisorDia"]').first
    posicao = divisor.evaluate('el => getComputedStyle(el).position') if divisor.count() else None
    check('o divisor de dia gruda no topo', posicao == 'sticky', str(posicao))

    # Com todos os divisores irmãos no mesmo container, cada um se prende ao
    # topo pelo scroll inteiro e eles aparecem empilhados na mesma linha. Foi o
    # que aconteceu antes de existir uma seção por dia.
    sobrepostos = pgA.evaluate(
        """() => {
            const el = document.querySelector('div[class*="rolagem"]');
            el.scrollTop = Math.floor(el.scrollHeight / 2);
            const r = [...document.querySelectorAll('div[class*="divisorDia"]')]
                .map(d => d.getBoundingClientRect());
            let pares = 0;
            for (let i = 0; i < r.length; i++)
                for (let j = i + 1; j < r.length; j++)
                    if (r[i].bottom > r[j].top + 1 && r[j].bottom > r[i].top + 1) pares++;
            return pares;
        }"""
    )
    check('divisores de dias diferentes nunca se sobrepõem', sobrepostos == 0, f'{sobrepostos} pares')

    # --- 8. rolagem cola no fim -------------------------------------------
    etapa('8. rolagem cola no fim')
    #
    # Doze mensagens, não vinte e cinco: o balde do servidor é 10 por 10s com
    # estouro de 3, e estourá-lo aqui testaria o rate limit por acidente e
    # encheria a lista de mensagens que falharam.
    for i in range(12):
        escrever(pgA, f'enchendo {i} {marca}')
        pgA.wait_for_timeout(120)
    pgA.wait_for_timeout(1500)

    doFim = pgA.evaluate(
        """() => {
            const el = document.querySelector('div[class*="rolagem"]');
            return el.scrollHeight - el.scrollTop - el.clientHeight;
        }"""
    )
    check('enviar mantém a lista colada no fim', doFim < 5, f'{doFim}px do fim')

    # --- 9. rolado para cima, mensagem nova não move a tela ----------------
    etapa('9. rolado para cima, mensagem nova não move a tela')
    pgA.evaluate("() => { document.querySelector('div[class*=\"rolagem\"]').scrollTop = 0; }")
    pgA.wait_for_timeout(400)
    antes = pgA.evaluate("() => document.querySelector('div[class*=\"rolagem\"]').scrollTop")

    escrever(pgB, f'chegando enquanto lê {marca}')
    pgA.wait_for_timeout(1200)
    depois = pgA.evaluate("() => document.querySelector('div[class*=\"rolagem\"]').scrollTop")
    check('mensagem nova não rola a tela de quem está lendo', abs(depois - antes) < 4, f'{antes} -> {depois}')

    botao = pgA.locator('button[class*="novas"]')
    check('aparece o botão "N mensagens novas"', botao.count() == 1)
    pgA.screenshot(path=str(SHOTS / '52-mensagens-novas.png'))

    if botao.count():
        botao.click()
        pgA.wait_for_timeout(900)
        doFim2 = pgA.evaluate(
            """() => {
                const el = document.querySelector('div[class*="rolagem"]');
                return el.scrollHeight - el.scrollTop - el.clientHeight;
            }"""
        )
        check('clicar no botão desce até o fim', doFim2 < 5, f'{doFim2}px')

    # --- 10. carregar histórico antigo não salta --------------------------
    etapa('10. carregar histórico antigo não salta')
    #
    # A medida certa não é "onde a âncora estava antes de eu rolar" — rolar
    # move a âncora por definição. É onde ela está **logo depois** de o
    # carregamento começar contra onde ela está depois de ele terminar: se a
    # compensação de `scrollHeight` falhar, a diferença é a altura da página
    # inteira que entrou por cima.
    medida = pgA.evaluate(
        """async () => {
            const el = document.querySelector('div[class*="rolagem"]');
            const antes = el.querySelectorAll('article').length;
            el.scrollTop = 0;
            await new Promise(r => requestAnimationFrame(r));
            const ancora = el.querySelector('article:nth-of-type(3)') || el.querySelector('article');
            const topoAntes = ancora.getBoundingClientRect().top;
            await new Promise(r => setTimeout(r, 2500));
            return {
                salto: Math.abs(ancora.getBoundingClientRect().top - topoAntes),
                antes,
                depois: el.querySelectorAll('article').length,
            };
        }"""
    )
    check(
        'carregar histórico antigo traz mais uma página',
        medida['depois'] > medida['antes'],
        f"{medida['antes']} -> {medida['depois']} mensagens",
    )
    check(
        'e não move o que está na tela',
        medida['salto'] < 8,
        f"a âncora andou {round(medida['salto'])}px",
    )

    # --- 11. ↑ no campo vazio edita a última ------------------------------
    etapa('11. ↑ no campo vazio edita a última')
    pgA.evaluate("() => { const el = document.querySelector('div[class*=\"rolagem\"]'); el.scrollTop = el.scrollHeight; }")
    compositor(pgA).click()
    compositor(pgA).press('ArrowUp')
    pgA.wait_for_timeout(400)
    # A barra é `barraContexto`, e ela serve para editar **e** para responder —
    # é o texto que diz qual dos dois. Este seletor já esteve errado
    # (`barraEdicao`, que nunca existiu), e o estrago não ficou aqui: o `if`
    # abaixo era pulado, o `Esc` que cancela a edição nunca acontecia, e o
    # compositor seguia em modo de edição pelo resto do roteiro — o que fazia a
    # escrita fora do ar virar um PATCH em vez de entrar na fila, três
    # verificações adiante.
    barra = pgA.locator('div[class*="barraContexto"]')
    emEdicao = barra.count() == 1 and 'Editando' in barra.inner_text()
    conteudo = compositor(pgA).input_value()
    check('↑ no campo vazio abre a última mensagem para edição', emEdicao and conteudo != '', conteudo[:40])

    if emEdicao:
        compositor(pgA).fill(f'editada {marca}')
        compositor(pgA).press('Enter')
        pgB.wait_for_selector(f'text=editada {marca}', timeout=8000)
        editado = pgB.locator('span[class*="editado"]').count() > 0
        check('a edição propaga e marca "(editado)"', editado)

        compositor(pgA).click()
        compositor(pgA).press('ArrowUp')
        pgA.wait_for_timeout(300)
        compositor(pgA).press('Escape')
        pgA.wait_for_timeout(300)
        check('Esc cancela a edição', pgA.locator('div[class*="barraContexto"]').count() == 0)

    # --- 12. Shift+Enter quebra linha em vez de enviar --------------------
    etapa('12. Shift+Enter quebra linha em vez de enviar')
    compositor(pgA).click()
    compositor(pgA).fill('linha um')
    compositor(pgA).press('Shift+Enter')
    compositor(pgA).type('linha dois')
    valor = compositor(pgA).input_value()
    altura = compositor(pgA).evaluate('el => el.getBoundingClientRect().height')
    check('Shift+Enter quebra a linha e o campo cresce', '\n' in valor and altura > 40, f'{altura}px')
    compositor(pgA).fill('')
    pgA.wait_for_timeout(200)
    alturaVazio = compositor(pgA).evaluate('el => el.getBoundingClientRect().height')
    check('apagar tudo devolve o campo a 40px', abs(alturaVazio - 40) < 2, f'{alturaVazio}px')

    # --- 13. indicador de digitação ---------------------------------------
    etapa('13. indicador de digitação')
    compositor(pgB).click()
    compositor(pgB).type('escrevendo devagar')
    pgA.wait_for_timeout(900)
    digitando = pgA.locator('p[class*="digitando"]').inner_text()
    check('o outro lado vê "está digitando"', 'digitando' in digitando, digitando)
    compositor(pgB).fill('')

    # --- 14. derrubar a API levanta a faixa -------------------------------
    #
    # `tsx watch` reinicia a API ao ver o arquivo mudar, e reiniciar fecha
    # todos os sockets. É a queda que o aceite da fase descreve.
    etapa('derrubar a API levanta a faixa')

    # Duas coisas juntas, porque uma só não basta: o modo offline do Playwright
    # não fecha o socket já aberto, e reiniciar a API sozinho às vezes volta
    # tão rápido que a faixa nem chega a aparecer — o que seria o
    # comportamento certo, e um teste que passa ou falha conforme a velocidade
    # do watcher não testa nada.
    pgA.context.set_offline(True)
    Path('packages/api/src/app.ts').touch()

    faixa = False
    limite = time.time() + 12
    while time.time() < limite:
        if pgA.locator('div[class*="faixaOffline"]').count() == 1:
            faixa = True
            break
        pgA.wait_for_timeout(150)
    check('reiniciar a API levanta a faixa de desconexão', faixa)

    if faixa:
        pgA.screenshot(path=str(SHOTS / '53-desconectado.png'))
        empurra = pgA.evaluate(
            """() => {
                const faixa = document.querySelector('div[class*="faixaOffline"]');
                const cab = document.querySelector('header');
                return cab.getBoundingClientRect().top >= faixa.getBoundingClientRect().bottom - 1;
            }"""
        )
        check('a faixa empurra o conteúdo, não sobrepõe', empurra)

        # --- 15. escrever com o socket caído enfileira --------------------
        etapa('escrever com o socket caído enfileira')
        offline_txt = f'escrita fora do ar {marca}'
        escrever(pgA, offline_txt)
        pgA.wait_for_timeout(500)
        naFila = pgA.evaluate(
            """(t) => {
                const p = [...document.querySelectorAll('article p')].find(e => e.textContent.includes(t));
                return p ? p.closest('article').dataset.local : null;
            }""",
            offline_txt,
        )
        check('mensagem escrita fora do ar fica na fila', naFila == 'na-fila', str(naFila))
    else:
        offline_txt = None

    # Daniel continua no ar e escreve enquanto alex está fora. Esta é a
    # mensagem que só chega se a recuperação por `?after=` funcionar — o
    # socket de alex não estava lá para receber o evento.
    perdida = f'perdida na queda {marca}'
    escrever(pgB, perdida)
    pgB.wait_for_selector(f'text={perdida}', timeout=10000)

    # --- 16. volta sozinho e recupera o que passou ------------------------
    etapa('volta sozinho e recupera o que passou')
    pgA.context.set_offline(False)
    pgA.wait_for_selector('div[class*="faixaOffline"]', state='detached', timeout=45000)
    check('reconecta sozinho, sem recarregar a página', True)

    if offline_txt:
        check('a mensagem da fila sai quando a conexão volta', aparece(pgB, offline_txt))

    check('recupera o que passou enquanto estava fora, sem recarregar',
          aparece(pgA, perdida))

    # E volta a receber ao vivo.
    depois_txt = f'depois de voltar {marca}'
    escrever(pgB, depois_txt)
    check('volta a receber ao vivo', aparece(pgA, depois_txt))

    pgA.screenshot(path=str(SHOTS / '54-recuperado.png'))

    # --- 17. nenhuma duplicata --------------------------------------------
    etapa('17. nenhuma duplicata')
    duplicadas = pgA.evaluate(
        """() => {
            const textos = [...document.querySelectorAll('article p[class*="corpo"]')].map(p => p.textContent);
            const vistos = new Set(); const dupes = [];
            for (const t of textos) { if (vistos.has(t)) dupes.push(t); vistos.add(t); }
            return dupes;
        }"""
    )
    check('nenhuma mensagem duplicada na lista', len(duplicadas) == 0, str(duplicadas[:3]))

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    ctxA.close()
    ctxB.close()
    b.close()

passou = sum(1 for _, ok, _ in resultados if ok)
print(f'\n{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
