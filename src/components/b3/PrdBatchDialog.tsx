import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from '@/components/ui/dialog';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { previewPrdBatch } from '@/lib/prd-authorization.functions';

export type PrdBatchPreview = Awaited<ReturnType<typeof previewPrdBatch>>;
const brl=(v:number)=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function PrdBatchDialog({open,preview,password,busy,onPassword,onClose,onConfirm,robotName,variantName}:{open:boolean;preview:PrdBatchPreview|null;password:string;busy:boolean;onPassword:(v:string)=>void;onClose:()=>void;onConfirm:()=>void;robotName:(mode:string)=>string;variantName:string}) {
  const warnings=preview ? [
    preview.warnings.margin ? 'a carteira não cobre a margem de todos ao mesmo tempo — a corretora vai recusar parte das aberturas.' : null,
    preview.warnings.stale ? preview.ledger_days == null ? 'a carteira não tem lançamento — o número abaixo pode não ser o seu capital real.' : `a carteira tem ${preview.ledger_days} dias sem lançamento — o número abaixo pode não ser o seu capital real.` : null,
    preview.warnings.loss ? 'se todos perderem o limite no mesmo dia, a perda passa do capital.' : null,
  ].filter(Boolean):[];
  async function copy(){
    if(!preview) return;
    const text=[`Vai ligar: ${preview.robots.length} robôs de ${variantName} no ${preview.symbol}`,`Margem necessária se todos abrirem juntos: ${brl(preview.margin_brl)} (soma das quantidades × ${brl(preview.margin_per_contract_brl)})`,`Soma dos limites diários (3 stops cada): ${brl(preview.limits_brl)}`,`Carteira real hoje: ${brl(preview.capital_brl)}`,`Último lançamento: ${preview.ledger_date ?? 'sem registro'}`, ...warnings,'Robô\tMagic\tQtd. máx.\t3 stops',...preview.robots.map(r=>`${robotName(r.mode)}\t${r.magic_number ?? 'sem registro'}\t${r.max_qty}\t${brl(r.three_stops_brl)}`),'Não serão ligados',...preview.skipped.map(r=>`${robotName(r.mode)}\t${r.magic_number ?? 'sem registro'}\t${r.reason ?? 'sem registro'}`)].join('\n');
    try{await navigator.clipboard.writeText(text);toast.success('Confirmação copiada');}catch{toast.error('Não foi possível copiar');}
  }
  return <Dialog open={open} onOpenChange={v=>{if(!v && !busy)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto [&_button]:min-h-11 [&_input]:min-h-11"><DialogHeader><DialogTitle>Ligar modalidade no real</DialogTitle><DialogDescription>{preview ? `Vai ligar: ${preview.robots.length} robôs de ${variantName} no ${preview.symbol}`:'Consultando valores atuais…'}</DialogDescription></DialogHeader>
    {preview && <div className="space-y-4 text-sm"><dl className="space-y-3"><div><dt>Margem necessária se todos abrirem juntos</dt><dd className="font-mono">{brl(preview.margin_brl)}</dd><dd className="text-xs text-muted-foreground">Soma das quantidades ({preview.robots.map(r=>r.max_qty).join(' + ') || '0'}) × {brl(preview.margin_per_contract_brl)}</dd></div><div><dt>Soma dos limites diários (3 stops cada)</dt><dd className="font-mono">{brl(preview.limits_brl)}</dd></div><div><dt>Carteira real hoje</dt><dd className="font-mono">{brl(preview.capital_brl)}</dd><dd className="text-xs text-muted-foreground">Último lançamento: {preview.ledger_date ?? 'sem registro'}</dd></div></dl>
      {warnings.map(w=><p key={w} role="note" className="text-warning border-l-2 border-warning pl-3">{w}</p>)}
      <ul className="space-y-2">{preview.robots.map(r=><li key={r.id}>{robotName(r.mode)} · Magic {r.magic_number ?? 'sem registro'} · {r.max_qty} contrato(s) · 3 stops {brl(r.three_stops_brl)}</li>)}</ul>
      {preview.skipped.length>0 && <div className="text-warning"><p>Não serão ligados:</p>{preview.skipped.map(r=><p key={r.id}>{robotName(r.mode)} · {r.reason}</p>)}</div>}
      <Button variant="outline" onClick={copy}><Copy className="size-4 mr-2"/>Copiar confirmação</Button><div><Label htmlFor="batch-password">Senha mestra</Label><Input id="batch-password" type="password" autoComplete="current-password" value={password} onChange={e=>onPassword(e.target.value)}/></div>
    </div>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="destructive" disabled={busy || !password || !preview?.robots.length} onClick={onConfirm}>Confirmar e ligar</Button></DialogFooter></DialogContent></Dialog>;
}