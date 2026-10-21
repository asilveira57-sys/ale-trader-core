import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listModeApelidos } from "@/lib/mode-apelidos.functions";
import { setModeNicks } from "@/lib/mode-nick-registry";

export interface ModeApelido {
  mode: string;
  apelido: string;
  ordem: number;
  rotulo_tecnico: string;
  observacao?: string | null;
}

// Modo fora da tabela: mostra o nome técnico e segue. Sem apelido inventado.
const fallbackTech = (mode: string) => {
  const s = String(mode ?? "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
};

export interface ModeApelidoApi {
  rows: ModeApelido[];
  /** Nome de destaque (apelido). Sem registro, cai no nome técnico. */
  nick: (mode: string | null | undefined) => string;
  /** Rótulo técnico em segundo plano. Vazio quando é igual ao destaque. */
  tech: (mode: string | null | undefined) => string;
  /** Coluna `ordem` (1..8). Desconhecido vai para o fim. */
  ordem: (mode: string | null | undefined) => number;
  /** Ordena chaves de modo pela escada do banco, não pelo alfabeto. */
  sortModes: <T>(list: T[], key?: (item: T) => string) => T[];
  isLoading: boolean;
}

export function useModeApelidos(): ModeApelidoApi {
  const fn = useServerFn(listModeApelidos);
  const q = useQuery({
    queryKey: ["b3-mode-apelidos"],
    queryFn: () => fn({}),
    staleTime: 10 * 60_000,
  });

  const rows = (q.data?.rows ?? []) as ModeApelido[];

  // Espelha no registro para os módulos de cópia/exportação usarem o MESMO rótulo.
  setModeNicks(rows);

  return useMemo(() => {
    const byMode = new Map(rows.map((r) => [String(r.mode), r]));
    const nick = (m: string | null | undefined) => byMode.get(String(m ?? ""))?.apelido || (String(m ?? "").endsWith("_sc") && byMode.get(String(m).slice(0, -3))?.apelido ? `${byMode.get(String(m).slice(0, -3))?.apelido} SC` : fallbackTech(String(m ?? "")));
    const tech = (m: string | null | undefined) => {
      const r = byMode.get(String(m ?? "")) ?? byMode.get(String(m ?? "").replace(/_sc$/, ""));
      const t = r?.rotulo_tecnico || fallbackTech(String(m ?? ""));
      return r?.apelido && r.apelido !== t ? t : r ? t : "";
    };
    const ordem = (m: string | null | undefined) => byMode.get(String(m ?? ""))?.ordem ?? 999;
    const sortModes = <T,>(list: T[], key?: (item: T) => string) =>
      [...list].sort((a, b) => {
        const ka = key ? key(a) : String(a);
        const kb = key ? key(b) : String(b);
        const d = ordem(ka) - ordem(kb);
        return d !== 0 ? d : ka.localeCompare(kb);
      });

    return { rows, nick, tech, ordem, sortModes, isLoading: q.isLoading };
  }, [rows, q.isLoading]);
}
