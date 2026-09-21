import { Component, type ReactNode } from "react";

import { RouteErrorFallback } from "@/components/RouteErrorFallback";

// Boundary ACIMA do <Outlet />: erros lançados no próprio resolvedor de rotas
// (MatchInnerImpl — ex.: chunk obsoleto ou throw sem Error) não passam pelo
// errorComponent da rota e derrubavam a árvore inteira, deixando tela branca.
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown; hasError: boolean }
> {
  state = { error: undefined as unknown, hasError: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <RouteErrorFallback
          error={this.state.error}
          reset={() => this.setState({ error: undefined, hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}
