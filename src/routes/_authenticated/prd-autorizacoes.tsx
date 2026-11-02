import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/prd-autorizacoes')({
  validateSearch: (s: Record<string, unknown>) => ({ symbol: typeof s.symbol === 'string' ? s.symbol : undefined, variant: typeof s.variant === 'string' ? s.variant : undefined, mode: typeof s.mode === 'string' ? s.mode : undefined }),
  beforeLoad: ({ search }) => { throw redirect({ to: '/b3-autorizacoes-reais', search }); },
  head: () => ({ meta: [{ title: 'Autorizações reais — acesso anterior | AleTrader' }, { name: 'description', content: 'Acesso às autorizações de robôs para a conta real.' }, { property: 'og:title', content: 'Autorizações reais — acesso anterior | AleTrader' }, { property: 'og:description', content: 'Acesso às autorizações de robôs para a conta real.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] }),
});