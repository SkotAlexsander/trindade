import { describe, expect, it } from 'vitest';
import {
  analisarLinha,
  analisarMarkdown,
  hrefSeguro,
  citaVoce,
  mencionados,
  primeiroLink,
  type Bloco,
  type No,
} from '../src/features/messages/markdown';

/** Texto plano do que saiu, para asserções curtas. */
function planificar(nos: readonly No[]): string {
  return nos
    .map((n) => {
      switch (n.tipo) {
        case 'texto':
          return n.valor;
        case 'codigo':
          return `[cod:${n.valor}]`;
        case 'mencao':
          return `[@${n.username}]`;
        case 'canal':
          return `[#${n.slug}]`;
        case 'link':
          return `[link:${n.href}|${planificar(n.filhos)}]`;
        case 'quebra':
          return '\\n';
        default:
          return `[${n.tipo}:${planificar(n.filhos)}]`;
      }
    })
    .join('');
}

describe('hrefSeguro', () => {
  it('recusa os esquemas executáveis', () => {
    // O único vetor de XSS que sobra num renderizador que devolve nós em vez
    // de HTML. Lista de permitidos, não de proibidos.
    expect(hrefSeguro('javascript:alert(1)')).toBeNull();
    expect(hrefSeguro('  JavaScript:alert(1)')).toBeNull();
    expect(hrefSeguro('data:text/html,<script>')).toBeNull();
    expect(hrefSeguro('vbscript:msgbox')).toBeNull();
  });

  it('aceita http, https e mailto', () => {
    expect(hrefSeguro('https://exemplo.com/a')).toBe('https://exemplo.com/a');
    expect(hrefSeguro('http://exemplo.com')).toBe('http://exemplo.com/');
    expect(hrefSeguro('mailto:alguem@exemplo.com')).toBe('mailto:alguem@exemplo.com');
  });

  it('assume https, não http, quando não há esquema', () => {
    expect(hrefSeguro('www.exemplo.com')).toBe('https://www.exemplo.com/');
  });
});

describe('linha', () => {
  it('negrito, itálico e riscado', () => {
    expect(planificar(analisarLinha('**a** *b* ~~c~~'))).toBe(
      '[negrito:a] [italico:b] [riscado:c]',
    );
  });

  it('`**` antes de `*`: negrito não vira dois itálicos vazios', () => {
    const nos = analisarLinha('**forte**');
    expect(nos).toHaveLength(1);
    expect(nos[0]?.tipo).toBe('negrito');
  });

  it('dentro do código nada é interpretado', () => {
    expect(planificar(analisarLinha('`**não** @alex`'))).toBe('[cod:**não** @alex]');
  });

  it('a barra invertida escapa o marcador', () => {
    expect(planificar(analisarLinha('2 \\* 3 \\* 4'))).toBe('2 * 3 * 4');
  });

  it('spoiler', () => {
    expect(planificar(analisarLinha('||segredo||'))).toBe('[spoiler:segredo]');
  });

  it('marcador sem fechamento fica literal', () => {
    expect(planificar(analisarLinha('3 * 4 = 12'))).toBe('3 * 4 = 12');
  });

  it('menção e canal só no começo de palavra', () => {
    expect(planificar(analisarLinha('oi @alex, veja #produto'))).toBe(
      'oi [@alex], veja [#produto]',
    );
    // Um e-mail escrito à mão não pode virar menção.
    expect(planificar(analisarLinha('alguem@exemplo.com'))).toContain('alguem@exemplo.com');
  });

  it('URL solta vira link', () => {
    expect(planificar(analisarLinha('veja https://exemplo.com/x aqui'))).toBe(
      'veja [link:https://exemplo.com/x|https://exemplo.com/x] aqui',
    );
  });

  it('link em colchetes com destino perigoso vira texto, não link', () => {
    const saida = planificar(analisarLinha('[clique](javascript:alert(1))'));
    expect(saida).not.toContain('link:');
    expect(saida).toContain('clique');
  });

  it('junta texto adjacente num nó só', () => {
    const nos = analisarLinha('abcdef');
    expect(nos).toHaveLength(1);
  });
});

