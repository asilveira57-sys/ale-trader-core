// Campos e rótulos da configuração por robô — módulo puro, seguro no cliente.
export const B3_ROBOT_MODES = [
  "conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo",
] as const;
export type B3RobotMode = (typeof B3_ROBOT_MODES)[number];

// Campos editáveis pela tela por robô. daily_loss_limit_brl fica FORA:
// é derivado por gatilho no banco (3 × stop × valor do ponto × contratos).
export const B3_ROBOT_EDITABLE_FIELDS = [
  // Entrada
  "min_confidence", "min_score", "min_approve_votes", "max_volatility_pct",
  "lateral_strength_min", "lateral_vol_min",
  // Operação
  "stop_pts", "gain_pts", "max_contracts",
  // Trailing
  "trailing_mode", "trailing_activation_pts", "trailing_giveback_pts",
  // Proteção
  "daily_gain_target_brl", "minimum_trades_before_profit_lock",
  "profit_multiplier_before_lock", "post_target_allowed_retracement",
  "consecutive_loss_after_target", "post_target_size_reduction",
  // Horários
  "trading_start_time", "entry_cutoff_time", "force_close_time",
  // Liga/desliga
  "enabled",
] as const;
export type B3RobotEditableField = (typeof B3_ROBOT_EDITABLE_FIELDS)[number];

export const B3_ROBOT_FIELD_LABEL: Record<string, string> = {
  min_confidence: "Confiança mínima (%)",
  min_score: "Score mínimo",
  min_approve_votes: "Votos mínimos de aprovação",
  max_volatility_pct: "Volatilidade máxima (%)",
  lateral_strength_min: "Força de tendência mínima",
  lateral_vol_min: "Volatilidade mínima (%)",
  stop_pts: "Stop (pontos)",
  gain_pts: "Alvo (pontos)",
  max_contracts: "Contratos",
  trailing_mode: "Tipo de trailing",
  trailing_activation_pts: "Ativação do trailing (pontos)",
  trailing_giveback_pts: "Recuo permitido do pico (pontos)",
  daily_gain_target_brl: "Meta diária de ganho (R$)",
  minimum_trades_before_profit_lock: "Operações mínimas antes do lock",
  profit_multiplier_before_lock: "Multiplicador da meta",
  post_target_allowed_retracement: "Devolução permitida pós-meta",
  consecutive_loss_after_target: "Perdas consecutivas pós-meta",
  post_target_size_reduction: "Redução de tamanho pós-meta",
  trading_start_time: "Início das entradas",
  entry_cutoff_time: "Corte de entradas",
  force_close_time: "Zeragem obrigatória",
  enabled: "Robô ligado",
};

