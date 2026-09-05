import { DurableObject } from 'cloudflare:workers';

/**
 * Uma sala.
 *
 * Um Durable Object por sala, e ele é a única coisa que sabe quem está dentro.
 * Enquanto houver gente, ele existe; quando o último sai, hiberna — e objeto
 * hibernado não roda e não custa. É o que faz "quando desligarmos, tudo para"
 * ser verdade sem ninguém precisar desligar nada.
 *
 * **Nada aqui é gravado em disco.** A presença e o chat vivem na memória do
 * objeto e morrem com a sala. Quem quiser guardar a conversa baixa o arquivo no
 * próprio computador — foi o pedido, e é a diferença entre um produto que
 * lembra por você e um que lembra se você mandar.
 * Ver design/15-sem-servidor-alugado.md.
 */

/** Quem está na sala, do ponto de vista de quem olha. */
export interface Participante {
  id: string;
  nome: string;
  /** A sessão do SFU. `null` enquanto a pessoa ainda não publicou mídia. */
  sessao: string | null;
  /** As trilhas publicadas, para os outros saberem o que assinar. */
  trilhas: Trilha[];
  /** Presença ao vivo: quem está com o microfone aberto agora. */
  falando: boolean;
}

export interface Trilha {
  /** `camera`, `microfone` ou `tela`. */
  tipo: 'camera' | 'microfone' | 'tela';
  /** O nome da trilha no SFU, que é o que o outro lado usa para assinar. */
  nome: string;
}

/** O que chega do navegador. */
type Entrada =
  | { tipo: 'entrar'; nome: string }
  | { tipo: 'publiquei'; sessao: string; trilhas: Trilha[] }
  | { tipo: 'falando'; falando: boolean }
  | { tipo: 'mensagem'; texto: string }
  | { tipo: 'ping' };

/** O que sai para o navegador. */
type Saida =
  | { tipo: 'voce'; id: string }
  | { tipo: 'sala'; participantes: Participante[] }
  | { tipo: 'mensagem'; de: string; nome: string; texto: string; quando: number }
  | { tipo: 'erro'; motivo: string };

/** O que fica preso a cada WebSocket, e sobrevive à hibernação. */
interface Cracha {
  id: string;
  nome: string;
}

const NOME_MAXIMO = 32;
const TEXTO_MAXIMO = 2000;

export class Sala extends DurableObject {
  /**
   * O estado vive nos próprios WebSockets.
   *
   * `serializeAttachment` guarda um crachá em cada conexão, e a hibernação o
   * devolve intacto quando o objeto acorda. Guardar isto num `Map` de instância
   * pareceria mais simples e seria errado: o objeto hiberna entre uma mensagem
   * e outra, e o `Map` voltaria vazio com as pessoas ainda conectadas.
   */
  private cracha(ws: WebSocket): Cracha | null {
    const guardado = ws.deserializeAttachment() as Cracha | null;
    return guardado ?? null;
  }

  /**
   * A sala inteira, montada a partir de quem está conectado.
   *
   * `saindo` existe por um detalhe que custou um teste: dentro de
   * `webSocketClose`, o socket que está fechando **ainda aparece** em
   * `getWebSockets()`. Sem excluí-lo aqui, quem fecha a aba continua na lista
   * de todo mundo até a próxima mudança da sala — e se ninguém mais entrar ou
   * sair, continua para sempre.
   */
  private participantes(saindo?: WebSocket): Participante[] {
    const lista: Participante[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === saindo) continue;
      const cracha = this.cracha(ws);
      if (!cracha) continue;
      const midia = this.midia.get(cracha.id);
      lista.push({
        id: cracha.id,
        nome: cracha.nome,
        sessao: midia?.sessao ?? null,
        trilhas: midia?.trilhas ?? [],
        falando: this.falando.has(cracha.id),
      });
    }
    return lista;
  }

  /**
   * O que é da chamada, e não da conexão.
   *
   * Isto pode viver em memória: se o objeto hibernar e perder, a pessoa
   * republica na volta. Perder presença seria grave; perder o id de uma trilha
   * custa uma renegociação.
   */
  private midia = new Map<string, { sessao: string; trilhas: Trilha[] }>();
  private falando = new Set<string>();

  private avisar(mensagem: Saida, exceto?: WebSocket): void {
    const texto = JSON.stringify(mensagem);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceto) continue;
      try {
        ws.send(texto);
      } catch {
        // Conexão morrendo. O `webSocketClose` limpa; aqui não há o que fazer.
      }
    }
  }

  private anunciarSala(): void {
    this.avisar({ tipo: 'sala', participantes: this.participantes() });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('esta rota é só para WebSocket', { status: 426 });
    }

    const par = new WebSocketPair();
    const [cliente, servidor] = [par[0], par[1]];

    // `acceptWebSocket`, e não `accept()`: é o que permite ao objeto hibernar
    // com as conexões abertas. Com `accept()` ele ficaria acordado — e cobrado
    // — enquanto alguém estivesse na sala, mesmo em silêncio.
    this.ctx.acceptWebSocket(servidor);

    return new Response(null, { status: 101, webSocket: cliente });
  }

  override async webSocketMessage(ws: WebSocket, bruto: string | ArrayBuffer): Promise<void> {
    if (typeof bruto !== 'string') return;

    let entrada: Entrada;
    try {
      entrada = JSON.parse(bruto) as Entrada;
    } catch {
      return;
    }

    const cracha = this.cracha(ws);

    // Antes de dizer o nome, a única coisa aceita é dizer o nome.
    if (!cracha) {
      if (entrada.tipo !== 'entrar') return;
      const nome = entrada.nome.trim().slice(0, NOME_MAXIMO);
      if (!nome) {
        ws.send(JSON.stringify({ tipo: 'erro', motivo: 'sem nome' } satisfies Saida));
        return;
      }

      const novo: Cracha = { id: crypto.randomUUID(), nome };
      ws.serializeAttachment(novo);
      ws.send(JSON.stringify({ tipo: 'voce', id: novo.id } satisfies Saida));
      this.anunciarSala();
      return;
    }

    switch (entrada.tipo) {
      case 'publiquei':
        this.midia.set(cracha.id, { sessao: entrada.sessao, trilhas: entrada.trilhas });
        this.anunciarSala();
        return;

      case 'falando':
        if (entrada.falando) this.falando.add(cracha.id);
        else this.falando.delete(cracha.id);
        this.anunciarSala();
        return;

      case 'mensagem': {
        const texto = entrada.texto.slice(0, TEXTO_MAXIMO);
        if (!texto.trim()) return;
        // O chat não é guardado: ele passa por aqui e vai embora. Quem quiser
        // ficar com ele baixa o arquivo no próprio computador.
        this.avisar({
          tipo: 'mensagem',
          de: cracha.id,
          nome: cracha.nome,
          texto,
          quando: Date.now(),
        });
        return;
      }

      case 'ping':
        return;

      default:
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const cracha = this.cracha(ws);
    if (cracha) {
      this.midia.delete(cracha.id);
      this.falando.delete(cracha.id);
    }
    this.avisar({ tipo: 'sala', participantes: this.participantes(ws) }, ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
