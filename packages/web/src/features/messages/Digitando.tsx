import { useEffect, useState } from 'react';
import type { User } from '@trindade/shared';
import { digitandoAgora, useDigitando } from '../realtime/store';
import styles from './messages.module.css';

/**
 * "Fulano está digitando…".
 *
 * O TTL expira sozinho, sem evento de parada vindo do servidor — por isso o
 * relógio de um segundo: sem ele o texto ficaria pendurado até o próximo
 * evento chegar, que pode não chegar nunca se a pessoa fechar a aba.
 */
export function Digitando({ channelId, pessoas }: { channelId: string; pessoas: readonly User[] }) {
  const porCanal = useDigitando((s) => s.porCanal);
  const [, tique] = useState(0);

  const ids = digitandoAgora(porCanal, channelId);

  useEffect(() => {
    if (ids.length === 0) return;
    const id = setInterval(() => tique((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ids.length]);

  // Altura reservada mesmo vazio: sem isso o compositor sobe e desce a cada
  // pessoa que começa a escrever, e a linha inteira treme.
  if (ids.length === 0) return <p className={styles.digitando} aria-hidden="true" />;

  const nomes = ids
    .map((id) => pessoas.find((p) => p.id === id)?.displayName)
    .filter((n): n is string => Boolean(n));

  if (nomes.length === 0) return <p className={styles.digitando} aria-hidden="true" />;

  const texto =
    nomes.length === 1
      ? `${nomes[0]} está digitando…`
      : nomes.length === 2
        ? `${nomes[0]} e ${nomes[1]} estão digitando…`
        : 'várias pessoas estão digitando…';

  return (
    <p className={styles.digitando} aria-live="polite">
      {texto}
    </p>
  );
}
