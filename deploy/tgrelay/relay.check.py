#!/usr/bin/env python3
"""Проверка relay.py без сети: поддельный Telegram на 127.0.0.1, ретранслятор отдельным процессом.

Запуск: python3 deploy/tgrelay/relay.check.py → «ok: N проверок», код 0.
Временная база и лог — в TMPDIR, по окончании удаляются. К api.telegram.org
не обращается. Только стандартная библиотека.
"""
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = '123456789:CHECK-relay-secret-Token_xyz'
LONG_TEXT = 'Заказ №42: ' + 'борщ, пельмени, компот; ' * 140  # > 2000 символов
NO_CONN = {'ok': False, 'description': 'relay: no connection to Telegram'}
# свои запросы — мимо системного прокси
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

passed = 0


def ok(cond, what):
    """assert со счётчиком: работает и под python3 -O."""
    global passed
    if not cond:
        raise AssertionError(what)
    passed += 1


# ---------- поддельный Telegram ----------

class Fake:
    mode = 'up'  # up | hang (молчит дольше TIMEOUT) | drop (рвёт соединение без ответа)
    seen = []  # (HTTP-метод, путь, строка запроса, тело, Content-Type)
    sent = {}  # метод Bot API → последнее отданное тело
    next_id = 100
    lock = threading.Lock()


class FakeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _handle(self, verb):
        path, _, query = self.path.partition('?')
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        with Fake.lock:
            Fake.seen.append((verb, path, query, body, self.headers.get('Content-Type')))
            mode = Fake.mode
        if mode == 'drop':
            return  # HTTP/1.0: соединение закроется без ответа
        if mode == 'hang':
            time.sleep(3.5)
            return
        try:
            data = json.loads(body) if body else {}
        except ValueError:
            data = {}
        method = path.rsplit('/', 1)[-1]
        code = 200
        if method == 'sendMessage':
            with Fake.lock:
                Fake.next_id += 1
                mid = Fake.next_id
            out = {'ok': True, 'result': {'message_id': mid, 'chat': {'id': data.get('chat_id')}, 'date': int(time.time()), 'text': data.get('text')}}
        elif method == 'getUpdates':
            time.sleep(float(data.get('timeout') or 0) + 1.5)  # дольше TIMEOUT ретранслятора
            out = {'ok': True, 'result': [{'update_id': int(data.get('offset') or 0), 'callback_query': {'id': 'cb1', 'data': 'order:7:accept'}}]}
        elif method == 'answerCallbackQuery':
            if data.get('callback_query_id') == 'old':
                code, out = 400, {'ok': False, 'error_code': 400, 'description': 'Bad Request: query is too old'}
            else:
                out = {'ok': True, 'result': True}
        elif method == 'getMe':
            out = {'ok': True, 'result': {'id': 123456789, 'is_bot': True, 'username': 'check_bot'}}
        else:
            code, out = 404, {'ok': False, 'error_code': 404, 'description': 'Not Found'}
        raw = json.dumps(out, ensure_ascii=False).encode()
        with Fake.lock:
            Fake.sent[method] = raw
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._handle('GET')

    def do_POST(self):
        self._handle('POST')


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):  # обрыв со стороны ретранслятора — штатно
        pass


# ---------- клиент ----------

