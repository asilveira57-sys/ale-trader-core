import { Copy, AlertTriangle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRL } from "@/lib/b3-format";
import { copiarTexto } from "@/lib/b3-copiar";
import { walletSteps, walletSummary, type RobotWallet, type walletExposure } from "@/lib/b3-wallet-view";

const LEGEND = "A exposição ao movimento do preço é a líquida, mas a margem exigida é a bruta — a corretora cobra as duas pontas.";
export function WalletBand({ rows, title, robot = false, exposure, historical = false, pending = false, error = false }: { rows: RobotWallet[]; title: string; robot?: boolean; exposure?: ReturnType<typeof walletExposure>; historical?: boolean; pending?: boolean; error?: boolean }) {
  const summary = walletSummary(rows), w = rows[0], steps = robot && w ? walletSteps(w) : null;
  const unavailable = historical ? "Carteira atual: período encerrado — sem retrato histórico" : pending ? "Consultando carteira…" : error ? "Carteira: leitura indisponível" : rows.length === 0 ? "Carteira: sem registro" : null;
  const text = unavailable ?? (robot && w ? `Saldo ${BRL(w.saldo_atual_brl)} · ${w.contratos_atuais} contratos atuais` : `Capital total investido ${BRL(summary.capital)} · ${summary.robots} robôs · ${summary.contracts} contratos`);
  const insufficient = !unavailable && summary.insufficient > 0;
  const next = steps ? `faltam ${BRL(steps.missing)} para ${steps.next} contratos` : robot && !unavailable ? "Próximo degrau: margem sem registro" : null;
  const cap = steps?.capped ? `a carteira permite ${steps.allowed} contratos, mas o teto do robô é ${w?.max_contracts}` : null;
  const state = insufficient ? robot ? "carteira insuficiente — o robô parou de entrar" : `${summary.insufficient} de ${summary.robots} em carteira insuficiente` : null;
  const copy = () => copiarTexto(`${title}\n${text}\n${state ?? "Carteira insuficiente: nenhuma ou sem registro"}\n${next ?? "Próximo degrau: sem registro"}\n${cap ?? "Teto limitando: não ou sem registro"}\n` + (exposure ? `Exposição bruta: ${exposure.grossContracts} contratos · ${BRL(exposure.gross)}\nExposição líquida: ${exposure.netContracts} contratos · ${BRL(exposure.net)}\n${LEGEND}\n` : "Exposição: sem registro\n") + rows.map(r => Object.entries(r).map(([k,v]) => `${k}: ${v ?? "sem registro"}`).join("\n")).join("\n\n"));
  return <div className={`flex flex-wrap items-start gap-2 border-t border-border px-3 py-2 text-xs ${insufficient ? "bg-destructive/10 text-destructive" : "text-foreground"}`}>
    {insufficient ? <AlertTriangle className="size-4 shrink-0" /> : <Wallet className="size-4 shrink-0" />}
    <div className="min-w-0 flex-1 space-y-1"><p className="font-semibold">{text}</p>{state && <p className="font-bold">{state}</p>}{next && <p>{next}</p>}{cap && <p className="font-semibold">{cap}</p>}
      {exposure !== undefined && <><p>Exposição bruta atual: {exposure ? `${exposure.grossContracts} contratos · ${BRL(exposure.gross)}` : "margem sem registro"}</p><p>Exposição líquida atual: {exposure ? `${exposure.netContracts} contratos · ${BRL(exposure.net)}` : "margem sem registro"}</p><p className="text-muted-foreground">{LEGEND}</p></>}
    </div><Button variant="ghost" className="min-h-11 min-w-11" aria-label={`Copiar carteira de ${title}`} onClick={copy}><Copy className="size-4" /></Button>
  </div>;
}