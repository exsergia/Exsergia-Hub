-- Preenche a ficha tecnica dos geradores ja cadastrados em equipamentos.
-- A carga e idempotente e localiza o ativo por codigo, tag ou nome, ignorando
-- espacos e pontuacao (por exemplo: "GMG 101", "GMG-101" e "GMG101").

with geradores (
  codigo, modelo, potencia, autonomia, capacidade_tanque, ano_fabricacao,
  fabricante_gerador, motor, numero_serie
) as (
  values
    ('GMG 101', 'GTA 315',       450::numeric,  93.7::numeric, null::numeric, 2003, 'WEG',         'CUMMINS NTA G3',     '450037203'),
    ('GMG 103', 'MAQ44S16A',     460,           92.4,          null,          2010, 'WEG',         'SCANIA',             null),
    ('GMG 109', 'GEP 65-7',       75,           21.4,           219,          2010, 'OLYMPIAN',    'PERKINS',            'OLY00000LB4D04064'),
    ('GMG 110', 'GEP 88-1',      100,           21.4,           219,          2010, 'OLYMPIAN',    'PERKINS',            'OLY00000LB4502096'),
    ('GMG 111', 'GEP88-1',       100,           21.4,           219,          2010, 'OLYMPIAN',    'PERKINS',            'OLY00000JB4502139'),
    ('GMG 112', 'GEP 110-2',     125,           25.7,           250,          2010, 'OLYMPIAN',    'PERKINS',            'OLY00000VB4HO1867'),
    ('GMG 113', '4215',          400,           78.9,          null,          2004, 'WEG',         'SCANIA',             'X'),
    ('GMG 114', 'C400D6 4',      500,          110,             500,          2011, 'WEG',         'CUMMINS NTA G5',     'K11T022075'),
    ('GMG 115', 'GEP150-1',      165,           33.7,           349,          2011, 'OLYMPIAN',    'PERKINS',            'OLY00000VLER00376'),
    ('GMG 117', 'QAS 55',         55,           11.6,           150,          2012, 'ATLAS COPCO', 'PERKINS',            null),
    ('GMG 118', 'QAS 55 Pd',      55,           11.6,           150,          2011, 'ATLAS COPCO', 'PERKINS',            'BRP081111'),
    ('GMG 119', 'GEP 65-11',      75,           21.4,           219,          2011, 'OLYMPIAN',    'PERKINS',            'OLY00000VLES00566'),
    ('GMG 120', 'GEP 200-4',   218.8,           44.4,           418,          2012, 'OLYMPIAN',    'PERKINS',            'OLY00000CLNY00396'),
    ('GMG 121', 'QAS 55',         55,           11.6,           150,          2012, 'ATLAS COPCO', 'PERKINS',            null),
    ('GMG 122', 'GEP 44',         50,           null,           200,          2012, 'OLYMPIAN',    'PERKINS',            null),
    ('GMG 123', 'C400D6',        500,          110,             500,          2012, 'WEG',         'CUMMINS NTA G5',     'I12T025013'),
    ('GMG 124', 'C400D6',        500,          110,             500,          2012, 'WEG',         'CUMMINS NTA G3',     'I12T025096'),
    ('GMG 125', 'GEP 150-1',     165,           40.1,           349,          2012, 'OLYMPIAN',    'PERKINS',            'OLY00000CLER00652'),
    ('GMG 127', 'GEP 65-11',      75,           21.4,           219,          2012, 'OLYMPIAN',    'PERKINS',            'OLY00000CLES01571'),
    ('GMG 128', 'GEP 150-1',     165,           40.1,           349,          null, 'OLYMPIAN',    'PERKINS',            'OLY00000JLER00651'),
    ('GMG 139', 'C400D6',        500,          110,             500,          2013, 'WEG',         'CUMMINS NTA855 G5',  'J13T028503'),
    ('GMG 140', 'C400D6F',       500,          110,             500,          2013, 'WEG 12',      'CUMMINS NTA855 G5',  'J13T028614'),
    ('GMG 141', 'C400D6 F',      500,          110,             500,          2013, 'WEG',         'CUMMINS NTA 855 G5', 'J13T028439'),
    ('GMG 142', 'C400D6 F',      500,          110,             500,          2013, 'WEG',         'CUMMINS NTA 855 G5', 'J13T028613'),
    ('GMG 145', 'TDWG12000SGE', 12.5,           null,            26,          2014, null,          null,                 null),
    ('GMG 149', 'MAQ4401',       250,           null,          null,          null, 'WEG',         'SCANIA',             null),
    ('GMG 150', 'TDWG12000SGE', 12.5,           null,            26,          2017, null,          null,                 null),
    ('GMG 151', 'GFW33',          30,            7.5,            42,          2018, null,          null,                 null),
    ('GMG 152', 'TDWG12000SGE', 12.5,           null,            26,          2019, null,          null,                 null),
    ('GMG 153', 'MWM-D229',       30,            7.5,            42,          null, null,          null,                 null),
    ('GMG 154', 'C20D6',          25,           null,            75,          2010, 'WEG',         null,                 null),
    ('GMG 155', 'TD4000CX',      3.6,           null,          12.5,          null, null,          null,                 null)
), normalizados as (
  select
    g.*,
    regexp_replace(upper(g.codigo), '[^A-Z0-9]', '', 'g') as codigo_normalizado
  from geradores g
)
update public.equipamentos e
set data = e.data || jsonb_strip_nulls(jsonb_build_object(
  'modelo', n.modelo,
  'potencia', n.potencia,
  'potenciaUnidade', case when n.potencia is not null then 'kVA' end,
  'autonomia', n.autonomia,
  'autonomiaUnidade', case when n.autonomia is not null then 'L/h' end,
  'capacidadeTanque', n.capacidade_tanque,
  'anoFabricacao', n.ano_fabricacao,
  'fabricanteGerador', n.fabricante_gerador,
  'motor', n.motor,
  'numeroSerie', n.numero_serie,
  'updatedAt', now()
))
from normalizados n
where regexp_replace(upper(coalesce(e.data ->> 'codigo', '')), '[^A-Z0-9]', '', 'g') = n.codigo_normalizado
   or regexp_replace(upper(coalesce(e.data ->> 'tag', '')), '[^A-Z0-9]', '', 'g') = n.codigo_normalizado
   or regexp_replace(upper(coalesce(e.data ->> 'nome', '')), '[^A-Z0-9]', '', 'g') like '%' || n.codigo_normalizado || '%';



