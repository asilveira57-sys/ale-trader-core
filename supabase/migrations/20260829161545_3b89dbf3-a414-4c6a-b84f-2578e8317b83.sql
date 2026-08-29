ALTER TABLE public.b3_simulation_mode_settings
  DROP CONSTRAINT IF EXISTS b3_simulation_mode_settings_entry_style_check;

ALTER TABLE public.b3_simulation_mode_settings
  ADD CONSTRAINT b3_simulation_mode_settings_entry_style_check
  CHECK (entry_style = ANY (ARRAY['indicador','price_action','mean_reversion','range','rompimento','pullback','vwap']));