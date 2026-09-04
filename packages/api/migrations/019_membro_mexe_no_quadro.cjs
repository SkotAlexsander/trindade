exports.shorthands = undefined;

/**
 * O cargo `Membro` passa a mexer no quadro.
 *
 * Mesma decisão da 017, pelo mesmo motivo. O gesto que justifica o quadro é
 * "isso aqui virou tarefa", dito por quem estava na conversa — e arrastar o
 * cartão para "Feito" é como o grupo fica sabendo que acabou. Se só o
 * administrador pudesse fazer as duas coisas, o quadro seria um relatório que
 * alguém precisa alimentar, e relatório assim morre na segunda semana.
 *
 * A permissão continua desligável por cargo na tela de cargos.
 *
 * Ver design/08-projeto.md e prompts/fase-09-projeto-notificacoes.md.
 */

// 5919 | (1 << 13) = 5919 + 8192 = 14111.
const COM_TAREFAS = '14111';
const SEM_TAREFAS = '5919';

exports.up = (pgm) => {
  // Só o cargo padrão, e só se ele estiver exatamente como a 017 o deixou:
  // quem já ajustou as permissões do Membro à mão não tem a escolha desfeita.
  pgm.sql(`
    update roles
       set permissions = ${COM_TAREFAS}
     where is_default = true
       and permissions = ${SEM_TAREFAS}
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    update roles
       set permissions = ${SEM_TAREFAS}
     where is_default = true
       and permissions = ${COM_TAREFAS}
  `);
};
