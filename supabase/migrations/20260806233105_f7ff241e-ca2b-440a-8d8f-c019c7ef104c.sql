INSERT INTO public.b3_asset_profiles
  (symbol, quote_symbol, contract_code, display_name, asset_class, tick_size, tick_value_brl, base_price_fallback, trading_calendar)
VALUES
  ('PETR4', 'PETR4', 'PETR4', 'Petrobras PN', 'acao', 0.01, 1.00, 42.88, 'b3_equities'),
  ('VALE3', 'VALE3', 'VALE3', 'Vale ON', 'acao', 0.01, 1.00, 74.24, 'b3_equities')
ON CONFLICT (symbol) DO NOTHING;