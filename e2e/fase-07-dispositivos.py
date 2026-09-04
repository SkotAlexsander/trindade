"""A camada de dispositivo num navegador de verdade.

O teste unitário cobre a cascata, o gate e o piso de ruído. O que ele não pode
cobrir é o grafo de áudio: se o medidor mede depois do ganho, se trocar de
microfone mantém a trilha publicada, se fechar a cadeia apaga a luz do aparelho.
Isso só o Chrome responde.

O Chrome sobe com dispositivo falso (`--use-fake-device-for-media-stream`), que
gera um bipe periódico — sinal de verdade passando pelo grafo de verdade.

    pnpm dev
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


# Roda dentro da página: importa o módulo pelo servidor do Vite e exercita a
# cadeia. Devolve tudo de uma vez para não pagar ida e volta a cada asserção.
ANTES_DA_PERMISSAO = """
async () => {
  const midia = await import('/src/lib/midia.ts');
  const lista = await midia.listarDispositivos();
  return { microfones: lista.microfones.length, comRotulos: lista.comRotulos };
}
"""

ROTEIRO = """
async () => {
  const midia = await import('/src/lib/midia.ts');
  const prefs = await import('/src/lib/preferencias.ts');
  const relatorio = {};

  const depois = await midia.sondarPermissao('microfone');
  relatorio.depoisDaPermissao = { microfones: depois.microfones.length, comRotulos: depois.comRotulos };

  // A trilha de sondagem tem que estar fechada: nada capturando agora.
  relatorio.sondagemFechada = document.querySelectorAll('audio,video').length === 0;

  const cadeia = await midia.CadeiaDeEntrada.abrir({
    perfil: 'isolamento',
    personalizado: prefs.PADRAO.personalizado,
    volumeEntrada: 100,
    modo: { tipo: 'automatico' },
  });

  const trilhaInicial = cadeia.trilha.id;
  relatorio.trilhaViva = cadeia.trilha.readyState === 'live';
  relatorio.trilhaEhDeSaida = cadeia.trilha.kind === 'audio';

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /* O sinal do dispositivo falso é um bipe curto e periódico, e a cadeia mede
     em janelas de 1024 amostras (~21ms). Uma janela que pega meio bipe dá um
     RMS menor, então o que vale é o pico de várias — e a leitura tem que ser
     mais densa que o tique interno de 33ms, senão dois terços das medições
     passam batido e o pico vira sorteio. */
  async function pico(qual, ms) {
    let maior = -100;
    let abriu = false;
    for (let i = 0; i < ms / 20; i++) {
      await esperar(20);
      const m = qual.medir();
      maior = Math.max(maior, m.dbfs);
      if (m.aberto) abriu = true;
    }
    return { maior, abriu };
  }

  const primeiro = await pico(cadeia, 3000);
  relatorio.maiorNivel = primeiro.maior;
  relatorio.abriu = primeiro.abriu;

  /* O medidor mede **depois** do ganho: dobrar o volume aparece nele.
     A medição usa o perfil estúdio, com os quatro processamentos desligados —
     com `autoGainControl` ligado quem mexe no nível é o navegador, e o teste
     estaria medindo a reação dele em vez do nosso GainNode. */
  const medida = await midia.CadeiaDeEntrada.abrir({
    perfil: 'estudio',
    personalizado: prefs.PADRAO.personalizado,
    volumeEntrada: 100,
    modo: { tipo: 'aberto' },
  });
  const semGanho = await pico(medida, 3000);
  medida.definirVolume(200);
  await esperar(300);
  const comGanho = await pico(medida, 3000);
  await medida.fechar();
  relatorio.semGanho = semGanho.maior;
  relatorio.comGanho = comGanho.maior;

  // Trocar de microfone não pode trocar a trilha publicada.
  const outros = (await midia.listarDispositivos()).microfones;
  const alvo = outros.find((d) => d.deviceId !== cadeia.deviceIdEmUso) || outros[0];
  await cadeia.trocarDispositivo(alvo.deviceId);
  relatorio.trilhaDepoisDaTroca = cadeia.trilha.id === trilhaInicial;
  relatorio.trilhaAindaViva = cadeia.trilha.readyState === 'live';

  // Apertar para falar: quem manda é a tecla, não o nível.
  cadeia.definirModo({ tipo: 'manual', falando: false });
  await esperar(400);
  relatorio.manualFechado = cadeia.medir().aberto === false;
  cadeia.definirModo({ tipo: 'manual', falando: true });
  await esperar(200);
  relatorio.manualAberto = cadeia.medir().aberto === true;

  await cadeia.fechar();
  relatorio.fechouTrilha = cadeia.stream.getTracks().every((t) => t.readyState === 'ended');

  relatorio.podeEscolherSaida = midia.podeEscolherSaida();
  relatorio.temIsolamento = midia.suportaIsolamentoDeVoz();
  return relatorio;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(
        channel='chrome',
        headless=True,
        args=[
            # Dispositivo falso, mas **não** a interface falsa: com
            # `--use-fake-ui-for-media-stream` o Chrome se comporta como já
            # autorizado desde o começo, e o estado "ainda sem rótulo" — que é
            # metade do que esta camada trata — deixaria de existir no teste.
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
        ],
    )
    ctx = b.new_context(viewport={'width': 1200, 'height': 800}, permissions=[])
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}/entrar', wait_until='networkidle')

    antes = pg.evaluate(ANTES_DA_PERMISSAO)
    check('a lista antes da permissão vem sem rótulo',
          antes['comRotulos'] is False, str(antes))

    ctx.grant_permissions(['microphone', 'camera'])
    r = pg.evaluate(ROTEIRO)
    print(r, flush=True)
    check('e a sondagem revela os rótulos',
          r['depoisDaPermissao']['comRotulos'] is True
          and r['depoisDaPermissao']['microfones'] >= 1,
          str(r['depoisDaPermissao']))
    check('a trilha de sondagem não fica aberta', r['sondagemFechada'])

    check('a cadeia publica uma trilha de áudio viva',
          r['trilhaViva'] and r['trilhaEhDeSaida'])
    check('o medidor vê o sinal que entra', r['maiorNivel'] > -60, f"{r['maiorNivel']:.1f} dBFS")
    check('e o portão abre quando há voz', r['abriu'])

    # A razão de o analisador vir depois do GainNode: o medidor mostra o que os
    # outros ouvem, não o que o microfone captou. Dobrar o ganho é +6 dB.
    ganho = r['comGanho'] - r['semGanho']
    check('o medidor mede depois do ganho',
          4 <= ganho <= 8,
          f"{r['semGanho']:.1f} -> {r['comGanho']:.1f} dBFS ({ganho:+.1f} dB)")

    # A verificação que importa da fatia: trocar de microfone no meio da chamada
    # não republica nada, então a chamada não cai.
    check('trocar de microfone mantém a mesma trilha publicada',
          r['trilhaDepoisDaTroca'] and r['trilhaAindaViva'])

    check('apertar para falar fecha e abre pelo comando',
          r['manualFechado'] and r['manualAberto'])
    check('fechar a cadeia encerra a captura', r['fechouTrilha'])

    print(f"  (setSinkId: {r['podeEscolherSaida']}, voiceIsolation: {r['temIsolamento']})",
          flush=True)

    # Sem `setSinkId` a lista de saída aparece desabilitada com o motivo, nunca
    # escondida — no Chrome ela existe, então aqui só registramos o estado.
    check('a capacidade de escolher saída é detectada, não deduzida da versão',
          isinstance(r['podeEscolherSaida'], bool))

    check('nenhum erro de página', not erros, '; '.join(erros[:2]))

    pg.screenshot(path=str(SHOTS / '80-dispositivos.png'))
    ctx.close()
    b.close()

print()
passou = sum(1 for _, ok, _ in resultados if ok)
print(f'{passou}/{len(resultados)} verificações passaram')
sys.exit(0 if passou == len(resultados) else 1)
