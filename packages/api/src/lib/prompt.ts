import { stdin, stdout } from 'node:process';

/**
 * Leitor de linha de terminal com eco opcional.
 *
 * Não usa `readline`: misturar `rl.question` com um listener bruto no mesmo
 * `stdin` — necessário para ler senha sem eco — faz os dois brigarem pelo
 * stream e quebra quando a entrada vem de um pipe em vez de um terminal.
 * Aqui é um leitor só, que serve os dois casos.
 */
export interface Prompter {
  ask(prompt: string): Promise<string>;
  askHidden(prompt: string): Promise<string>;
  close(): void;
}

export function createPrompter(): Prompter {
  const lines: string[] = [];
  let buffer = '';
  let echo = true;
  let waiter: ((line: string) => void) | null = null;
  let failer: ((err: Error) => void) | null = null;
  let closed = false;

  const isTty = stdin.isTTY === true;
  const wasRaw = stdin.isRaw ?? false;

  if (isTty) stdin.setRawMode(true);
  stdin.setEncoding('utf8');

  function flush(): void {
    if (waiter && lines.length > 0) {
      const line = lines.shift();
      const resolve = waiter;
      waiter = null;
      failer = null;
      resolve(line ?? '');
    }
  }

  function onData(chunk: string): void {
    for (const char of chunk) {
      if (char === '\u0003') {
        close();
        stdout.write('\n');
        process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        if (isTty) stdout.write('\n');
        lines.push(buffer);
        buffer = '';
        flush();
        continue;
      }
      if (char === '\u007f' || char === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          if (isTty && echo) stdout.write('\b \b');
        }
        continue;
      }
      if (char < ' ') continue;
      buffer += char;
      if (isTty && echo) stdout.write(char);
    }
  }

  function onEnd(): void {
    // Pipe fechou. O que sobrou sem quebra de linha ainda vale como linha.
    if (buffer.length > 0) {
      lines.push(buffer);
      buffer = '';
      flush();
    }
    if (waiter) {
      const reject = failer;
      waiter = null;
      failer = null;
      reject?.(new Error('a entrada terminou antes da resposta'));
    }
  }

  stdin.on('data', onData);
  stdin.on('end', onEnd);

  function close(): void {
    if (closed) return;
    closed = true;
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    if (isTty) stdin.setRawMode(wasRaw);
    stdin.pause();
  }

  function read(prompt: string, withEcho: boolean): Promise<string> {
    stdout.write(prompt);
    echo = withEcho;
    return new Promise<string>((resolve, reject) => {
      waiter = resolve;
      failer = reject;
      flush();
    });
  }

  return {
    ask: (prompt) => read(prompt, true),
    askHidden: (prompt) => read(prompt, false),
    close,
  };
}
