
INSERT INTO robot_settings (
  id, status, mode, collect_frequency_seconds, active_timeframes,
  rate_limit_per_minute, binance_mock_mode, updated_at,
  max_per_trade, max_per_asset, max_portfolio_exposure,
  daily_loss_limit, weekly_loss_limit, monthly_loss_limit, max_loss_streak,
  default_stop_pct, default_take_pct,
  production_assisted_enabled, production_auto_enabled,
  min_score_for_real, require_manual_approval, real_robot_paused
) VALUES (
  1, 'active', 'read', 60, ARRAY['15m','1h','4h','1d'],
  60, true, now(),
  500, 2000, 5000,
  500, 1500, 3000, 5,
  3, 6,
  false, false,
  75, true, false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO binance_connection_status (id, connected, last_check, account_type, permissions)
VALUES (1, true, now(), 'MOCK', ARRAY['READ'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO committee_settings (
  id, min_favor_votes, min_confidence, min_score,
  max_position_value, default_stop_pct, default_target_pct, timeframes, updated_at
) VALUES (
  1, 6, 70, 61,
  1000, 3, 6, ARRAY['15m','1h','4h','1d'], now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulated_wallet (id, initial_balance, current_balance, equity, updated_at)
VALUES (1, 10000, 10000, 10000, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO governance_settings (
  id, automation_enabled, automation_level, min_confidence_score,
  min_score_for_auto, min_consensus_for_auto, min_risk_reward,
  max_consecutive_losses, max_daily_losses, max_weekly_losses, max_drawdown_pct,
  supervisor_enabled, kill_switch_active,
  eligibility_min_days, eligibility_min_trades, eligibility_min_profit_factor,
  created_at, updated_at
) VALUES (
  gen_random_uuid(), true, 1, 70,
  65, 5, 1.5,
  3, 5, 10, 15,
  true, false,
  7, 20, 1.2,
  now(), now()
);

INSERT INTO real_risk_limits (
  id, max_per_trade, max_pct_portfolio, daily_loss_limit,
  weekly_loss_limit, monthly_loss_limit, max_trades_per_day,
  max_open_positions, loss_streak_limit, updated_at
) VALUES (
  1, 500, 20, 500,
  1500, 3000, 10,
  3, 5, now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, name, profile, weight, active, veto_power, created_at, updated_at, kind)
SELECT gen_random_uuid(), a.name, a.profile, a.weight, true, a.veto_power, now(), now(), 'rule'
FROM (VALUES
  ('RSI Divergence', 'RSI-based reversal detection', 1.0, false),
  ('MACD Trend', 'MACD crossover momentum', 1.0, false),
  ('Breakout', 'Support/resistance breakout', 1.0, false),
  ('Volume Spike', 'Volume confirmation filter', 0.8, false),
  ('Smart Money', 'Institutional flow tracker', 1.2, true),
  ('Mean Reversion', 'Bollinger band bounce', 0.9, false),
  ('Sentiment', 'Market sentiment gauge', 0.7, false),
  ('Risk Guard', 'Position sizing & risk veto', 1.5, true)
) AS a(name, profile, weight, veto_power)
WHERE NOT EXISTS (SELECT 1 FROM agents LIMIT 1);
