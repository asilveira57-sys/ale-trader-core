// B3-only: Flexibilização Inteligente dos Bloqueios Diários.
// Isolado do módulo Binance. Não usar em cripto.

export type B3ProtectionState =
  | "operating_normal"
  | "target_reached_observing"
  | "profit_protected"
  | "blocked_stop"
  | "blocked_drawdown"
  | "blocked_volatility"
  | "blocked_ops_failure"
  | "blocked_post_target_loss";

export interface B3ProtectionSettings {
  minimum_trades_before_profit_lock: number;
  minimum_operating_minutes: number;
  profit_multiplier_before_lock: number;      // ex: 2.0 → alvo × 2
  post_target_allowed_retracement: number;    // ex: 0.30 → 30%
  consecutive_loss_after_target: number;
  post_target_size_reduction: number;         // ex: 0.50 → size × 0.5
  daily_loss_limit_brl: number;
  daily_gain_target_brl: number;
  max_volatility_pct: number;
}

export interface B3ProtectionRuntime {
  protection_state: B3ProtectionState;
  target_reached_at: string | null;
  profit_at_target_brl: number | null;
  trades_at_target: number | null;
  peak_profit_after_target_brl: number;
  profit_after_target_brl: number;
  trades_after_target: number;
  consecutive_losses_after_target: number;
  protection_block_reason: string | null;
}

export interface B3ProtectionInput {
  realized_today_brl: number;
  total_trades_today: number;
  operating_minutes_today: number;
  volatility_pct: number;
  ops_failure?: string | null; // erro API / rejeição / ausência confirmação
  drawdown_hit?: boolean;
  now_iso: string;
}

export interface B3ProtectionDecision {
  next: B3ProtectionRuntime;
  size_multiplier: number;         // aplicar no qty de novas entradas
  allow_new_entry: boolean;
  transition?: {
    from: B3ProtectionState;
    to: B3ProtectionState;
    reason: string;
  };
}

/**
 * Motor de proteção diária B3.
 * NUNCA aumenta risco. Apenas evita bloqueio prematuro na meta e reduz size
 * automaticamente após a meta. Stop diário permanece soberano.
 */
export function evaluateB3Protection(
  current: B3ProtectionRuntime,
  cfg: B3ProtectionSettings,
  input: B3ProtectionInput,
): B3ProtectionDecision {
  const prev = current.protection_state;
  const next: B3ProtectionRuntime = { ...current };

  // 1) Stop diário — soberano.
  if (input.realized_today_brl <= -Math.abs(cfg.daily_loss_limit_brl)) {
    next.protection_state = "blocked_stop";
    next.protection_block_reason = `Stop diário atingido (${input.realized_today_brl.toFixed(2)} BRL).`;
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  // 2) Falha operacional (API, rejeição, confirmação).
  if (input.ops_failure) {
    next.protection_state = "blocked_ops_failure";
    next.protection_block_reason = input.ops_failure;
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  // 3) Volatilidade extrema.
  if (input.volatility_pct > cfg.max_volatility_pct * 1.5) {
    next.protection_state = "blocked_volatility";
    next.protection_block_reason = `Volatilidade extrema (${input.volatility_pct.toFixed(2)}%).`;
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  // 4) Drawdown máximo.
  if (input.drawdown_hit) {
    next.protection_state = "blocked_drawdown";
    next.protection_block_reason = "Drawdown máximo atingido.";
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  const target = Math.abs(cfg.daily_gain_target_brl);
  const targetReached = target > 0 && input.realized_today_brl >= target;
  const enoughTrades = input.total_trades_today >= cfg.minimum_trades_before_profit_lock;
  const enoughTime = input.operating_minutes_today >= cfg.minimum_operating_minutes;

  // Se ainda não atingiu meta OU não atende trades/tempo mínimos → operando normal.
  if (!targetReached || (!enoughTrades && !enoughTime)) {
    next.protection_state = "operating_normal";
    next.protection_block_reason = null;
    return {
      next, size_multiplier: 1, allow_new_entry: true,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: "Operando normal." }
        : undefined,
    };
  }

  // Meta batida — inicia proteção se ainda não tinha marcado.
  if (!next.target_reached_at) {
    next.target_reached_at = input.now_iso;
    next.profit_at_target_brl = input.realized_today_brl;
    next.trades_at_target = input.total_trades_today;
    next.peak_profit_after_target_brl = input.realized_today_brl;
    next.profit_after_target_brl = 0;
    next.trades_after_target = 0;
    next.consecutive_losses_after_target = 0;
  }

  // Atualiza métricas pós-meta.
  const extra = input.realized_today_brl - Number(next.profit_at_target_brl ?? 0);
  next.profit_after_target_brl = extra;
  next.peak_profit_after_target_brl = Math.max(
    Number(next.peak_profit_after_target_brl ?? 0),
    input.realized_today_brl,
  );

  const peakExtra = Number(next.peak_profit_after_target_brl ?? 0) - Number(next.profit_at_target_brl ?? 0);
  const givenBack = Math.max(0, peakExtra - extra);
  const retracementLimit = peakExtra > 0 ? peakExtra * cfg.post_target_allowed_retracement : 0;

  // Bloqueio pós-meta: devolveu mais que o permitido.
  if (peakExtra > 0 && givenBack > retracementLimit) {
    next.protection_state = "blocked_post_target_loss";
    next.protection_block_reason = `Devolveu ${givenBack.toFixed(2)} BRL do lucro pós-meta (limite ${retracementLimit.toFixed(2)} BRL).`;
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  // Bloqueio pós-meta: perdas consecutivas.
  if (next.consecutive_losses_after_target >= cfg.consecutive_loss_after_target) {
    next.protection_state = "blocked_post_target_loss";
    next.protection_block_reason = `${next.consecutive_losses_after_target} perdas consecutivas após a meta.`;
    return {
      next, size_multiplier: 0, allow_new_entry: false,
      transition: prev !== next.protection_state
        ? { from: prev, to: next.protection_state, reason: next.protection_block_reason }
        : undefined,
    };
  }

  // Continua operando com risco reduzido.
  const protectedProfit = input.realized_today_brl >= target * Math.max(1, cfg.profit_multiplier_before_lock);
  next.protection_state = protectedProfit ? "profit_protected" : "target_reached_observing";
  next.protection_block_reason = null;

  const sizeMul = Math.min(1, Math.max(0.05, cfg.post_target_size_reduction));

  return {
    next,
    size_multiplier: protectedProfit ? Math.max(0.05, sizeMul * 0.7) : sizeMul,
    allow_new_entry: true,
    transition: prev !== next.protection_state
      ? { from: prev, to: next.protection_state, reason: "Proteção pós-meta ativa." }
      : undefined,
  };
}

/**
 * Reset diário — chamar no primeiro tick após virada de dia (BRT).
 * Retorna o estado zerado; o caller deve gravar snapshot do dia anterior antes.
 */
export function resetB3ProtectionForNewDay(): Partial<B3ProtectionRuntime> {
  return {
    protection_state: "operating_normal",
    target_reached_at: null,
    profit_at_target_brl: null,
    trades_at_target: null,
    peak_profit_after_target_brl: 0,
    profit_after_target_brl: 0,
    trades_after_target: 0,
    consecutive_losses_after_target: 0,
    protection_block_reason: null,
  };
}

export function b3DayKeyBRT(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