def call(base, verb, path, data=None, ctype='application/json', timeout=30):
    req = urllib.request.Request(base + path, data=data, method=verb)
    if data is not None:
        req.add_header('Content-Type', ctype)
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run(relay, dbfile):
    def post(method, payload, ctype='application/json'):
        return call(relay, 'POST', f'/bot{TOKEN}/{method}', json.dumps(payload, ensure_ascii=False).encode(), ctype)

    def sql(query, args=()):
        conn = sqlite3.connect(dbfile)
        try:
            return conn.execute(query, args).fetchone()[0]
        finally:
            conn.close()

    def jobs_count(where, args=()):
        return sql('select count(*) from jobs where ' + where, args)

    def pending():
        code, raw = call(relay, 'GET', '/health')
        ok(code == 200, f'/health → {code}')
        return json.loads(raw)['pending']

    def last_seen(path):
        with Fake.lock:
            hits = [s for s in Fake.seen if s[1] == path]
        return hits[-1] if hits else None

    def job(jid):
        code, raw = call(relay, 'GET', f'/bot{TOKEN}/jobs/{jid}')
        return code, json.loads(raw)

    # 1. sendMessage, Telegram жив → 200 и тело фейка как есть
    ctype = 'application/json; charset=utf-8'
    code, raw = post('sendMessage', {'chat_id': -100500, 'text': LONG_TEXT}, ctype)
    ok(code == 200, f'sendMessage (жив) → {code}: {raw[:200]!r}')
    ok(raw == Fake.sent['sendMessage'], 'sendMessage (жив): тело не совпадает с ответом фейка')
    mid = json.loads(raw)['result']['message_id']
    hit = last_seen(f'/bot{TOKEN}/sendMessage')
    ok(hit and hit[0] == 'POST' and hit[4] == ctype, f'sendMessage: фейк получил {hit and hit[:3]} / {hit and hit[4]}')
    # то же задание видно в /jobs, текст длиннее 2000 символов не обрезан
    jid = sql("select max(id) from jobs where method='sendMessage'")
    ok(isinstance(jid, int), 'sendMessage (жив): задания нет в базе')
    code, j = job(jid)
    ok(code == 200 and j['status'] == 'done' and j['last_code'] == 200, f'/jobs/{jid} → {code} {j}')
    ok(set(j) == {'id', 'status', 'attempts', 'last_code', 'result'}, f'/jobs: лишние/нет полей {sorted(j)}')
    ok(j['id'] == jid and j['attempts'] == 1, f'/jobs/{jid}: id/attempts {j["id"]}/{j["attempts"]}')
    ok(j['result']['result']['message_id'] == mid, '/jobs: message_id не совпадает')
    ok(len(LONG_TEXT) > 2000 and j['result']['result']['text'] == LONG_TEXT, '/jobs: длинный текст обрезан')

    # 2. getUpdates, Telegram жив → без очереди, долгий опрос дольше TIMEOUT
    before = jobs_count('1=1')
    body = json.dumps({'timeout': 1, 'allowed_updates': ['callback_query'], 'offset': 7}).encode()
    t0 = time.time()
    code, raw = call(relay, 'POST', f'/bot{TOKEN}/getUpdates', body)
    took = time.time() - t0
    ok(code == 200, f'getUpdates → {code}: {raw[:200]!r}')
    ok(raw == Fake.sent['getUpdates'], 'getUpdates: тело не совпадает с ответом фейка')
    ok(took >= 2.5, f'getUpdates вернулся за {took:.1f} с — фейк должен был думать 2.5 с')
    hit = last_seen(f'/bot{TOKEN}/getUpdates')
    ok(hit and hit[0] == 'POST' and hit[3] == body and hit[4] == 'application/json', f'getUpdates: фейк получил {hit and hit[:3]}')
    ok(pending() == 0, 'getUpdates: в /health pending не 0')
    ok(jobs_count('1=1') == before and jobs_count("method='getUpdates'") == 0, 'getUpdates попал в очередь')

    # 3. answerCallbackQuery, Telegram жив → код и тело как есть (в т. ч. 400)
    code, raw = post('answerCallbackQuery', {'callback_query_id': 'cb1', 'text': 'Принят'})
    ok(code == 200 and raw == Fake.sent['answerCallbackQuery'], f'answerCallbackQuery → {code}: {raw!r}')
    code, raw = post('answerCallbackQuery', {'callback_query_id': 'old'})
    ok(code == 400 and raw == Fake.sent['answerCallbackQuery'], f'answerCallbackQuery (400) → {code}: {raw!r}')
    ok(jobs_count("method='answerCallbackQuery'") == 0, 'answerCallbackQuery попал в очередь')

    # 4. GET сохраняет строку запроса
    code, raw = call(relay, 'GET', f'/bot{TOKEN}/getMe?x=1')
    ok(code == 200 and raw == Fake.sent['getMe'], f'getMe?x=1 → {code}: {raw!r}')
    hit = last_seen(f'/bot{TOKEN}/getMe')
    ok(hit and hit[0] == 'GET' and hit[2] == 'x=1', f'getMe: фейк получил строку запроса {hit and hit[2]!r}')

    # 5. неизвестное задание
    for bad in ('999999', 'abc', '0', '9' * 30):
        code, raw = call(relay, 'GET', f'/bot{TOKEN}/jobs/{bad}')
        ok(code == 404 and json.loads(raw) == {'ok': False, 'description': 'not found'}, f'/jobs/{bad} → {code}: {raw!r}')

    # 5а. чужой токен задание не видит
    code, raw = call(relay, 'GET', f'/bot000:OTHER-token/jobs/{jid}')
    ok(code == 404, f'/jobs чужим токеном → {code}')

    # 6. Telegram рвёт соединение → сквозные методы 502 сразу, в очереди ничего
    Fake.mode = 'drop'
    code, raw = post('answerCallbackQuery', {'callback_query_id': 'cb2'})
    ok(code == 502 and json.loads(raw) == NO_CONN, f'answerCallbackQuery (drop) → {code}: {raw!r}')
    code, raw = post('getUpdates', {'timeout': 1})
    ok(code == 502 and json.loads(raw) == NO_CONN, f'getUpdates (drop) → {code}: {raw!r}')
    ok(jobs_count("method in ('answerCallbackQuery', 'getUpdates')") == 0 and pending() == 0, 'сквозной метод при обрыве попал в очередь')

    # 7. Telegram молчит → sendMessage в очередь (202), answerCallbackQuery — 502 через TIMEOUT
    Fake.mode = 'hang'
    code, raw = post('sendMessage', {'chat_id': -100500, 'text': 'Новый заказ №43'})
    ok(code == 202, f'sendMessage (молчит) → {code}: {raw!r}')
    q = json.loads(raw)
    ok(q.get('ok') is True and q.get('queued') is True and isinstance(q.get('job'), int), f'sendMessage (молчит): {q}')
    qid = q['job']
    code, j = job(qid)
    ok(code == 200 and j['status'] == 'pending', f'/jobs/{qid} сразу после 202 → {code} {j}')
    t0 = time.time()
    code, raw = post('answerCallbackQuery', {'callback_query_id': 'cb3'})
    took = time.time() - t0
    ok(code == 502 and json.loads(raw) == NO_CONN, f'answerCallbackQuery (молчит) → {code}: {raw!r}')
    ok(1.5 <= took < 3.4, f'answerCallbackQuery (молчит) ждал {took:.1f} с вместо TIMEOUT=2')
    ok(jobs_count("method='answerCallbackQuery'") == 0, 'answerCallbackQuery (молчит) попал в очередь')
    ok(pending() == 1, 'в очереди должно быть ровно одно задание')

    # 8. Telegram ожил → задание доставлено повтором, в /jobs есть message_id
    Fake.mode = 'up'
    deadline = time.time() + 25
    while time.time() < deadline:
        code, j = job(qid)
        if j.get('status') != 'pending':
            break
        time.sleep(0.5)
    ok(j.get('status') == 'done' and j['last_code'] == 200, f'/jobs/{qid} после оживления → {j}')
    ok(j['attempts'] >= 2, f'/jobs/{qid}: попыток {j["attempts"]}, ждали ≥ 2')
    ok(isinstance(j['result']['result']['message_id'], int) and j['result']['result']['message_id'] == json.loads(Fake.sent['sendMessage'])['result']['message_id'], f'/jobs/{qid}: message_id {j["result"]}')
    ok(j['result']['result']['text'] == 'Новый заказ №43', '/jobs: текст отложенного сообщения')
    ok(pending() == 0, 'после доставки очередь не пуста')


