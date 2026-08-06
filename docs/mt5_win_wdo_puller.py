# Puller local — MetaTrader 5 XP (XPMT5-PRD) → WIN + WDO + PETR4 + VALE3
# pip install MetaTrader5 requests
#
# Mudanças em relação à versão anterior (mt5_winq26_puller.py):
#   1) Passa a puxar múltiplos símbolos no mesmo loop — um POST pra cada,
#      a cada ciclo — não precisa de um script separado por ativo.
#   2) O segredo NÃO fica mais escrito no arquivo. Lê de variável de
#      ambiente (B3_MT5SIM_INGEST_SECRET) — troque o valor no seu sistema,
#      nunca deixe a chave em texto puro dentro do .py de novo.
#   3) PETR4/VALE3 são ações — símbolo fixo, não muda todo mês como WDO.

import MetaTrader5 as mt5, requests, json, hmac, hashlib, time, os
from datetime import datetime, timezone

USER_ID = "4974847b-db2c-44d3-adc9-4523b1c7ba1b"
SYMBOLS = ["WINQ26", "WDOU26", "PETR4", "VALE3"]
ENDPOINT = "https://ale-trader-core.lovable.app/api/public/hooks/b3-mt5sim-tick-ingest"

# Nunca escreva o segredo direto aqui. Defina antes de rodar:
#   set B3_MT5SIM_INGEST_SECRET=seu_valor_novo   (Windows, no mesmo prompt)
SECRET = os.environ["B3_MT5SIM_INGEST_SECRET"]

# Caminho do terminal DEMO — necessário informar explicitamente porque
# agora existem 2 terminais MT5 abertos ao mesmo tempo (demo e real); sem
# isso, o mt5.initialize() poderia se conectar no terminal errado.
MT5_DEMO_PATH = r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe"

assert mt5.initialize(path=MT5_DEMO_PATH), mt5.last_error()
for sym in SYMBOLS:
    if not mt5.symbol_select(sym, True):
        print(f"[aviso] não consegui selecionar {sym} — confira se o símbolo existe "
              f"exatamente com esse nome na aba 'Observação do Mercado' do MT5 "
              f"(clique direito → Mostrar Todos, ou adicione manualmente).")

def send_tick(symbol: str):
    t = mt5.symbol_info_tick(symbol)
    info = mt5.symbol_info(symbol)
    acc = mt5.account_info()
    if not t or not info:
        return
    payload = {
        "user_id": USER_ID, "symbol": symbol,
        "bid": t.bid, "ask": t.ask, "last": t.last,
        "spread": (t.ask - t.bid) if (t.bid and t.ask) else None,
        "volume": t.volume, "symbol_status": "ok",
        "mt5_connected": True, "server": acc.server if acc else "XPMT5-PRD",
        "account_masked": (str(acc.login)[-4:].rjust(len(str(acc.login)), "*")) if acc else None,
        "tick_ts": datetime.now(timezone.utc).isoformat(),
    }
    body = json.dumps(payload, separators=(",", ":"))
    sig = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    try:
        r = requests.post(ENDPOINT, data=body, headers={"content-type": "application/json", "x-mt5-signature": sig}, timeout=5)
        print(symbol, r.status_code, r.text[:120])
    except Exception as e:
        print(symbol, "erro", e)

while True:
    for sym in SYMBOLS:
        send_tick(sym)
    time.sleep(1)
