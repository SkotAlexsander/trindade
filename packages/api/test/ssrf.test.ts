import { describe, expect, it } from 'vitest';
import { enderecoPublico } from '../src/lib/rede-publica.js';
import { RecusadoNaBusca, validarUrl } from '../src/lib/busca-externa.js';
import { lerMeta } from '../src/services/link-preview.js';

/**
 * A guarda de SSRF.
 *
 * O servidor busca a prévia no lugar de quem lê — é o que impede o link
 * enviado de colher o IP dos leitores. Em troca, ele passa a buscar URLs
 * escolhidas por outra pessoa, e é isto que impede que ele seja mandado bater
 * na porta da própria rede. Ver docs/04-seguranca.md.
 */

describe('enderecoPublico', () => {
  it('deixa passar endereço de verdade', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(enderecoPublico(ip), ip).toBe(true);
    }
  });

  it('barra a rede de casa e o laço local', () => {
    for (const ip of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '192.168.1.10',
      '172.16.0.1',
      '172.31.255.254',
      '0.0.0.0',
    ]) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
  });

  it('barra 169.254.169.254, que é o alvo clássico', () => {
    // O endereço de metadado da nuvem: credencial de máquina servida em texto
    // puro para quem conseguir fazer o servidor pedir.
    expect(enderecoPublico('169.254.169.254')).toBe(false);
  });

  it('barra CGNAT, benchmark, documentação e multicast', () => {
    for (const ip of ['100.64.0.1', '198.18.0.1', '203.0.113.9', '224.0.0.1', '255.255.255.255']) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
  });

  it('enxerga o IPv4 escondido dentro de um IPv6', () => {
    // `::ffff:127.0.0.1` é 127.0.0.1 escrito de outro jeito. Uma guarda que
    // só olhasse o texto deixaria passar.
    expect(enderecoPublico('::ffff:127.0.0.1')).toBe(false);
    expect(enderecoPublico('::ffff:169.254.169.254')).toBe(false);
    expect(enderecoPublico('::ffff:10.0.0.1')).toBe(false);
    expect(enderecoPublico('::ffff:8.8.8.8')).toBe(true);
    // 6to4 e NAT64 carregam o mesmo v4 por outros dois caminhos.
    expect(enderecoPublico('2002:7f00:0001::')).toBe(false);
    expect(enderecoPublico('64:ff9b::a00:1')).toBe(false);
  });

  it('barra ::1, link-local, único local e multicast v6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
  });

  it('diz não para o que não entende', () => {
    for (const texto of ['', 'localhost', 'não é ip', '999.1.1.1', '10.0.0']) {
      expect(enderecoPublico(texto), texto).toBe(false);
    }
  });
});

describe('validarUrl', () => {
  it('aceita http e https na porta da web', () => {
    expect(validarUrl('https://exemplo.com/a?b=1').host).toBe('exemplo.com');
    expect(validarUrl('http://exemplo.com:80/').protocol).toBe('http:');
  });

  it('recusa esquema que não é web', () => {
    for (const url of ['file:///etc/passwd', 'gopher://a/', 'ftp://a/', 'data:text/html,x']) {
      expect(() => validarUrl(url), url).toThrow(RecusadoNaBusca);
    }
  });

  it('recusa porta de serviço interno', () => {
    // `:5432` e `:9000` não são engano de ninguém — são o Postgres e o MinIO.
    for (const url of ['http://a.com:5432/', 'http://a.com:9000/', 'http://a.com:6379/']) {
      expect(() => validarUrl(url), url).toThrow(RecusadoNaBusca);
    }
  });

  it('recusa credencial embutida na URL', () => {
    // `http://usuario@interno/` engana quem lê o link e alguns clientes HTTP.
    expect(() => validarUrl('http://alguem:senha@exemplo.com/')).toThrow(RecusadoNaBusca);
  });
});

describe('lerMeta', () => {
  const html = (corpo: string): Buffer => Buffer.from(corpo, 'utf8');

  it('lê og:title, og:description e og:image', () => {
    const meta = lerMeta(
      html(`<html><head>
        <meta property="og:title" content="Um título">
        <meta property="og:description" content="Uma descrição">
        <meta property="og:image" content="https://cdn.exemplo.com/a.png">
      </head></html>`),
    );
    expect(meta['og:title']).toBe('Um título');
    expect(meta['og:description']).toBe('Uma descrição');
    expect(meta['og:image']).toBe('https://cdn.exemplo.com/a.png');
  });

  it('cai no <title> quando não há Open Graph', () => {
    expect(lerMeta(html('<html><head><title>Só o título</title></head>'))['<title>']).toBe(
      'Só o título',
    );
  });

  it('desfaz entidade HTML', () => {
    const meta = lerMeta(html('<meta name="description" content="p&atilde;o &amp; caf&eacute;">'));
    // `&amp;` é das poucas que traduzimos; o resto fica como está, e isso é
    // melhor do que traduzir metade errado.
    expect(meta['description']).toContain('&');
  });

  it('o primeiro og:image vence', () => {
    const meta = lerMeta(
      html(`<meta property="og:image" content="https://a/1.png">
            <meta property="og:image" content="https://a/2.png">`),
    );
    expect(meta['og:image']).toBe('https://a/1.png');
  });

  it('aceita aspas simples e atributos fora de ordem', () => {
    const meta = lerMeta(html(`<meta content='Valor' property='og:site_name' />`));
    expect(meta['og:site_name']).toBe('Valor');
  });

  it('não devolve marcação, só texto', () => {
    // Nada daqui vira nó: o cartão desenha texto. É a mesma razão pela qual o
    // markdown do projeto dispensa DOMPurify.
    const meta = lerMeta(html(`<meta property="og:title" content="<img onerror=x>">`));
    expect(meta['og:title']).toBe('<img onerror=x>');
  });
});
