import { createFileRoute, redirect } from "@tanstack/react-router";

// Página inicial = cockpit de todos os robôs (não o cockpit de dinheiro real).
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "AleTrader — Cockpit B3" },
    { name: "description", content: "Acesso ao cockpit B3 de robôs simulados da AleTrader." },
    { property: "og:title", content: "AleTrader — Cockpit B3" },
    { property: "og:description", content: "Acesso ao cockpit B3 de robôs simulados da AleTrader." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => { throw redirect({ to: "/b3-cockpit" }); },
});

