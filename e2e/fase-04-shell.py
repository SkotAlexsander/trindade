"""Percorre o aceite da fase 4 num Chrome de verdade."""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'
USUARIO, SENHA = 'alex', 'senha-de-teste-123'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''))


def entrar(pg, usuario=USUARIO, senha=SENHA):
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')
    pg.fill('input[autocomplete="username"]', usuario)
    pg.fill('input[autocomplete="current-password"]', senha)
    pg.click('button[type="submit"]')
    pg.wait_for_url('**/c/**', timeout=25000)
    pg.wait_for_load_state('networkidle')
    pg.wait_for_timeout(600)


def retomar(navegador, estado, **opcoes):
    """Contexto novo a partir do cookie `rt`, sem passar pelo login.

    O rate limit do login é 5 por 15 minutos por usuário, e este roteiro abre
    cinco janelas. Reaproveitar o refresh token é o que impede a suíte de se
    auto-bloquear — e de quebra exercita a retomada de sessão.

    Devolve o estado **novo**: cada retomada rotaciona o token, e reapresentar
    o antigo é exatamente o que a detecção de reuso derruba. Encadear é
    obrigatório, não capricho.
    """
    ctx = navegador.new_context(storage_state=estado, color_scheme='dark', **opcoes)
    pg = ctx.new_page()
    pg.goto(f'{BASE}/', wait_until='networkidle')
    pg.wait_for_url('**/c/**', timeout=20000)
    pg.wait_for_timeout(700)
    return ctx, pg, ctx.storage_state()


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))

    entrar(pg)
    estadoAdmin = ctx.storage_state()
    pg.screenshot(path=str(SHOTS / '41-shell.png'))

    # --- 1. as quatro colunas nas proporções corretas --------------------
    cols = pg.evaluate("""() => {
        const shell = document.querySelector('div[class*="shell"]');
        return getComputedStyle(shell).gridTemplateColumns;
    }""")
    larguras = [round(float(v.replace('px', ''))) for v in cols.split()]
    check('a grade tem quatro colunas: 56 / 232 / flexível / painel',
          len(larguras) == 4 and larguras[0] == 56 and larguras[1] == 232 and larguras[2] > 400,
          cols)

    altura = pg.evaluate("""() => {
        const s = getComputedStyle(document.querySelector('div[class*="shell"]'));
        return s.height;
    }""")
    check('o shell usa a altura da janela', altura.startswith('900'), altura)

    # --- 2. elenco: cinco espaços, offline esmaecido ---------------------
    espacos = pg.locator('[role="group"][aria-label="Elenco"] button')
    check('o elenco mostra cinco espaços', espacos.count() == 5, f'{espacos.count()}')

    estados = pg.evaluate("""() => [...document.querySelectorAll('[aria-label="Elenco"] button')]
        .map(b => ({ rotulo: b.getAttribute('aria-label'), estado: b.dataset.estado,
                     filtro: getComputedStyle(b.querySelector('span')).filter }))""")
    offline = [e for e in estados if e['estado'] == 'offline']
    check('offline aparece esmaecido, não some',
          len(offline) == 1 and 'grayscale' in offline[0]['filtro'],
          offline[0]['rotulo'] if offline else 'nenhum offline')

    online = [e for e in estados if e['estado'] == 'online']
    check('online tem anel de duas camadas',
          bool(online) and pg.evaluate("""() => {
              const b = [...document.querySelectorAll('[aria-label="Elenco"] button')]
                  .find(x => x.dataset.estado === 'online');
              // Duas camadas de cor: o sulco e o anel.
              return (getComputedStyle(b.querySelector('span')).boxShadow.match(/rgba?\(/g) || []).length >= 2;
          }"""), f'{len(online)} online')

    # --- 3. não lido é distinguível sem cor ------------------------------
    itens = pg.evaluate("""() => [...document.querySelectorAll('nav[aria-label="Canais"] a')]
        .map(a => ({ nome: a.textContent.trim(), unread: a.dataset.unread,
                     peso: getComputedStyle(a).fontWeight,
                     temPonto: !!a.querySelector('[aria-label="não lido"]'),
                     temPilula: !!a.querySelector('[aria-label*="menç"]') }))""")
    naoLidos = [i for i in itens if i['unread'] == 'true']
    check('não lido usa peso 600 mais um sinal, nunca só cor',
          bool(naoLidos) and all(int(i['peso']) >= 500 and (i['temPonto'] or i['temPilula'])
                                 for i in naoLidos),
          json.dumps(naoLidos, ensure_ascii=False))

    check('menção vira pílula com contador', any(i['temPilula'] for i in itens),
          str([i['nome'] for i in itens if i['temPilula']]))

    # --- 4. painel abre sem reflow da grade ------------------------------
    antes = pg.evaluate("""() => document.querySelector('div[class*="conversa"]').getBoundingClientRect().width""")
    pg.click('button[aria-label="Notas"]')
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(SHOTS / '42-painel.png'))
    depois = pg.evaluate("""() => document.querySelector('div[class*="conversa"]').getBoundingClientRect().width""")
    aberto = pg.evaluate("""() => document.querySelector('div[class*="painelSlot"]').dataset.open""")
    check('o painel abre e a conversa cede espaço', aberto == 'true' and depois < antes,
          f'{round(antes)} -> {round(depois)}')

    # --- 5. Escape só fecha o painel se o foco estiver dentro ------------
    pg.locator('div[id="compositor"]').click()
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    aindaAberto = pg.evaluate("""() => document.querySelector('div[class*="painelSlot"]').dataset.open""")
    check('Escape fora do painel não o fecha', aindaAberto == 'true', aindaAberto)

    pg.locator('button[aria-label="Fechar painel"]').focus()
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(400)
    fechou = pg.evaluate("""() => document.querySelector('div[class*="painelSlot"]').dataset.open""")
    check('Escape com o foco dentro do painel fecha', fechou == 'false', fechou)

    # --- 6. atalhos ------------------------------------------------------
    inicial = pg.url
    pg.keyboard.press('Alt+ArrowDown')
    pg.wait_for_timeout(400)
    trocou = pg.url
    check('Alt ↓ troca de canal', trocou != inicial, f'{inicial.split("/")[-1]} -> {trocou.split("/")[-1]}')

    # Enquanto digita, não pode trocar.
    pg.evaluate("""() => {
        const i = document.createElement('input');
        i.id = 'campo-de-teste';
        document.body.appendChild(i);
        i.focus();
    }""")
    antesDigitando = pg.url
    pg.keyboard.press('Alt+ArrowDown')
    pg.wait_for_timeout(400)
    check('Alt ↓ não dispara enquanto digita', pg.url == antesDigitando, pg.url.split('/')[-1])
    pg.evaluate("""() => document.getElementById('campo-de-teste')?.remove()""")

    # --- 7. paleta de comandos -------------------------------------------
    pg.keyboard.press('Control+k')
    pg.wait_for_selector('[aria-label="Ir para"]', timeout=5000)
    pg.keyboard.type('bug')
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / '43-paleta.png'))
    opcoes = pg.evaluate("""() => [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)""")
    check('Ctrl K acha canal por busca difusa',
          any('bugs' in o for o in opcoes), str(opcoes[:3]))

    pg.fill('input[aria-label="Ir para"]', '')
    pg.keyboard.type('carla')
    pg.wait_for_timeout(400)
    opcoes = pg.evaluate("""() => [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)""")
    check('Ctrl K acha pessoa', any('Carla' in o for o in opcoes), str(opcoes[:3]))

    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    check('Escape fecha a paleta', pg.locator('[aria-label="Ir para"]').count() == 0)

    # --- 8. menu do servidor: item sem permissão não aparece -------------
    pg.click('button[aria-haspopup="menu"]')
    pg.wait_for_selector('[role="menu"]', timeout=5000)
    itensMenu = pg.evaluate("""() => [...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())""")
    check('admin vê os itens de gestão no menu do servidor',
          'Cargos e permissões' in itensMenu and 'Criar canal' in itensMenu, str(itensMenu))
    pg.screenshot(path=str(SHOTS / '44-menu-servidor.png'))
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)

    check('nenhum erro de JavaScript', not erros, str(erros[:2]))
    ctx.close()

    # --- 9. sem permissão, os itens somem --------------------------------
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark')
    pg = ctx.new_page()
    entrar(pg, 'daniel', 'cavalo-bateria-grampo-9')

    pg.click('button[aria-haspopup="menu"]')
    pg.wait_for_selector('[role="menu"]', timeout=5000)
    itensMembro = pg.evaluate("""() => [...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())""")
    check('membro (daniel) não vê "Cargos e permissões" nem desabilitado',
          'Cargos e permissões' not in itensMembro and 'Criar canal' not in itensMembro,
          str(itensMembro))
    desabilitados = pg.evaluate("""() => [...document.querySelectorAll('[role="menuitem"][disabled]')].length""")
    check('nenhum item aparece desabilitado', desabilitados == 0, f'{desabilitados}')
    ctx.close()

    # --- 10. responsivo ---------------------------------------------------
    for largura, nome, colunas in ((1440, 'completo', 4), (1100, 'sem-painel', 3), (700, 'pilha', 1)):
        ctx, pg, estadoAdmin = retomar(b, estadoAdmin, viewport={'width': largura, 'height': 860})

        n = pg.evaluate("""() => getComputedStyle(document.querySelector('div[class*="shell"]'))
            .gridTemplateColumns.split(' ').length""")
        check(f'{largura}px: {colunas} coluna(s) na grade', n == colunas, f'{n}')

        if largura == 700:
            pg.screenshot(path=str(SHOTS / '45-pilha-fechada.png'))
            pg.click('button[aria-label="Abrir canais"]')
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(SHOTS / '46-pilha-gaveta.png'))

            # O elenco não some no celular, e fica no topo da gaveta.
            elenco = pg.locator('[aria-label="Elenco"]')
            visivel = elenco.is_visible()
            posicao = pg.evaluate("""() => {
                const el = document.querySelector('[aria-label="Elenco"]');
                const lista = document.querySelector('nav[aria-label="Canais"]');
                if (!el || !lista) return null;
                return el.getBoundingClientRect().top < lista.getBoundingClientRect().top;
            }""")
            check('abaixo de 900px o elenco continua visível', visivel)
            check('e fica no topo da gaveta, acima da lista', posicao is True, str(posicao))

            alvos = pg.evaluate("""() => [...document.querySelectorAll('nav[aria-label="Canais"] a')]
                .map(a => a.getBoundingClientRect().height)""")
            check('alvos de toque com pelo menos 32px', all(h >= 32 for h in alvos), str(alvos[:3]))
        ctx.close()

    b.close()

print('\n' + '=' * 60)
ok = sum(1 for _, o, _ in resultados if o)
print(f'{ok}/{len(resultados)} passaram')
for nome, o, det in resultados:
    if not o:
        print(f'  FALHOU: {nome}  {det}')
sys.exit(0 if ok == len(resultados) else 1)
