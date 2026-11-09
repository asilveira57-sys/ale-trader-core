import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import type { EqualizePreview } from './b3-wallet-equalize';
const group = z.object({ symbol: z.string().min(1), variant: z.string().min(1) });
export const previewWalletEqualize = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth]).inputValidator(group).handler(async ({ data, context }) => {
    const r = await context.supabase.rpc('b3_carteira_igualar', {
      p_user_id: context.userId, p_symbol: data.symbol, p_variant: data.variant, p_previa: true,
    });
    if (r.error) throw new Error('Não foi possível preparar a prévia. Nenhum saldo foi movido.');
    const p = r.data as unknown as Omit<EqualizePreview, 'snapshot'> & { snapshot?: object };
    return { ...p, snapshot: p.snapshot ? JSON.stringify(p.snapshot) : undefined } satisfies EqualizePreview;
  });
export const confirmWalletEqualize = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth]).inputValidator(group.extend({ snapshot: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc('b3_carteira_igualar', {
      p_user_id: context.userId, p_symbol: data.symbol, p_variant: data.variant,
      p_previa: false, p_snapshot: JSON.parse(data.snapshot),
    });
    if (r.error) throw new Error('Equalização cancelada. Nenhum saldo foi movido. Confira uma nova prévia.');
    const p = r.data as unknown as Omit<EqualizePreview, 'snapshot'> & { snapshot?: object };
    return { ...p, snapshot: p.snapshot ? JSON.stringify(p.snapshot) : undefined } satisfies EqualizePreview;
  });