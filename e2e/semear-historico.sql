-- Enche #geral com histórico antigo, para que a paginação tenha o que paginar.
--
-- Direto no banco de propósito: o envio real passa pelo WebSocket e pelo token
-- bucket de 10 mensagens por 10 segundos, então semear 120 linhas pela
-- interface levaria dois minutos e ainda testaria o rate limit por acidente.
--
-- Idempotente: só insere se ainda não houver histórico semeado.
--   docker compose exec -T postgres psql -U trindade -d trindade < e2e/semear-historico.sql

do $$
declare
  canal uuid;
  autores uuid[];
  quantos int;
begin
  select id into canal from channels where slug = 'geral';
  if canal is null then
    raise notice 'canal #geral não existe; nada a semear';
    return;
  end if;

  select count(*) into quantos from messages
   where channel_id = canal and content like '[semente]%';
  if quantos >= 120 then
    raise notice 'já semeado (% linhas)', quantos;
    return;
  end if;

  select array_agg(id order by username) into autores from users where disabled_at is null;

  insert into messages (channel_id, author_id, content, created_at)
  select
    canal,
    autores[1 + (i % array_length(autores, 1))],
    '[semente] linha ' || i || ' do histórico antigo',
    -- Espalhadas por três dias, para exercitar também os divisores de dia e a
    -- quebra de bloco por tempo.
    now() - interval '3 days' + (i * interval '31 minutes')
  from generate_series(1, 120) as i;

  raise notice 'semeadas 120 mensagens em #geral';
end $$;
