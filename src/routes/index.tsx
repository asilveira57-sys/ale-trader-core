import { createFileRoute, redirect } from "@tanstack/react-router";

// Página inicial = cockpit de todos os robôs (não o cockpit de dinheiro real).
export const Route = createFileRoute("/")({
  beforeLoad: () => { throw redirect({ to: "/b3-cockpit" }); },
});

