INSERT INTO public.monitored_assets (name, pair, active, timeframes) VALUES
('Bitcoin','BTCUSDT',true,ARRAY['1m','5m','15m','1h','4h','1d']),
('Ethereum','ETHUSDT',true,ARRAY['1m','5m','15m','1h','4h','1d']),
('BNB','BNBUSDT',true,ARRAY['5m','15m','1h','4h','1d']),
('Solana','SOLUSDT',true,ARRAY['5m','15m','1h','4h','1d']),
('XRP','XRPUSDT',true,ARRAY['15m','1h','4h','1d']),
('Cardano','ADAUSDT',true,ARRAY['15m','1h','4h','1d'])
ON CONFLICT DO NOTHING;