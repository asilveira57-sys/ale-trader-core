-- 25/11/2026 (livreto 157): escada do freio de grupo por modalidade no WIN.
-- Nível 1 em % do teto; níveis 2-4 em 2x, 3x, 4x. Demais modalidades seguem 50/100/150/200.
UPDATE b3_grupo_limites SET nivel1_pct = 70, nivel2_pct = 140, nivel3_pct = 210, nivel4_pct = 280
 WHERE symbol = 'WIN' AND variant = 'indicador';
UPDATE b3_grupo_limites SET nivel1_pct = 30, nivel2_pct = 60, nivel3_pct = 90, nivel4_pct = 120
 WHERE symbol = 'WIN' AND variant IN ('range', 'rompimento');
