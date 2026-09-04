exports.shorthands = undefined;

/**
 * O cargo `Membro` passa a poder editar as notas.
 *
 * A migration 003 deu ao Membro os bits 0–4 e 8–10 (1823) e deixou
 * `MANAGE_NOTES` (bit 12) de fora — a fase 9 não existia, e a permissão parecia
 * de administração.
 *
 * Rodando, ela não é: a nota é o "estado atual" do assunto do canal, e o gesto
 * central do documento é a decisão tomada na conversa virar registro em um
 * clique. Numa equipe de cinco, quem participa da decisão é quem a registra.
 * Uma nota que só o administrador edita seria um mural, e mural ninguém mantém.
 *
 * A permissão continua existindo, e continua desligável por cargo: quem quiser
 * uma nota em leitura para alguém tira o bit na tela de cargos.
 *
 * Ver design/08-projeto.md e prompts/fase-09-projeto-notificacoes.md.
 */

// 1823 | (1 << 12) = 1823 + 4096 = 5919.
const COM_NOTAS = '5919';
const SEM_NOTAS = '1823';

exports.up = (pgm) => {
  // Só o cargo padrão, e só se ninguém tiver mexido nele: um administrador que
  // já ajustou as permissões do Membro à mão não pode ter a escolha desfeita
  // por uma migration.
  pgm.sql(`
    update roles
       set permissions = ${COM_NOTAS}
     where is_default = true
       and permissions = ${SEM_NOTAS}
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    update roles
       set permissions = ${SEM_NOTAS}
     where is_default = true
       and permissions = ${COM_NOTAS}
  `);
};