describe('blocos', () => {
  function tipos(blocos: readonly Bloco[]): string[] {
    return blocos.map((b) => b.tipo);
  }

  it('bloco de código guarda a linguagem e o conteúdo literal', () => {
    const blocos = analisarMarkdown('```ts\nconst a = **1**;\n\nconst b = 2;\n```');
    expect(blocos).toHaveLength(1);
    const bloco = blocos[0];
    if (bloco?.tipo !== 'bloco-de-codigo') throw new Error('esperava bloco de código');
    expect(bloco.lingua).toBe('ts');
    // Linha em branco e asteriscos preservados: dentro da cerca é literal.
    expect(bloco.valor).toBe('const a = **1**;\n\nconst b = 2;');
  });

  it('cerca sem fechamento vai até o fim', () => {
    const blocos = analisarMarkdown('```\nsem fim');
    const bloco = blocos[0];
    if (bloco?.tipo !== 'bloco-de-codigo') throw new Error('esperava bloco de código');
    expect(bloco.valor).toBe('sem fim');
  });

  it('citação junta linhas seguidas', () => {
    const blocos = analisarMarkdown('> uma\n> outra\ndepois');
    expect(tipos(blocos)).toEqual(['citacao', 'paragrafo']);
  });

  it('lista com bolinha e lista numerada são duas listas', () => {
    const blocos = analisarMarkdown('- a\n- b\n1. c');
    expect(tipos(blocos)).toEqual(['lista', 'lista']);
    const primeira = blocos[0];
    const segunda = blocos[1];
    if (primeira?.tipo !== 'lista' || segunda?.tipo !== 'lista') throw new Error('esperava listas');
    expect(primeira.ordenada).toBe(false);
    expect(primeira.itens).toHaveLength(2);
    expect(segunda.ordenada).toBe(true);
  });

  it('quebra simples vira quebra, não junção de linhas', () => {
    // Dar Enter numa mensagem de chat é uma quebra. O markdown de documento
    // juntaria as duas linhas num parágrafo só, e aqui isso estaria errado.
    const blocos = analisarMarkdown('linha um\nlinha dois');
    expect(blocos).toHaveLength(1);
    const p = blocos[0];
    if (p?.tipo !== 'paragrafo') throw new Error('esperava parágrafo');
    expect(planificar(p.filhos)).toBe('linha um\\nlinha dois');
  });

  it('título e tabela não são markdown aqui', () => {
    // `# Título` quase sempre é acidente de quem quis escrever uma hashtag.
    // Com espaço depois do `#` não é nem título nem canal: é o texto que a
    // pessoa escreveu.
    const blocos = analisarMarkdown('# geral é o canal');
    expect(tipos(blocos)).toEqual(['paragrafo']);
    const p = blocos[0];
    if (p?.tipo !== 'paragrafo') throw new Error('esperava parágrafo');
    expect(planificar(p.filhos)).toBe('# geral é o canal');

    // Sem o espaço, é referência a canal — que é o que quem digita `#` quer.
    const comCanal = analisarMarkdown('#geral é o canal');
    const q = comCanal[0];
    if (q?.tipo !== 'paragrafo') throw new Error('esperava parágrafo');
    expect(planificar(q.filhos)).toBe('[#geral] é o canal');

    expect(tipos(analisarMarkdown('| a | b |\n|---|---|'))).toEqual(['paragrafo']);
  });

  it('imagem por URL não vira imagem', () => {
    const blocos = analisarMarkdown('![alt](https://exemplo.com/a.png)');
    const p = blocos[0];
    if (p?.tipo !== 'paragrafo') throw new Error('esperava parágrafo');
    expect(planificar(p.filhos)).toContain('!');
    expect(planificar(p.filhos)).toContain('link:https://exemplo.com/a.png');
  });

  it('texto vazio não produz bloco', () => {
    expect(analisarMarkdown('')).toEqual([]);
    expect(analisarMarkdown('\n\n  \n')).toEqual([]);
  });
});

