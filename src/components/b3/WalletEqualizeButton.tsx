import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Equal, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { previewWalletEqualize, confirmWalletEqualize } from '@/lib/b3-wallet-equalize.functions';
import { equalizeText, type EqualizePreview } from '@/lib/b3-wallet-equalize';
import { transferMoney } from '@/lib/b3-wallet-transfer';
import { copiarTexto } from '@/lib/b3-copiar';
import { robotLabel } from '@/lib/b3-cockpit-labels';

export function WalletEqualizeButton({ symbol, variant, title }: { symbol: string; variant: string; title: string }) {
  const [preview, setPreview] = useState<EqualizePreview | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const prepare = useServerFn(previewWalletEqualize), confirm = useServerFn(confirmWalletEqualize);
  const qc = useQueryClient(); const label = (mode: string) => robotLabel(mode, variant);
  async function showPreview() {
    setBusy(true); setError('');
    try {
      const p = await prepare({ data: { symbol, variant } });
      if (!p.ok) { setError(p.error ?? 'Equalização recusada'); return; }
      setPreview(p);
    } catch (e) { setError(e instanceof Error ? e.message : 'Prévia indisponível; nenhum saldo movido.'); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview?.snapshot) return;
    setBusy(true); setError('');
    try {
      const p = await confirm({ data: { symbol, variant, snapshot: preview.snapshot } });
      if (!p.ok) { setPreview(null); setError(p.error ?? 'Equalização recusada'); return; }
      setPreview(null); toast.success('Carteiras igualadas; capital da modalidade preservado.');
      await qc.invalidateQueries({ queryKey: ['b3-cockpit-pesado', 'carteiras'] });
      await qc.invalidateQueries({ queryKey: ['b3-cockpit-pesado', 'transferencia', symbol, variant] });
    } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : 'Equalização cancelada.'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="px-3 py-2">
      <Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={showPreview} aria-label={`Igualar carteiras da modalidade · ${title}`}><Equal className="mr-2 size-4 shrink-0" />Igualar carteiras da modalidade</Button>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{error}</p>}
    </div>
    <Dialog open={preview != null} onOpenChange={open => { if (!open && !busy) setPreview(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] min-w-0 max-w-4xl max-h-[90dvh] overflow-y-auto overflow-x-hidden bg-card text-card-foreground [&_button]:min-h-11">
        <DialogHeader className="min-w-0"><DialogTitle className="break-words pr-6">Prévia: igualar carteiras · {title}</DialogTitle><DialogDescription className="break-words">{preview?.n} robôs com saldo · {preview?.motivo}</DialogDescription></DialogHeader>
        {preview && <div className="min-w-0 space-y-3 text-sm">
          <div className="min-w-0 max-w-full overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Robô</th><th className="p-2 text-right">Agora</th><th className="p-2 text-right">Depois</th><th className="p-2 text-right">Resultado próprio (não muda)</th><th className="p-2 text-right">Transferências líquidas</th></tr></thead><tbody>
            {preview.rows.map(r => <tr key={r.mode} className="border-t border-border"><th className="p-2 font-medium">{label(r.mode)}</th><td className="p-2 text-right font-mono whitespace-nowrap">{transferMoney(r.saldo)}<br />{r.contratos} ctr</td><td className="p-2 text-right font-mono whitespace-nowrap">{transferMoney(r.saldo_depois)}<br />{r.contratos_depois} ctr</td><td className="p-2 text-right font-mono whitespace-nowrap">{transferMoney(r.resultado_proprio)}</td><td className="p-2 text-right font-mono whitespace-nowrap">{transferMoney(r.transferencias_liquidas)} → {transferMoney(r.transferencias_depois)}</td></tr>)}
          </tbody></table></div>
          <p>Capital da modalidade: <strong className="font-mono">{transferMoney(preview.capital_antes)} → {transferMoney(preview.capital_depois)}</strong> (não muda; soma zero)</p>
          <p>Contratos da modalidade: <strong className="font-mono">{preview.contratos_antes} → {preview.contratos_depois}</strong></p>
          {preview.reduz_contratos && <p role="note" className="border-l-2 border-warning pl-3 font-semibold text-warning">Esta equalização reduz os contratos da modalidade de {preview.contratos_antes} para {preview.contratos_depois}.</p>}
          <Button variant="outline" onClick={() => copiarTexto(equalizeText(preview, label))}><Copy className="mr-2 size-4" />Copiar prévia</Button>
        </div>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button><Button disabled={busy} onClick={commit}>Confirmar equalização</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}