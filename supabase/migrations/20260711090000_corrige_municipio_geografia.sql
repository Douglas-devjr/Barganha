-- F2 — Correção da geografia gravada com o ENDEREÇO INTEIRO como município.
--
-- O parser ENCAT capturava "tudo antes da UF" como município quando o portal
-- imprime o endereço numa linha só ("RUA X, 123, BAIRRO, CIDADE, UF" — o
-- formato REAL, confirmado nos esqueletos de backend/.debug-html). O
-- `escopo_id` de município nascia lixo ("RJ:RUA X, 123, …") e nunca casava com
-- a cidade escolhida no app — a média regional caía silenciosamente para a UF.
--
-- O parser foi corrigido (municipioUfDeEndereco: último segmento por vírgula;
-- dentro dele, por " - "/"/"). Aqui saneamos o que JÁ FOI gravado com a mesma
-- regra e zeramos o cache derivado.
--
-- APÓS APLICAR: rodar o recálculo COMPLETO (`npm run job:recalculo` com
-- RECALCULO_LOOKBACK_MINUTES=0) — `preco_estatistica` é reconstruída inteira a
-- partir das observações corrigidas; com lookback parcial os produtos sem
-- observação recente ficariam sem estatística.

-- 1) Pool anônimo: município = último segmento por vírgula; dentro dele, o que
--    vem depois do último " - " ou "/". Só toca valores com cara de endereço.
update observacao_preco
   set municipio = nullif(
         trim(regexp_replace(split_part(municipio, ',', -1), '^.*(\s+-\s+|/)', '')),
         ''
       )
 where municipio ~ ',|/|\s-\s';

-- 2) Loja (o endereço completo continua em `endereco`; aqui é só a cidade).
update loja
   set municipio = nullif(
         trim(regexp_replace(split_part(municipio, ',', -1), '^.*(\s+-\s+|/)', '')),
         ''
       )
 where municipio ~ ',|/|\s-\s';

-- 3) Cache derivado: as linhas com escopo_id lixo não são alcançadas pelo
--    upsert do recálculo (chave nova ≠ chave velha) e ficariam órfãs. É cache
--    100% reconstruível — zera e deixa o job em lote repopular.
delete from preco_estatistica;
