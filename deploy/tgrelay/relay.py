#!/usr/bin/env python3
"""Ретранслятор Telegram Bot API с очередью (seochron, Франкфурт).

Зачем: с сервера сайта в России api.telegram.org доступен не всегда. Сайт шлёт
запросы Bot API сюда по SSH-туннелю, ретранслятор отдаёт их Telegram. Если
Telegram не отвечает, запрос ждёт в очереди SQLite и уходит позже сам.

Как: POST /bot<токен>/<метод> с тем же телом, что и у Bot API. Если Telegram
ответил за SYNC_WAIT секунд — ответ отдаётся как есть (код и JSON). Иначе
202 {"ok": true, "queued": true, "job": id}, доставка продолжится в фоне
(повторы по расписанию, до GIVE_UP_HOURS). GET-методы (getMe …) проксируются
без очереди. GET /health — состояние очереди. Токены в лог не пишутся.
Только стандартная библиотека.
"""
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN = os.environ.get('TGRELAY_LISTEN', '127.0.0.1:8787')
DB = os.environ.get('TGRELAY_DB', '/var/lib/tgrelay/queue.db')
UPSTREAM = os.environ.get('TGRELAY_UPSTREAM', 'https://api.telegram.org').rstrip('/')
SYNC_WAIT = float(os.environ.get('TGRELAY_SYNC_WAIT', '6'))
TIMEOUT = float(os.environ.get('TGRELAY_TIMEOUT', '15'))
GIVE_UP_HOURS = float(os.environ.get('TGRELAY_GIVE_UP_HOURS', '48'))
KEEP_DAYS = 7
BACKOFF = [10, 30, 120, 300, 900, 1800, 3600]  # секунды между повторами

_lock = threading.Lock()
_wake = threading.Event()
_results = {}  # job id → (status, body) для ответа ждущему запросу
_done_events = {}  # job id → Event


def log(msg):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), msg, flush=True)


def db():
    conn = sqlite3.connect(DB, timeout=10, isolation_level=None)
    conn.execute('pragma journal_mode=wal')
    conn.execute(
        'create table if not exists jobs (id integer primary key autoincrement, created real, token text, method text, '
        'body blob, ctype text, attempts integer default 0, next_at real, status text, last_code integer, last_body text, done_at real)'
    )
    conn.execute('create index if not exists jobs_due on jobs (status, next_at)')
    return conn


def upstream(token, method, body, ctype):
    """Один запрос к Telegram. Возвращает (код, тело-байты); сетевая ошибка → (0, текст)."""
    req = urllib.request.Request(f'{UPSTREAM}/bot{token}/{method}', data=body, method='POST' if body is not None else 'GET')
    if ctype:
        req.add_header('Content-Type', ctype)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001 — любая сетевая беда = повтор
        return 0, str(e).encode()


def final(code, body):
    """Ответ окончательный? 2xx и 4xx (кроме 429) — да; 0, 5xx, 429 — повторить."""
    return code != 0 and code != 429 and code < 500


def retry_after(code, body):
    if code == 429:
        try:
            return float(json.loads(body).get('parameters', {}).get('retry_after', 5))
        except Exception:  # noqa: BLE001
            return 5
    return None


def worker():
    conn = db()
    while True:
        _wake.wait(timeout=5)
        _wake.clear()
        now = time.time()
        rows = conn.execute('select id, token, method, body, ctype, attempts, created from jobs where status=? and next_at<=? order by id limit 20', ('pending', now)).fetchall()
        for jid, token, method, body, ctype, attempts, created in rows:
            code, out = upstream(token, method, body, ctype)
            attempts += 1
            if final(code, out):
                conn.execute('update jobs set status=?, attempts=?, last_code=?, last_body=?, done_at=? where id=?', ('done' if code < 300 else 'rejected', attempts, code, out[:2000].decode('utf-8', 'replace'), time.time(), jid))
                log(f'job {jid} {method}: {code} после {attempts} попыт.')
            elif time.time() - created > GIVE_UP_HOURS * 3600:
                conn.execute('update jobs set status=?, attempts=?, last_code=?, last_body=?, done_at=? where id=?', ('failed', attempts, code, out[:500].decode('utf-8', 'replace'), time.time(), jid))
                log(f'job {jid} {method}: сдаюсь после {attempts} попыт. (код {code})')
            else:
                wait = retry_after(code, out) or BACKOFF[min(attempts - 1, len(BACKOFF) - 1)]
                conn.execute('update jobs set attempts=?, next_at=?, last_code=?, last_body=? where id=?', (attempts, time.time() + wait, code, out[:500].decode('utf-8', 'replace'), jid))
                log(f'job {jid} {method}: код {code}, повтор через {int(wait)} с (попытка {attempts})')
            with _lock:
                _results[jid] = (code, out)
                ev = _done_events.get(jid)
            if ev:
                ev.set()
        # уборка
        if int(now) % 600 < 5:
            conn.execute('delete from jobs where status in (?, ?, ?) and done_at < ?', ('done', 'rejected', 'failed', now - KEEP_DAYS * 86400))


class Handler(BaseHTTPRequestHandler):
    server_version = 'tgrelay/1.0'

    def log_message(self, fmt, *args):  # без токенов в логе
        pass

    def _send(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) >= 2 and parts[0].startswith('bot'):
            return parts[0][3:], '/'.join(parts[1:])
        return None, None

    def do_GET(self):
        if self.path == '/health':
            conn = db()
            pending = conn.execute("select count(*) from jobs where status='pending'").fetchone()[0]
            failed = conn.execute("select count(*) from jobs where status='failed'").fetchone()[0]
            last = conn.execute("select max(done_at) from jobs where status='done'").fetchone()[0]
            conn.close()
            return self._send(200, json.dumps({'ok': True, 'pending': pending, 'failed': failed, 'last_ok': last, 'upstream': UPSTREAM}).encode())
        token, method = self._route()
        if not token:
            return self._send(404, b'{"ok":false,"description":"not found"}')
        code, out = upstream(token, method, None, None)
        return self._send(code or 502, out if code else json.dumps({'ok': False, 'description': 'relay: no connection to Telegram'}).encode())

    def do_POST(self):
        token, method = self._route()
        if not token:
            return self._send(404, b'{"ok":false,"description":"not found"}')
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        ctype = self.headers.get('Content-Type') or 'application/json'
        conn = db()
        cur = conn.execute('insert into jobs (created, token, method, body, ctype, attempts, next_at, status) values (?,?,?,?,?,0,?,?)', (time.time(), token, method, body, ctype, time.time(), 'pending'))
        jid = cur.lastrowid
        conn.close()
        ev = threading.Event()
        with _lock:
            _done_events[jid] = ev
        _wake.set()
        got = ev.wait(SYNC_WAIT)
        with _lock:
            res = _results.pop(jid, None)
            _done_events.pop(jid, None)
        if got and res and final(res[0], res[1]):
            return self._send(res[0], res[1])
        return self._send(202, json.dumps({'ok': True, 'queued': True, 'job': jid}).encode())


def main():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    db().close()
    threading.Thread(target=worker, daemon=True, name='worker').start()
    host, port = LISTEN.rsplit(':', 1)
    srv = ThreadingHTTPServer((host, int(port)), Handler)
    log(f'tgrelay слушает {LISTEN}, очередь {DB}, upstream {UPSTREAM}')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
