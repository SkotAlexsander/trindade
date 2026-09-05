"""A sala: duas pessoas, o mesmo nome, e elas se veem.

Fatia 1 da fase 12 — ver `prompts/fase-12-sala-sem-servidor.md`. Ainda sem
mídia: o que se verifica aqui é o Durable Object segurando presença, que é a
peça que torna a sala possível sem servidor alugado.

Roda contra o `wrangler dev`, que sobe Worker e Durable Object na sua máquina —
não precisa de conta na Cloudflare:

    pnpm --filter @trindade/sala dev
    python e2e/fase-12-sala.py .capturas
"""

import secrets
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:8788'

# Sala nova a cada execução: um objeto que sobrou da anterior mostraria gente
# que não está mais lá, e o roteiro passaria pelo motivo errado.
SALA = f'prova-{secrets.randbelow(10**6):06d}'

resultados = []


def check(nome, ok, detalhe=''):
    resultados.append((nome, ok, detalhe))
    print(f"{'PASSOU ' if ok else 'FALHOU '} {nome}" + (f'  -> {detalhe}' if detalhe else ''),
          flush=True)


def entrar(pagina, nome):
    pagina.goto(BASE, wait_until='networkidle')
    pagina.fill('#sala', SALA)
    pagina.fill('#nome', nome)
    pagina.click('#entrar')
    pagina.wait_for_selector('.pessoa', timeout=15000)


def nomes(pagina):
    return sorted(t.strip() for t in pagina.locator('.pessoa .quem').all_inner_texts())


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    erros = []

    um = b.new_context(viewport={'width': 520, 'height': 720}, color_scheme='dark')
    dois = b.new_context(viewport={'width': 520, 'height': 720}, color_scheme='dark')
    pa, pb = um.new_page(), dois.new_page()
    for pg in (pa, pb):
        pg.on('pageerror', lambda e: erros.append(str(e)))

    # --- 1. a primeira pessoa entra numa sala que não existia ---------------
    entrar(pa, 'Alex')
    check('quem entra numa sala vazia se vê nela', nomes(pa) == ['Alex'], str(nomes(pa)))
    check('e sabe que é ela mesma', pa.locator(".pessoa[data-voce='true']").count() == 1)

    # --- 2. a segunda entra, e as duas se veem ------------------------------
    entrar(pb, 'Rogério')
    pa.wait_for_timeout(1200)

    check('a segunda pessoa vê as duas', nomes(pb) == ['Alex', 'Rogério'], str(nomes(pb)))
    # O Durable Object avisa quem já estava: sem isso, cada um veria só a si.
    check('e a primeira é avisada sozinha', nomes(pa) == ['Alex', 'Rogério'], str(nomes(pa)))
    check('cada uma reconhece a si mesma',
          pa.locator(".pessoa[data-voce='true'] .quem").inner_text() == 'Alex'
          and pb.locator(".pessoa[data-voce='true'] .quem").inner_text() == 'Rogério')
    pa.screenshot(path=str(SHOTS / 'sala-01-duas-pessoas.png'))

    # --- 3. a URL carrega a sala --------------------------------------------
    check('a URL passa a apontar para a sala', pa.url.endswith(f'/sala/{SALA}'), pa.url)

    tres = b.new_context(viewport={'width': 520, 'height': 720}, color_scheme='dark')
    pc = tres.new_page()
    pc.goto(f'{BASE}/sala/{SALA}', wait_until='networkidle')
    check('e abrir essa URL já preenche a sala',
          pc.input_value('#sala') == SALA, pc.input_value('#sala'))

    # --- 4. sair some da lista dos outros ------------------------------------
    dois.close()
    pa.wait_for_timeout(1500)
    check('quem fecha a aba some da lista de quem ficou', nomes(pa) == ['Alex'], str(nomes(pa)))

    # --- 5. a sala vazia não guarda nada -------------------------------------
    um.close()
    pa2 = b.new_context(viewport={'width': 520, 'height': 720}, color_scheme='dark').new_page()
    entrar(pa2, 'Depois')
    check('e a sala esvaziada volta vazia — ela não guarda nada',
          nomes(pa2) == ['Depois'], str(nomes(pa2)))

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
