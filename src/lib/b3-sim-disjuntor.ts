// Simulação pura do disjuntor de PERDA por dia. Só lê resultados gravados.
export interface OrdemSim { dia: string; entry: string; exit: string; net: number; contrato: string | null }

export interface Cenario {
  pct: number | null; total: number; mediana: number | null; pior: number | null; melhor: number | null;
  pregoes: number; disparos: number; impedidas: number;
}

export const CENARIOS: (number | null)[] = [null, 0.10, 0.25, 0.30, 0.35, 0.40, 0.50];

const mediana = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// Por dia: acumula pelas saídas em ordem; quando o acumulado ≤ −pct×base o disjuntor
// arma e toda operação que ENTRA depois desse horário é impedida. Dia sem ordem não existe.
export function simularDisjuntor(ordens: OrdemSim[], dias: string[], base: number, pct: number | null): Cenario {
  const porDia = new Map<string, OrdemSim[]>();
  for (const o of ordens) (porDia.get(o.dia) ?? porDia.set(o.dia, []).get(o.dia)!).push(o);
  const resultados: number[] = [];
  let disparos = 0, impedidas = 0;
  for (const d of dias) {
    const os = porDia.get(d);
    if (!os?.length) continue;
    if (pct == null) { resultados.push(os.reduce((s, o) => s + o.net, 0)); continue; }
    const limite = -pct * base;
    const porSaida = [...os].sort((a, b) => a.exit.localeCompare(b.exit));
    let acum = 0, armadoEm: string | null = null;
    const contadas = new Set<OrdemSim>();
    for (const o of porSaida) {
      if (armadoEm && o.entry > armadoEm) { impedidas++; continue; }
      acum += o.net; contadas.add(o);
      if (!armadoEm && acum <= limite) { armadoEm = o.exit; disparos++; }
    }
    resultados.push(acum);
  }
  return {
    pct, total: resultados.reduce((s, x) => s + x, 0), mediana: mediana(resultados),
    pior: resultados.length ? Math.min(...resultados) : null, melhor: resultados.length ? Math.max(...resultados) : null,
    pregoes: resultados.length, disparos, impedidas,
  };
}