def main():
    tmp = tempfile.mkdtemp(prefix='tgrelay-check-')
    dbfile = os.path.join(tmp, 'queue.db')
    logfile = os.path.join(tmp, 'relay.log')
    fake = QuietServer(('127.0.0.1', 0), FakeHandler)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    port = free_port()
    relay = f'http://127.0.0.1:{port}'
    env = {k: v for k, v in os.environ.items() if k.lower() not in ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')}
    env.update({
        'TGRELAY_LISTEN': f'127.0.0.1:{port}',
        'TGRELAY_UPSTREAM': f'http://127.0.0.1:{fake.server_address[1]}',
        'TGRELAY_DB': dbfile,
        'TGRELAY_SYNC_WAIT': '1',
        'TGRELAY_TIMEOUT': '2',
        'TGRELAY_BACKOFF': '1,2',
        'PYTHONUNBUFFERED': '1',
    })
    out = open(logfile, 'wb')
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, 'relay.py')], env=env, stdout=out, stderr=subprocess.STDOUT)
    failed = None
    try:
        deadline = time.time() + 10
        while True:
            try:
                if call(relay, 'GET', '/health', timeout=1)[0] == 200:
                    break
            except OSError:
                pass
            if time.time() > deadline or proc.poll() is not None:
                raise AssertionError('ретранслятор не поднялся')
            time.sleep(0.1)
        run(relay, dbfile)
    except AssertionError as e:
        failed = str(e)
    except Exception as e:  # noqa: BLE001 — неожиданный ответ тоже провал, а не трейсбек
        failed = f'{type(e).__name__}: {e}'
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        out.close()
        fake.shutdown()
        fake.server_close()
        with open(logfile, 'rb') as f:
            captured = f.read()
        shutil.rmtree(tmp, ignore_errors=True)
    if not failed:
        try:
            ok(b'tgrelay' in captured, 'вывод ретранслятора не захвачен')
            ok(TOKEN.encode() not in captured and TOKEN.split(':')[1].encode() not in captured, 'токен попал в вывод ретранслятора')
        except AssertionError as e:
            failed = str(e)
    if failed:
        print(f'FAIL после {passed} проверок: {failed}')
        print('--- вывод ретранслятора ---')
        print(captured.decode('utf-8', 'replace').replace(TOKEN, '<token>'))
        return 1
    print(f'ok: {passed} проверок')
    return 0


if __name__ == '__main__':
    sys.exit(main())