describe('mencionados', () => {
  it('encontra a menção no texto', () => {
    expect([...mencionados(analisarMarkdown('oi @alex e @bruno'))]).toEqual(['alex', 'bruno']);
  });

  it('não conta menção dentro de código', () => {
    // A linha inteira muda de cor quando você é citado. Um falso positivo por
    // causa de um trecho de código é visível e irritante.
    expect(mencionados(analisarMarkdown('`@alex`')).size).toBe(0);
    expect(mencionados(analisarMarkdown('```\n@alex\n```')).size).toBe(0);
  });

  it('não conta e-mail como menção', () => {
    expect(mencionados(analisarMarkdown('escreva para alex@exemplo.com')).size).toBe(0);
  });

  it('encontra dentro de negrito e de item de lista', () => {
    expect([...mencionados(analisarMarkdown('**@alex**'))]).toEqual(['alex']);
    expect([...mencionados(analisarMarkdown('- pergunte a @carla'))]).toEqual(['carla']);
  });
});

describe('citaVoce', () => {
  const cita = (texto: string, quem = 'alex', autor = false) =>
    citaVoce(analisarMarkdown(texto), quem, autor);

  it('o seu nome cita você', () => {
    expect(cita('oi @alex')).toBe(true);
    expect(cita('oi @bruno')).toBe(false);
  });

  it('`@todos` cita todo mundo — menos quem escreveu', () => {
    // Esta é a regra do servidor, em `db/messages.ts`. Ela morava em dois
    // lugares no cliente e só um deles a conhecia: o contador subia e a
    // mensagem não ficava marcada quando você chegava nela.
    expect(cita('@todos reunião agora')).toBe(true);
    expect(cita('@todos reunião agora', 'alex', true)).toBe(false);
  });

  it('`@todos` dentro de código não cita ninguém', () => {
    expect(cita('`@todos`')).toBe(false);
  });

  it('sem nome de usuário, só `@todos` cita', () => {
    // Sem o `cita` daqui: passar `undefined` para um parâmetro com valor
    // padrão devolve o padrão, e o teste testaria 'alex' de novo.
    expect(citaVoce(analisarMarkdown('oi @alex'), undefined)).toBe(false);
    expect(citaVoce(analisarMarkdown('@todos'), undefined)).toBe(true);
  });
});

describe('primeiroLink', () => {
  const link = (fonte: string) => primeiroLink(analisarMarkdown(fonte));

  it('acha o link no meio do texto', () => {
    expect(link('olha isto https://exemplo.com/a e me diz')).toBe('https://exemplo.com/a');
  });

  it('devolve só o primeiro', () => {
    // Cinco links não podem virar cinco cartões de 380px.
    expect(link('https://um.com e https://dois.com')).toBe('https://um.com/');
  });

  it('ignora o que está dentro de crase', () => {
    // URL em bloco de código é exemplo, não link — e o servidor não deve ir
    // buscá-la.
    expect(link('use `https://exemplo.com/api` na chamada')).toBeNull();
    expect(link('```\nhttps://exemplo.com\n```')).toBeNull();
  });

  it('ignora mailto e qualquer esquema que não seja web', () => {
    expect(link('escreva para <mailto:alguem@exemplo.com>')).toBeNull();
  });

  it('devolve null quando não há link', () => {
    expect(link('só texto, nada de link')).toBeNull();
  });

  it('acha dentro de negrito e de citação', () => {
    expect(link('**https://exemplo.com/**')).toBe('https://exemplo.com/');
    expect(link('> https://exemplo.com/')).toBe('https://exemplo.com/');
  });
});
