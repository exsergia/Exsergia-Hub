-- Complementa filtros, controlador e oleo lubrificante dos geradores.
-- Campos vazios na planilha nao substituem valores que ja existam no Hub.

with geradores (
  codigo, separador_modelo, separador_quantidade, controlador,
  combustivel_modelo, combustivel_quantidade,
  lubrificante_modelo, lubrificante_quantidade,
  ar_modelo, ar_quantidade, oleo_tipo, oleo_litros
) as (
  values
    ('GMG 101', '0'::text, 0::numeric, 'SI 200B', 'FS1001', 2::numeric, 'LF9009', 1::numeric, 'AF25688', 1::numeric, '15W 40', 38::numeric),
    ('GMG 103', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 109', '0', 0, 'POWER WIZARD 1.0', 'REC 154', 1, 'BT 237', 1, '26510342', 1, '15W 40', 8),
    ('GMG 110', '0', 0, 'POWER WIZARD 1.0', '26560201', 1, 'OB 1028', 1, '26510342', 1, '15W 40', 8),
    ('GMG 111', '0', 0, 'POWER WIZARD 1.0', '26560201', 1, '2963366', 1, '26510342', 1, '15W 40', 8),
    ('GMG 112', '0', 0, 'POWER WIZARD 1.0', '26560201', 1, '2963366', 1, '901048', 1, '15W 40', 19),
    ('GMG 113', '0', 0, 'USCAMAQ', 'R26-A50', 1, '173776 - 173171', 2, '395773', 1, '15W 40', 38),
    ('GMG 114', '0', 0, 'PC1301', 'FS1001', 2, 'LF9009', 1, 'AF26173', 1, '15W 40', 38.6),
    ('GMG 115', '0', 0, 'POWER WIZARD 1.1', 'BF7674-D', 2, 'PSL 900', 2, 'FRG 10 - 0354', 1, '15W 40', 19),
    ('GMG 117', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 118', '0', 0, 'ATLAS COPCO QCS 1002', '26560163/F1079', 2, 'L1070', 1, '26510337', 1, '15W 40', 8),
    ('GMG 119', '0', 0, 'KX30 7 - KVA', '26560201', 1, '2963366', 1, '26510342', 1, '15W 40', 8),
    ('GMG 120', '3087298', 1, 'POWER WIZARD 1.1', '2998229', 1, '2654A111', 1, '2892348', 1, '15W 40', 16.5),
    ('GMG 121', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 122', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 123', '0', 0, 'PCC 1302', 'FS1001', 2, 'LF3000', 1, 'AF26173', 1, '15W 40', 38.6),
    ('GMG 124', '0', 0, 'PCC 1302', 'FS1000', 2, 'LF3000', 2, 'AF26173', 1, '15W 40', 38.6),
    ('GMG 125', '0', 0, 'POWER WIZARD 1.1', 'BF 7674', 2, 'OC 324', 2, '901-054', 1, '15W 40', 19),
    ('GMG 127', '0', 0, 'POWER WIZARD 1.1', '26560201', 1, '2963366', 1, '26510342', 1, '15W 40', 8),
    ('GMG 128', '0', 0, 'POWER WIZARD 1.1', 'BF 7674', 2, 'OC 324 - L1076', 2, '901-054', 1, '15W 40', 19),
    ('GMG 139', '0', 0, 'PC 1.1', 'FS1000', 2, 'LF9009', 1, '3022209', 1, '15W 40', 38.6),
    ('GMG 140', '0', 0, 'PC 3.3', 'FS1000', 2, 'LF9009', 1, '3022209', 1, '15W 40', 38.6),
    ('GMG 141', '0', 0, 'PC 3.3', 'FS1000', 2, 'LF3000', 1, '3022209', 1, '15W 40', 38.6),
    ('GMG 142', '0', 0, 'PC 3.3', 'FS1000', 2, 'LF9009', 1, '3022209', 1, '15W 40', 38.6),
    ('GMG 145', null, null, null, '944254004', null, null, null, null, null, '15W 40', null),
    ('GMG 149', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 150', null, null, null, '944254004', null, null, null, null, null, '15W 40', null),
    ('GMG 151', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 152', null, null, null, '944254004', null, null, null, null, null, '15W 40', null),
    ('GMG 153', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 154', null, null, null, null, null, null, null, null, null, '15W 40', null),
    ('GMG 155', null, null, null, null, null, null, null, null, null, '15W 40', null)
), normalizados as (
  select g.*, regexp_replace(upper(g.codigo), '[^A-Z0-9]', '', 'g') as codigo_normalizado
  from geradores g
)
update public.equipamentos e
set data = e.data || jsonb_strip_nulls(jsonb_build_object(
  'controlador', n.controlador,
  'oleoLubrificanteTipo', n.oleo_tipo,
  'oleoLubrificanteLitros', n.oleo_litros,
  'filtros', coalesce(e.data -> 'filtros', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'separador', n.separador_modelo,
    'separadorQuantidade', n.separador_quantidade,
    'combustivel', n.combustivel_modelo,
    'combustivelQuantidade', n.combustivel_quantidade,
    'oleo', n.lubrificante_modelo,
    'oleoQuantidade', n.lubrificante_quantidade,
    'ar', n.ar_modelo,
    'arQuantidade', n.ar_quantidade
  )),
  'updatedAt', now()
))
from normalizados n
where regexp_replace(upper(coalesce(e.data ->> 'codigo', '')), '[^A-Z0-9]', '', 'g') = n.codigo_normalizado
   or regexp_replace(upper(coalesce(e.data ->> 'tag', '')), '[^A-Z0-9]', '', 'g') = n.codigo_normalizado
   or regexp_replace(upper(coalesce(e.data ->> 'nome', '')), '[^A-Z0-9]', '', 'g') like '%' || n.codigo_normalizado || '%';

