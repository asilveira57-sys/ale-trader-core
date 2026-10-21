import type { ModeApelidoApi } from "@/hooks/use-mode-apelidos";

// Apresentação do modo: apelido em destaque, rótulo técnico em segundo plano.
// O valor de `mode` nunca é alterado — só a forma de mostrar.
export function ModeName({
  mode,
  api,
  stacked = false,
  className = "",
}: {
  mode: string | null | undefined;
  api: ModeApelidoApi;
  stacked?: boolean;
  className?: string;
}) {
  const apelido = api.nick(mode);
  const tecnico = api.tech(mode);
  const showTech = tecnico && tecnico !== apelido;

  if (stacked) {
    return (
      <span className={`inline-flex flex-col leading-tight ${className}`}>
        <span className="font-medium">{apelido}</span>
        {showTech ? <span className="text-[10px] text-muted-foreground">({tecnico})</span> : null}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <span className="font-medium">{apelido}</span>
      {showTech ? <span className="text-[10px] text-muted-foreground">({tecnico})</span> : null}
    </span>
  );
}
