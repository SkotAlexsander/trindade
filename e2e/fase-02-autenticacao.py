"""Percorre os testes à mão do Passo 2 do COMECE-AQUI.md num Chrome de verdade.

Usa o Chrome já instalado (channel='chrome'), sem baixar navegador.
"""

import json
import re
import subprocess
import time
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)

BASE = 'http://localhost:5173'
# Nome novo a cada corrida: a chave do rate limit do login inclui o
# usuário, e reaproveitar herdaria o balde da execução anterior.
SUFIXO = str(int(time.time()))[-6:]
CODIGO = 'CONVITE-UI-' + SUFIXO
USUARIO = 'uiteste' + SUFIXO
SENHA = 'cavalo-bateria-grampo-9'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''))


def psql(sql):
    """Roda SQL no Postgres do compose e devolve a saída."""
    return subprocess.run(
        [
            r'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
            'compose', 'exec', '-T', 'postgres',
            'psql', '-U', 'trindade', '-d', 'trindade', '-t', '-A', '-c', sql,
        ],
        cwd=r'A:\Claude\03-projetos\PROJETO TRINDADE',
        capture_output=True, text=True, timeout=60,
    ).stdout.strip()


# Convite novo para a corrida da interface.
psql(
    f"insert into invites (code, created_by, expires_at) values "
    f"('{CODIGO}', (select id from users where username='alex'), now() + interval '1 day')"
)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()

    # Guarda a URL, não só o texto: "Failed to load resource" sem saber de quê
    # não serve para julgar nada.
    respostas_ruins = []
    page.on('response', lambda r: respostas_ruins.append((r.status, r.url)) if r.status >= 400 else None)

    # --- 2. tela de aceitar convite -------------------------------------
    page.goto(f'{BASE}/entrar/{CODIGO}')
    # Esperar o resultado, não o `networkidle`: a prévia do convite é uma
    # consulta do cliente e pode resolver depois que a rede aquieta.
    page.wait_for_selector('text=/convidou você|não vale mais/', timeout=15000)
    page.screenshot(path=str(SHOTS / '01-convite.png'))

    corpo = page.inner_text('body')
    # O nome de exibição do admin pode mudar; o que importa é a frase.
    linha_convite = next((l for l in corpo.splitlines() if 'convidou' in l), corpo[:60])
    check('convite mostra quem convidou', 'convidou você' in corpo, linha_convite)
    # Não pode revelar o mapa do lugar.
    vazou = [t for t in ('geral', 'bruno', 'canais', 'membros') if t.lower() in corpo.lower()]
    check('convite não revela canais nem nomes', not vazou, f'vazou: {vazou}' if vazou else '')

    # --- convite inválido ------------------------------------------------
    page.goto(f'{BASE}/entrar/CONVITE-QUE-NAO-EXISTE')
    page.wait_for_selector('text=não vale mais', timeout=15000)
    page.screenshot(path=str(SHOTS / '02-convite-invalido.png'))
    corpo = page.inner_text('body')
    check('convite inválido explica e não oferece botão',
          'não vale mais' in corpo and page.locator('button').count() == 0,
          f'{page.locator("button").count()} botões')

    # --- 3. criar conta --------------------------------------------------
    page.goto(f'{BASE}/entrar/{CODIGO}')
    page.wait_for_selector('text=Criar minha conta', timeout=15000)
    page.click('text=Criar minha conta')
    page.wait_for_url('**/criar-conta/**')

    campos = page.locator('input')
    page.fill('input[autocomplete="username"]', USUARIO)
    # O nome de exibição saiu do formulário quando o cadastro aberto entrou: são
    # duas versões do mesmo nome numa tela que precisa de dois campos. O
    # servidor usa o nome de usuário, e quem quiser outro troca no perfil.
    # Ver docs/06-autenticacao.md.

    # medidor de senha: fraca → forte
    page.fill('input[autocomplete="new-password"]', 'senha1234567')
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SHOTS / '03-senha-fraca.png'))
    fraca = page.inner_text('body')

    page.fill('input[autocomplete="new-password"]', SENHA)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SHOTS / '04-senha-forte.png'))
    forte = page.inner_text('body')

    check('medidor classifica senha ruim como fraca/razoável',
          'fraca' in fraca or 'razoável' in fraca, [l for l in fraca.split('\n') if l in ('fraca','razoável','boa','forte')])
    check('medidor classifica frase longa como boa/forte',
          'boa' in forte or 'forte' in forte, [l for l in forte.split('\n') if l in ('fraca','razoável','boa','forte')])

    # o @ é prefixo, não parte do valor
    valor_usuario = page.input_value('input[autocomplete="username"]')
    check('o @ não faz parte do valor do campo', valor_usuario == USUARIO, f'valor={valor_usuario!r}')

    page.click('text=Criar conta')
    page.wait_for_url('**/entrar', timeout=15000)
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(SHOTS / '05-conta-criada.png'))

    corpo = page.inner_text('body')
    check('registro leva para /entrar com aviso, sem logar',
          'Conta criada' in corpo and page.url.endswith('/entrar'), page.url)

    # nada de token guardado
    ls = page.evaluate('JSON.stringify(Object.entries(localStorage))')
    ss = page.evaluate('JSON.stringify(Object.entries(sessionStorage))')
    check('localStorage e sessionStorage vazios após registro', ls == '[]' and ss == '[]', f'ls={ls} ss={ss}')

    # --- 4. convite não serve duas vezes ---------------------------------
    page.goto(f'{BASE}/entrar/{CODIGO}')
    page.wait_for_selector('text=não vale mais', timeout=15000)
    corpo = page.inner_text('body')
    check('convite já usado é recusado na interface', 'não vale mais' in corpo)

    # --- 5. login errado, depois certo -----------------------------------
    page.goto(f'{BASE}/entrar')
    page.wait_for_load_state('networkidle')
    page.fill('input[autocomplete="username"]', USUARIO)
    page.fill('input[autocomplete="current-password"]', 'senha-errada-mesmo')
    page.click('button[type="submit"]')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(SHOTS / '06-senha-errada.png'))
    corpo = page.inner_text('body')
    check('erro não diz qual dos dois errou',
          'Usuário ou senha incorretos' in corpo, [l for l in corpo.split('\n') if 'incorret' in l])

    page.fill('input[autocomplete="current-password"]', SENHA)
    page.click('button[type="submit"]')
    page.wait_for_url(re.compile(r'/(c/[^/]+)?$'), timeout=20000)
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(SHOTS / '07-logado.png'))
    # Desde a fase 4 o shell redireciona para o primeiro canal não lido.
    check('login leva para a área autenticada',
          page.url.startswith(f'{BASE}/c/') or page.url.rstrip('/') == BASE, page.url)

    # --- 6. token nenhum no navegador ------------------------------------
    ls = page.evaluate('JSON.stringify(Object.entries(localStorage))')
    ss = page.evaluate('JSON.stringify(Object.entries(sessionStorage))')
    check('nenhum token em localStorage/sessionStorage', ls == '[]' and ss == '[]', f'ls={ls} ss={ss}')

    cookies = ctx.cookies()
    rt = next((c for c in cookies if c['name'] == 'rt'), None)
    check('cookie rt existe com HttpOnly e SameSite=Strict',
          bool(rt) and rt['httpOnly'] and rt['sameSite'] == 'Strict' and rt['path'] == '/api/auth/refresh',
          json.dumps({k: rt[k] for k in ('httpOnly', 'sameSite', 'path')} if rt else None))

    # o JS da página não enxerga o cookie
    visivel = page.evaluate('document.cookie')
    check('o JavaScript da página não lê o cookie rt', 'rt=' not in visivel, f'document.cookie={visivel!r}')

    # --- 7. recarregar mantém a sessão -----------------------------------
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / '08-apos-reload.png'))
    check('recarregar a página não desloga', not page.url.endswith('/entrar'), page.url)

    # --- 8. renovação silenciosa do access token -------------------------
    # Joga o token fora sem tocar no cookie: a próxima chamada deve renovar
    # sozinha e a pessoa não percebe nada.
    antes = page.url
    page.evaluate("""() => { window.__forcarExpiracao = true; }""")
    resp = page.evaluate("""async () => {
        const r = await fetch('/api/me', { headers: { Authorization: 'Bearer invalido' } });
        return r.status;
    }""")
    renovou = page.evaluate("""async () => {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        return r.status;
    }""")
    check('refresh pelo cookie funciona a partir da página', renovou == 200, f'HTTP {renovou}')

    # --- 9. reuso de token derruba a sessão ------------------------------
    cookies = ctx.cookies()
    rt_atual = next(c['value'] for c in cookies if c['name'] == 'rt')
    # usa uma vez (rotaciona), depois reapresenta o antigo
    r1 = page.evaluate("""async () => (await fetch('/api/auth/refresh', {method:'POST',credentials:'include'})).status""")
    ctx.add_cookies([{'name': 'rt', 'value': rt_atual, 'domain': 'localhost', 'path': '/api/auth/refresh'}])
    r2 = page.evaluate("""async () => {
        const r = await fetch('/api/auth/refresh', {method:'POST',credentials:'include'});
        return [r.status, (await r.json()).code];
    }""")
    check('reapresentar token usado devolve TOKEN_REUSE', r2[1] == 'TOKEN_REUSE', f'{r1} depois {r2}')

    page.goto(f'{BASE}/')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOTS / '09-apos-reuso.png'))
    check('após o reuso, a sessão cai e volta para /entrar', page.url.endswith('/entrar'), page.url)

    # --- 10. acessibilidade básica: foco por teclado ---------------------
    page.goto(f'{BASE}/entrar')
    page.wait_for_load_state('networkidle')
    page.keyboard.press('Tab')
    focado = page.evaluate('document.activeElement.tagName + ":" + (document.activeElement.getAttribute("autocomplete")||"")')
    anel = page.evaluate("""() => {
        const el = document.activeElement;
        return getComputedStyle(el.closest('div') || el).boxShadow !== 'none' ||
               getComputedStyle(el).boxShadow !== 'none';
    }""")
    check('Tab move o foco para um elemento interativo', focado.startswith('INPUT') or focado.startswith('BUTTON'), focado)

    # --- 11. Enter envia o formulário ------------------------------------
    page.fill('input[autocomplete="username"]', USUARIO)
    page.fill('input[autocomplete="current-password"]', SENHA)
    page.keyboard.press('Enter')
    page.wait_for_timeout(5000)
    check('Enter envia o formulário de login', not page.url.endswith('/entrar'), page.url)
    page.screenshot(path=str(SHOTS / '10-enter-envia.png'))

    # --- 12. nenhum pedido a domínio externo -----------------------------
    externos = []
    page2 = ctx.new_page()
    page2.on('request', lambda r: externos.append(r.url) if 'localhost' not in r.url and not r.url.startswith('data:') else None)
    page2.goto(f'{BASE}/entrar')
    page2.wait_for_load_state('networkidle')
    check('nenhuma requisição para domínio externo', not externos, str(externos[:3]))

    # Os 401 são todos provocados por este roteiro: a senha errada, o sondador
    # de renovação e o teste de reuso. Qualquer outro erro é bug de verdade.
    PROVOCADOS = ('/api/auth/login', '/api/auth/refresh', '/api/me')
    inesperadas = [
        (st, u) for st, u in respostas_ruins
        if 'favicon' not in u and not (st == 401 and any(u.endswith(x) for x in PROVOCADOS))
    ]
    check('nenhuma resposta de erro inesperada', not inesperadas, str(inesperadas[:3]))
    favicon = [u for _, u in respostas_ruins if 'favicon' in u]
    check('favicon existe', not favicon, 'index.html não declara favicon (cosmético, fase 3)')

    browser.close()

print('\n' + '=' * 60)
ok = sum(1 for _, o, _ in resultados if o)
print(f'{ok}/{len(resultados)} passaram')
for nome, o, det in resultados:
    if not o:
        print(f'  FALHOU: {nome}  {det}')
sys.exit(0 if ok == len(resultados) else 1)
