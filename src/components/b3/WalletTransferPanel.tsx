import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowRightLeft,Copy,ChevronDown,ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from '@/components/ui/select';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from '@/components/ui/dialog';
import { readTransferWallets,previewWalletTransfer,confirmWalletTransfer } from '@/lib/b3-wallet-transfer.functions';
import { transferMoney,transferPreviewText,type WalletTransferPreview } from '@/lib/b3-wallet-transfer';
import { copiarTexto,tabular } from '@/lib/b3-copiar';
import { useModeApelidos } from '@/hooks/use-mode-apelidos';

export function WalletTransferPanel({symbol,variant,title}:{symbol:string;variant:string;title:string}) {
  const [expanded,setExpanded]=useState(false);
  const [source,setSource]=useState(''); const [target,setTarget]=useState('');
  const [amount,setAmount]=useState(''); const [reason,setReason]=useState('');
  const [preview,setPreview]=useState<WalletTransferPreview|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const aliases=useModeApelidos(); const qc=useQueryClient();
  const label=(m:string)=>`${aliases.nick(m)} (${aliases.tech(m)||m})`;
  const read=useServerFn(readTransferWallets); const prepare=useServerFn(previewWalletTransfer); const confirm=useServerFn(confirmWalletTransfer);
  const q=useQuery({queryKey:['b3-cockpit-pesado','transferencia',symbol,variant],queryFn:()=>read({data:{symbol,variant}}),enabled:expanded,staleTime:Infinity,refetchOnWindowFocus:false,refetchOnReconnect:false});
  const rows=aliases.sortModes(q.data?.rows??[],w=>w.mode);
  const donors=rows.filter(w=>w.maximo_doavel>0);
  function failure(p:WalletTransferPreview) {return `${p.error??'Transferência recusada'}${p.maximo_permitido==null?'':` — máximo permitido: ${transferMoney(p.maximo_permitido)}`}`;}
  async function preparePreview(){
    setBusy(true);setError('');
    try {const p=await prepare({data:{symbol,variant,de_mode:source,para_mode:target,valor:Number(amount),motivo:reason.trim()}});if(!p.ok){setError(failure(p));return;}setPreview(p);}catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar a transferência.');}finally{setBusy(false);}
  }
  async function commit(){
    if(!preview?.snapshot||!preview.de_mode||!preview.para_mode||preview.valor==null||!preview.motivo)return;
    setBusy(true);setError('');
    try {const p=await confirm({data:{symbol,variant,de_mode:preview.de_mode,para_mode:preview.para_mode,valor:preview.valor,motivo:preview.motivo,snapshot:preview.snapshot}});
      if(!p.ok){setError(failure(p));setPreview(null);return;}
      toast.success('Saldo movido entre os robôs; capital da modalidade preservado.');setPreview(null);setAmount('');setReason('');
      await qc.invalidateQueries({queryKey:['b3-cockpit-pesado','carteiras']});await qc.invalidateQueries({queryKey:['b3-cockpit-pesado','transferencia',symbol,variant]});
    }catch(e){setError(e instanceof Error?e.message:'Transferência cancelada.');}finally{setBusy(false);}
  }
  function copyList(){if(!q.data)return;copiarTexto([`${title} — carteiras atuais`,tabular(['Robô','Saldo','Contratos','Estado','Pode doar até','Resultado próprio','Transferência líquida','Atualizada em'],rows.map(w=>[label(w.mode),transferMoney(w.saldo),w.contratos,w.estado,transferMoney(w.maximo_doavel),transferMoney(w.resultado_proprio),transferMoney(w.transferencias_liquidas),w.atualizada_em??'sem registro'])),`Capital da modalidade: ${transferMoney(q.data.capital_antes)}`,`Contratos da modalidade: ${q.data.contratos_antes}`].join('\n'));}
  return <section className="border-t border-border bg-card px-3 py-2 text-foreground" aria-label={`Mover saldo · ${title}`}>
    <Button variant="ghost" className="min-h-11 h-auto w-full justify-between whitespace-normal text-left" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><span className="flex items-center gap-2"><ArrowRightLeft className="size-4 shrink-0"/>Mover saldo entre os robôs desta modalidade</span>{expanded?<ChevronUp className="size-4 shrink-0"/>:<ChevronDown className="size-4 shrink-0"/>}</Button>
    {expanded&&<div className="space-y-4 pb-3">
      {q.isPending?<p role="status">Consultando carteiras atuais…</p>:q.isError?<p role="alert">Não foi possível ler as carteiras.</p>:!q.data?.ok?<p role="alert">{q.data?.error??'sem registro'}</p>:<>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{title} · {rows.length} robôs · {transferMoney(q.data.capital_antes)} · {q.data.contratos_antes} contratos</p><Button variant="outline" className="min-h-11" onClick={copyList}><Copy className="mr-2 size-4"/>Copiar lista</Button></div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{rows.map(w=><li key={w.mode} className="border-b border-border py-2 text-sm"><p className="font-semibold">{label(w.mode)}</p><p className="font-mono">{transferMoney(w.saldo)} · {w.contratos} ctr</p>{w.maximo_doavel>0&&<p className="text-muted-foreground">pode doar até {transferMoney(w.maximo_doavel)}</p>}{w.estado==='carteira_insuficiente'&&<p className="font-semibold text-destructive">carteira insuficiente — candidato a receber</p>}</li>)}</ul>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>Origem</Label><Select value={source} onValueChange={v=>{setSource(v);if(v===target)setTarget('');setError('');}}><SelectTrigger aria-label={`Origem · ${title}`} className="min-h-11"><SelectValue placeholder="Escolher doador"/></SelectTrigger><SelectContent>{donors.map(w=><SelectItem className="min-h-11" key={w.mode} value={w.mode}>{label(w.mode)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Destino</Label><Select value={target} onValueChange={setTarget}><SelectTrigger aria-label={`Destino · ${title}`} className="min-h-11"><SelectValue placeholder="Escolher destinatário"/></SelectTrigger><SelectContent>{rows.filter(w=>w.mode!==source).map(w=><SelectItem className="min-h-11" key={w.mode} value={w.mode}>{label(w.mode)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor={`amount-${symbol}-${variant}`}>Valor (R$)</Label><Input id={`amount-${symbol}-${variant}`} className="min-h-11" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></div><div className="space-y-1"><Label htmlFor={`reason-${symbol}-${variant}`}>Motivo obrigatório</Label><Textarea id={`reason-${symbol}-${variant}`} value={reason} onChange={e=>setReason(e.target.value)} /></div></div>
        {donors.length===0&&<p className="text-muted-foreground">Nenhum robô tem sobra acima de um contrato nesta modalidade.</p>}
        <p className="text-sm text-muted-foreground">Soma zero: o capital da modalidade não muda. Apenas saldo entre seus robôs, sem aporte externo.</p>
        <Button className="min-h-11" variant="outline" disabled={busy||!source||!target||!(Number(amount)>0)||!reason.trim()} onClick={preparePreview}>Ver prévia antes de confirmar</Button>
      </>}{error&&<p role="alert" className="font-semibold text-destructive">{error}</p>}
    </div>}
    <Dialog open={preview!=null} onOpenChange={v=>{if(!v&&!busy)setPreview(null);}}><DialogContent className="max-h-[90dvh] overflow-y-auto bg-card text-card-foreground [&_button]:min-h-11"><DialogHeader><DialogTitle>Confirmar transferência · {title}</DialogTitle><DialogDescription>Valor: {transferMoney(preview?.valor)} · Motivo: {preview?.motivo}</DialogDescription></DialogHeader>
      {preview&&<div className="space-y-4 text-sm"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Robô</th><th className="p-2">Agora</th><th className="p-2">Depois</th></tr></thead><tbody>{[{mode:preview.de_mode,side:'origem',before:preview.de_saldo_antes,after:preview.de_saldo_depois,cb:preview.de_contratos_antes,ca:preview.de_contratos_depois},{mode:preview.para_mode,side:'destino',before:preview.para_saldo_antes,after:preview.para_saldo_depois,cb:preview.para_contratos_antes,ca:preview.para_contratos_depois}].map(r=><tr key={r.side} className="border-t border-border"><th className="p-2 font-medium">{label(r.mode??'')} ({r.side})</th><td className="p-2 font-mono">{transferMoney(r.before)} · {r.cb} ctr</td><td className="p-2 font-mono">{transferMoney(r.after)} · {r.ca} ctr</td></tr>)}</tbody></table></div>
      <p>Contratos da modalidade: <strong className="font-mono">{preview.contratos_antes} → {preview.contratos_depois}</strong></p><p>Capital da modalidade: <strong className="font-mono">{transferMoney(preview.capital_antes)} → {transferMoney(preview.capital_depois)}</strong> (não muda; soma zero)</p>
      {preview.reduz_contratos&&<p role="note" className="border-l-2 border-warning pl-3 font-semibold text-warning">esta transferência reduz os contratos da modalidade de {preview.contratos_antes} para {preview.contratos_depois}</p>}
      <Button variant="outline" onClick={()=>copiarTexto(transferPreviewText(preview,label))}><Copy className="mr-2 size-4"/>Copiar prévia</Button></div>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setPreview(null)}>Cancelar</Button><Button disabled={busy} onClick={commit}>Confirmar transferência</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}