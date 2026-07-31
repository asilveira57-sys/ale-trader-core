# Conector MT5 → Lovable: cliente HTTP resiliente (referência)
#
# Cole este módulo no conector local (não altera a ponte MT5 nem a leitura de tick).
# Aplica: timeout de conexão e leitura separados, tentativas limitadas,
# backoff progressivo, circuit breaker com health check e descarte de backlog.
#
# Endpoints:
#   POST /api/public/hooks/b3-mt5sim-tick-ingest   (assinado HMAC-SHA256 do corpo cru)
#   GET  /api/public/hooks/health                  (leve, sem banco)

import hashlib
import hmac
import json
import time
import requests

BASE = "https://ale-trader-core.lovable.app"
INGEST = f"{BASE}/api/public/hooks/b3-mt5sim-tick-ingest"
HEALTH = f"{BASE}/api/public/hooks/health"

# (connect timeout, read timeout)
TIMEOUT = (3.0, 4.0)
MAX_ATTEMPTS = 2                  # tentativas por tick (sem fila infinita)
BACKOFF = [0.25, 0.75]            # backoff progressivo entre tentativas
BREAKER_THRESHOLD = 5             # falhas consecutivas para abrir o circuito
BREAKER_COOLDOWN = 20.0           # pausa antes de testar a saúde do servidor

_session = requests.Session()
_fail_streak = 0
_breaker_until = 0.0
_last_sent_key = None


def _sign(secret: str, raw: bytes) -> str:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def backend_healthy() -> bool:
    """Health check leve — usado para fechar o circuit breaker."""
    try:
        r = _session.get(HEALTH, timeout=(2.0, 2.0))
        return r.status_code == 200
    except requests.RequestException:
        return False


def backend_available() -> bool:
    """Deve ser consultado ANTES de enviar qualquer ordem.
    Com o circuito aberto o conector não envia novas entradas."""
    global _breaker_until, _fail_streak
    if time.time() < _breaker_until:
        return False
    if _fail_streak >= BREAKER_THRESHOLD:
        if backend_healthy():
            _fail_streak = 0
            return True
        _breaker_until = time.time() + BREAKER_COOLDOWN
        return False
    return True


def send_tick(secret: str, payload: dict) -> bool:
    """Envia 1 tick. Nunca acumula backlog: tick antigo é descartado."""
    global _fail_streak, _breaker_until, _last_sent_key

    if not backend_available():
        return False

    # deduplicação local por símbolo + timestamp + preço
    key = (payload.get("symbol"), payload.get("tick_ts"), payload.get("bid"),
           payload.get("ask"), payload.get("last"))
    if key == _last_sent_key:
        return True

    raw = json.dumps(payload, separators=(",", ":")).encode()
    headers = {"content-type": "application/json", "x-mt5-signature": _sign(secret, raw)}

    for attempt in range(MAX_ATTEMPTS):
        try:
            r = _session.post(INGEST, data=raw, headers=headers, timeout=TIMEOUT)
            if r.status_code == 200:
                _fail_streak = 0
                _last_sent_key = key
                return True
            if 400 <= r.status_code < 500:
                # erro de payload/assinatura: não insistir
                return False
        except requests.RequestException:
            pass
        if attempt + 1 < MAX_ATTEMPTS:
            time.sleep(BACKOFF[min(attempt, len(BACKOFF) - 1)])

    _fail_streak += 1
    if _fail_streak >= BREAKER_THRESHOLD:
        _breaker_until = time.time() + BREAKER_COOLDOWN
    return False  # tick descartado — o próximo tick substitui o anterior
