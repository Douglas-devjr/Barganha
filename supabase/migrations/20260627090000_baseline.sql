-- Migração baseline da fundação (C0.4).
-- Contém apenas o que é estável e pré-requisito do schema: extensões e os
-- tipos enumerados do domínio. As TABELAS (lado privado: cupom/item_cupom;
-- lado compartilhado: loja/produto_canonico/produto_alias/observacao_preco/
-- preco_estatistica) entram na Camada 1 (C1.2), respeitando a separação
-- privado x compartilhado de docs/04-privacidade-lgpd.md.

-- gen_random_uuid() e funções de criptografia.
create extension if not exists pgcrypto;

-- Status do ciclo de vida de um cupom (ver docs/02-modelo-de-dados.md).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_cupom') then
    create type status_cupom as enum ('qr_capturado', 'processado', 'falha');
  end if;
end
$$;

-- Escopo geográfico das estatísticas — fallback loja → município → região → UF.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'escopo_geo') then
    create type escopo_geo as enum ('loja', 'municipio', 'regiao', 'uf');
  end if;
end
$$;
