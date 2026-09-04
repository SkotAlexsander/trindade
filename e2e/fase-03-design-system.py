"""Percorre o aceite da fase 3 num Chrome de verdade."""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:5173'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''))


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)

    # --- 1. os dois temas ------------------------------------------------
    for esquema in ('dark', 'light'):
        ctx = b.new_context(viewport={'width': 1200, 'height': 1000}, color_scheme=esquema)
        pg = ctx.new_page()
        pg.goto(f'{BASE}/dev/ui', wait_until='networkidle')
        pg.wait_for_timeout(1200)
        pg.screenshot(path=str(SHOTS / f'31-devui-{esquema}.png'), full_page=True)

        aplicado = pg.evaluate('document.documentElement.dataset.theme')
        fundo = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        check(f'tema {esquema}: segue o sistema quando a preferência é "system"',
              aplicado == esquema, f'data-theme={aplicado} fundo={fundo}')
        ctx.close()

    ctx = b.new_context(viewport={'width': 1200, 'height': 1000}, color_scheme='dark')
    pg = ctx.new_page()
    erros = []
    externos = []
    respostas_ruins = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.on('request', lambda r: externos.append(r.url)
          if 'localhost' not in r.url and not r.url.startswith('data:') else None)
    pg.on('response', lambda r: respostas_ruins.append((r.status, r.url)) if r.status >= 400 else None)

    pg.goto(f'{BASE}/dev/ui', wait_until='networkidle')
    pg.wait_for_timeout(800)

    # --- 2. troca de tema persiste e não pisca ---------------------------
    pg.click('button:has-text("Claro")')
    pg.wait_for_timeout(400)
    check('trocar para claro aplica na hora',
          pg.evaluate('document.documentElement.dataset.theme') == 'light')

    cookie = next((c for c in ctx.cookies() if c['name'] == 'tema'), None)
    check('a preferência vai para cookie, não localStorage',
          cookie is not None and cookie['value'] == 'light'
          and pg.evaluate('JSON.stringify(Object.entries(localStorage))') == '[]',
          f"cookie={cookie['value'] if cookie else None}")

    # O atributo tem de estar certo já na primeira pintura: o script inline do
    # index.html carimba antes do React montar.
    pg.reload(wait_until='commit')
    cedo = pg.evaluate('document.documentElement.dataset.theme')
    pg.wait_for_load_state('networkidle')
    tarde = pg.evaluate('document.documentElement.dataset.theme')
    check('tema já correto antes do React montar (sem piscada)',
          cedo == 'light' and tarde == 'light', f'no commit={cedo}, depois={tarde}')
    pg.screenshot(path=str(SHOTS / '32-tema-claro-persistido.png'))

    pg.click('button:has-text("Escuro")')
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / '33-devui-escuro-final.png'), full_page=True)

    # --- 3. teclado ------------------------------------------------------
    pg.keyboard.press('Tab')
    foco = pg.evaluate("""() => {
        const el = document.activeElement;
        const cs = getComputedStyle(el);
        const wrap = el.closest('div');
        return { tag: el.tagName, texto: (el.innerText||el.value||'').slice(0,20),
                 anel: cs.boxShadow !== 'none' || (wrap && getComputedStyle(wrap).boxShadow !== 'none') };
    }""")
    check('o primeiro Tab foca algo interativo com anel visível',
          foco['anel'], json.dumps(foco, ensure_ascii=False))

    # --- 4. diálogo: foco preso, Escape fecha, foco volta ----------------
    botao = pg.locator('button:has-text("Abrir diálogo")')
    botao.focus()
    botao.press('Enter')
    pg.wait_for_selector('dialog[open]', timeout=5000)
    dentro = pg.evaluate("""() => document.querySelector('dialog[open]').contains(document.activeElement)""")
    check('ao abrir, o foco entra no diálogo', dentro)
    pg.screenshot(path=str(SHOTS / '34-dialogo.png'))

    # Tab várias vezes não deve escapar do diálogo.
    for _ in range(8):
        pg.keyboard.press('Tab')
    preso = pg.evaluate("""() => document.querySelector('dialog[open]').contains(document.activeElement)""")
    check('o foco não escapa do diálogo pelo Tab', preso)

    pg.keyboard.press('Escape')
    pg.wait_for_selector('dialog[open]', state='detached', timeout=5000)
    pg.wait_for_timeout(300)
    voltou = pg.evaluate("""() => (document.activeElement.innerText||'').includes('Abrir diálogo')""")
    check('Escape fecha e devolve o foco ao botão que abriu',
          pg.locator('dialog[open]').count() == 0 and voltou,
          pg.evaluate("document.activeElement.tagName"))

    # --- 5. menu por teclado ---------------------------------------------
    menu = pg.locator('button:has-text("Ações")')
    menu.focus()
    menu.press('Enter')
    pg.wait_for_selector('[role="menu"]', timeout=5000)
    pg.keyboard.press('ArrowDown')
    pg.wait_for_timeout(150)
    primeiro = pg.evaluate('document.activeElement.innerText')
    pg.keyboard.press('ArrowDown')
    pg.wait_for_timeout(150)
    segundo = pg.evaluate('document.activeElement.innerText')
    check('setas navegam pelo menu', primeiro != segundo and primeiro and segundo,
          f'{primeiro!r} -> {segundo!r}')
    pg.screenshot(path=str(SHOTS / '35-menu.png'))
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(300)
    check('Escape fecha o menu', pg.locator('[role="menu"]').count() == 0)

    # --- 6. tooltip aparece no foco --------------------------------------
    pg.locator('button[aria-label="Apagar mensagem"]').focus()
    pg.wait_for_timeout(600)
    check('tooltip abre no foco, não só no hover', pg.locator('[role="tooltip"]').count() > 0)
    pg.keyboard.press('Escape')

    # --- 7. toast --------------------------------------------------------
    for _ in range(4):
        pg.click('button:has-text("Mostrar aviso")')
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(300)
    n = pg.locator('[role="status"] [data-kind]').count()
    check('toast empilha no máximo três', n == 3, f'{n} na tela')
    pg.screenshot(path=str(SHOTS / '36-toast.png'))

    # --- 8. rede ---------------------------------------------------------
    check('nenhuma requisição para domínio externo', not externos, str(externos[:3]))
    ruins = [(s, u) for s, u in respostas_ruins if 'favicon' not in u]
    check('nenhuma resposta de erro', not ruins, str(ruins[:3]))
    check('nenhum erro de JavaScript', not erros, str(erros[:2]))

    # --- 9. fontes locais ------------------------------------------------
    fontes = pg.evaluate("""() => performance.getEntriesByType('resource')
        .filter(r => r.name.includes('.woff2')).map(r => r.name)""")
    check('as fontes vêm de /fonts/ local',
          bool(fontes) and all('localhost' in f and '/fonts/' in f for f in fontes),
          f'{len(fontes)} arquivos')

    ctx.close()

    # --- 10. reduced motion ----------------------------------------------
    ctx = b.new_context(viewport={'width': 1200, 'height': 900}, color_scheme='dark',
                        reduced_motion='reduce')
    pg = ctx.new_page()
    pg.goto(f'{BASE}/dev/ui', wait_until='networkidle')
    pg.wait_for_timeout(500)
    duracoes = pg.evaluate("""() => {
        const sk = document.querySelector('[aria-hidden="true"][style*="width"]');
        const sp = document.querySelector('[role="status"] div');
        return [sk && getComputedStyle(sk).animationDuration,
                sp && getComputedStyle(sp).animationDuration];
    }""")
    def quase_zero(d):
        if d is None:
            return True
        # `0.01ms` volta do getComputedStyle como '1e-05s'.
        return float(d.rstrip('s')) < 0.001

    check('prefers-reduced-motion zera as animações',
          all(quase_zero(d) for d in duracoes), str(duracoes))
    ctx.close()

    b.close()

print('\n' + '=' * 60)
ok = sum(1 for _, o, _ in resultados if o)
print(f'{ok}/{len(resultados)} passaram')
for nome, o, det in resultados:
    if not o:
        print(f'  FALHOU: {nome}  {det}')
sys.exit(0 if ok == len(resultados) else 1)
