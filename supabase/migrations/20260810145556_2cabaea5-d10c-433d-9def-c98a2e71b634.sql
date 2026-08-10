ALTER TABLE b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS entry_style text NOT NULL DEFAULT 'indicador'
    CHECK (entry_style IN ('indicador', 'price_action'));