import { useState } from 'react';
import { OPCOES_MAX, OPCOES_MIN } from '@trindade/shared';
import { Button, IconButton, Input, Toggle, useToast } from '../../components';
import { Plus, X } from '../../components/icones';
import { useCriarEnquete } from './queries';
import styles from './enquetes.module.css';

/**
 * O formulário que `/enquete` abre, acima do compositor.
 *
 * Inline e não em diálogo: a enquete nasce da conversa, e um modal por cima da
 * conversa esconde justamente o que se está perguntando. Ver design/08-projeto.md.
 */
export function FormularioDeEnquete({
  channelId,
  perguntaInicial,
  onFechar,
}: {
  channelId: string;
  perguntaInicial: string;
  onFechar: () => void;
}) {
  const { show } = useToast();
  const criar = useCriarEnquete(channelId);

  const [pergunta, setPergunta] = useState(perguntaInicial);
  const [opcoes, setOpcoes] = useState<string[]>(['', '']);
  const [multipla, setMultipla] = useState(false);
  const [anonima, setAnonima] = useState(false);
  const [prazo, setPrazo] = useState('');

  const preenchidas = opcoes.map((o) => o.trim()).filter(Boolean);
  const pronta = pergunta.trim().length > 0 && preenchidas.length >= OPCOES_MIN;

  function enviar(e: React.FormEvent): void {
    e.preventDefault();
    if (!pronta || criar.isPending) return;

    criar.mutate(
      {
        question: pergunta.trim(),
        options: preenchidas,
        multiple: multipla,
        anonymous: anonima,
        // O prazo é uma data; a enquete fecha no fim daquele dia, no fuso de
        // quem criou. Pedir hora seria precisão que ninguém usa aqui.
        closesAt: prazo ? new Date(`${prazo}T23:59:59`).toISOString() : null,
        clientNonce: crypto.randomUUID(),
      },
      {
        onSuccess: onFechar,
        onError: () => show('Não foi possível criar a enquete.', 'danger'),
      },
    );
  }

  return (
    <form className={styles.formulario} onSubmit={enviar} aria-label="Nova enquete">
      <div className={styles.cabecalhoDoForm}>
        <span className="section-label">Nova enquete</span>
        <IconButton label="Descartar enquete" size="sm" onClick={onFechar}>
          <X size={16} />
        </IconButton>
      </div>

      <Input
        label="Pergunta"
        autoFocus
        value={pergunta}
        maxLength={200}
        placeholder="O que precisa ser decidido?"
        onChange={(e) => setPergunta(e.target.value)}
      />

      {opcoes.map((opcao, i) => (
        <div key={i} className={styles.linhaDeOpcao}>
          <Input
            label={`Opção ${i + 1}`}
            value={opcao}
            maxLength={80}
            onChange={(e) =>
              setOpcoes((atuais) => atuais.map((o, j) => (j === i ? e.target.value : o)))
            }
            // `Enter` na última opção acrescenta a próxima em vez de enviar:
            // é o gesto de quem está listando alternativas.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (i === opcoes.length - 1 && opcoes.length < OPCOES_MAX) {
                setOpcoes((atuais) => [...atuais, '']);
              }
            }}
          />
          {/* Some abaixo do mínimo: tirar a segunda opção deixaria uma
              enquete que não é uma pergunta. */}
          {opcoes.length > OPCOES_MIN ? (
            <IconButton
              label={`Remover a opção ${i + 1}`}
              size="sm"
              onClick={() => setOpcoes((atuais) => atuais.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </IconButton>
          ) : null}
        </div>
      ))}

      {opcoes.length < OPCOES_MAX ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpcoes((atuais) => [...atuais, ''])}
        >
          <Plus size={14} />
          Mais uma opção
        </Button>
      ) : null}

      <div className={styles.ajustes}>
        <span className={styles.ajuste}>
          <Toggle checked={multipla} onChange={setMultipla} label="Aceitar mais de uma" />
        </span>
        <span className={styles.ajuste}>
          {/* Imutável depois de criada: mudar isto com votos dentro revelaria
              o que foi prometido em segredo. */}
          <Toggle checked={anonima} onChange={setAnonima} label="Anônima" />
        </span>
        <label className={styles.ajuste}>
          Fecha em
          <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </label>
      </div>

      <div className={styles.acoes}>
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!pronta || criar.isPending}>
          Perguntar
        </Button>
      </div>
    </form>
  );
}
