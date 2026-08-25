import http.server
import socketserver
import os
import webbrowser
import urllib.request
import urllib.parse
import json
import sys
import time
import hmac
import hashlib
import base64
import threading

# Ensure UTF-8 output on Windows consoles
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PORT = int(os.environ.get('PORT', 3000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

ALLOWED_EMAILS = {"jaffadan@gmail.com", "tracy734g@gmail.com"}
AUTH_SECRET = os.environ.get('AUTH_SECRET', 'fantasy-2026-draft-auth-secret-key-12345').encode('utf-8')


def b64url_encode(data_bytes):
    return base64.urlsafe_b64encode(data_bytes).decode('utf-8').rstrip('=')


def b64url_decode(data_str):
    padding = '=' * (4 - (len(data_str) % 4)) if len(data_str) % 4 != 0 else ''
    return base64.urlsafe_b64decode((data_str + padding).encode('utf-8'))


def create_session_token(payload):
    data_bytes = json.dumps(payload).encode('utf-8')
    data_b64 = b64url_encode(data_bytes)
    sig = hmac.new(AUTH_SECRET, data_b64.encode('utf-8'), hashlib.sha256).digest()
    sig_b64 = b64url_encode(sig)
    return f"{data_b64}.{sig_b64}"


def verify_session_token(token):
    if not token or '.' not in token:
        return None
    try:
        data_b64, sig_b64 = token.split('.', 1)
        expected_sig = hmac.new(AUTH_SECRET, data_b64.encode('utf-8'), hashlib.sha256).digest()
        actual_sig = b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(b64url_decode(data_b64).decode('utf-8'))
        if 'exp' in payload and (time.time() * 1000) > payload['exp']:
            return None
        return payload
    except Exception:
        return None


class DraftAppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def parse_cookies(self):
        cookies = {}
        cookie_header = self.headers.get('Cookie')
        if cookie_header:
            for item in cookie_header.split(';'):
                if '=' in item:
                    k, v = item.strip().split('=', 1)
                    cookies[k] = urllib.parse.unquote(v)
        return cookies

    def get_authenticated_user(self):
        cookies = self.parse_cookies()
        token = cookies.get('auth_session')
        if not token:
            return None
        payload = verify_session_token(token)
        if payload and payload.get('email', '').lower() in ALLOWED_EMAILS:
            return payload
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        # 1. Auth Config
        if self.path.startswith('/api/auth/config'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            data = {
                "success": True,
                "googleClientId": os.environ.get('GOOGLE_CLIENT_ID', '816919087026-400mjujbr7cklrmbulggu1jhf0jf03o5.apps.googleusercontent.com'),
                "allowedEmails": list(ALLOWED_EMAILS)
            }
            self.wfile.write(json.dumps(data).encode('utf-8'))
            return

        # 2. Auth Session Check
        if self.path.startswith('/api/auth/me'):
            user = self.get_authenticated_user()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            data = {
                "authenticated": bool(user),
                "user": {
                    "email": user["email"],
                    "name": user.get("name", ""),
                    "picture": user.get("picture", "")
                } if user else None
            }
            self.wfile.write(json.dumps(data).encode('utf-8'))
            return

        # 3. Google Sheets Proxy
        if self.path.startswith('/api/sync-sheet'):
            self.handle_sync_sheet()
            return

        # 4. Gemini Live News Proxy
        if self.path.startswith('/api/player-news'):
            self.handle_player_news()
            return

        # 5. CBS Sports Fantasy Status & Data
        if self.path.startswith('/api/cbs/status'):
            self.handle_cbs_status()
            return

        if self.path.startswith('/api/cbs/data'):
            self.handle_cbs_data()
            return

        # 6. Server Shutdown
        if self.path.startswith('/api/shutdown'):
            self.handle_shutdown()
            return

        return super().do_GET()

    def do_POST(self):
        # 1. Google OAuth Verification & Login
        if self.path.startswith('/api/auth/google'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body_bytes = self.rfile.read(content_length)
                body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
                credential = body.get('credential')

                if not credential:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "NO_CREDENTIAL"}).encode('utf-8'))
                    return

                # Verify token against Google tokeninfo endpoint
                verify_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(credential)}"
                req = urllib.request.Request(verify_url)
                try:
                    with urllib.request.urlopen(req) as resp:
                        g_data = json.loads(resp.read().decode('utf-8'))
                except urllib.error.HTTPError as he:
                    self.send_response(401)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "INVALID_GOOGLE_TOKEN", "details": str(he)}).encode('utf-8'))
                    return

                email = g_data.get('email', '').lower().strip()
                name = g_data.get('name', email.split('@')[0])
                picture = g_data.get('picture', '')

                if email not in ALLOWED_EMAILS:
                    print(f"[AUTH] Access Denied for unauthorized email: {email}")
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": False,
                        "error": "UNAUTHORIZED_EMAIL",
                        "message": f"Access denied. {email} is not authorized to access this draft room."
                    }).encode('utf-8'))
                    return

                print(f"[AUTH] ✅ Authorized access granted for: {email} ({name})")
                session_payload = {
                    "email": email,
                    "name": name,
                    "picture": picture,
                    "exp": int((time.time() + 30 * 24 * 60 * 60) * 1000)
                }
                session_token = create_session_token(session_payload)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Set-Cookie', f"auth_session={session_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={30 * 24 * 60 * 60}")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "user": {"email": email, "name": name, "picture": picture}}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
            return

        # 2. Logout
        if self.path.startswith('/api/auth/logout'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Set-Cookie', 'auth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
            return

        # 3. CBS Playwright Sync Trigger
        if self.path.startswith('/api/cbs/sync'):
            self.handle_cbs_sync()
            return

        # 4. CBS Interactive Login Launch
        if self.path.startswith('/api/cbs/login'):
            self.handle_cbs_login()
            return

        # 5. CBS Manual Data Save
        if self.path.startswith('/api/cbs/save'):
            self.handle_cbs_save()
            return

        self.send_response(404)
        self.end_headers()

    def handle_shutdown(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({"success": True, "message": "Server shutting down..."}).encode('utf-8'))
        print("\n[SHUTDOWN] Received shutdown command. Stopping server...")
        def kill_server():
            time.sleep(0.5)
            os._exit(0)
        threading.Thread(target=kill_server, daemon=True).start()

    def handle_player_news(self):
        try:
            parsed_url = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed_url.query)
            player_name = params.get('player', [''])[0]
            pos = params.get('pos', [''])[0]
            team = params.get('team', [''])[0]
            api_key = params.get('apiKey', [''])[0] or os.environ.get('GEMINI_API_KEY', '')

            if not api_key:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "NO_API_KEY"}).encode('utf-8'))
                return

            prompt = f"""
You are a real-time fantasy football beat reporter and high-stakes auction draft analyst.
Search for the most recent news, injury updates, practice reports, depth chart developments, and preseason buzz for NFL player: {player_name} ({pos}, {team}).

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{{
  "headline": "Short breaking news headline (max 12 words)",
  "summary": "2-3 concise sentences detailing their current health, training camp performance, snap volume, or target share outlook.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on how to price this player in a 12-team 0.5 PPR $200 auction cap draft.",
  "source": "Primary news source or reporter name",
  "confidence": "HIGH" | "MEDIUM"
}}
"""
            models_to_try = [
                {"model": "gemini-3.7-flash", "search": True},
                {"model": "gemini-2.5-flash", "search": True},
                {"model": "gemini-3.7-flash", "search": False},
                {"model": "gemini-2.5-flash", "search": False}
            ]

            parsed = None
            last_error = None

            for attempt in models_to_try:
                gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{attempt['model']}:generateContent?key={api_key}"
                req_body = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2}
                }
                if attempt["search"]:
                    req_body["tools"] = [{"googleSearch": {}}]

                req = urllib.request.Request(
                    gemini_url,
                    data=json.dumps(req_body).encode('utf-8'),
                    headers={'Content-Type': 'application/json'}
                )
                try:
                    with urllib.request.urlopen(req) as resp:
                        res_data = json.loads(resp.read().decode('utf-8'))
                    candidate = res_data.get('candidates', [{}])[0]
                    raw_text = "".join(part.get('text', '') for part in candidate.get('content', {}).get('parts', []))
                    clean_json = raw_text.strip()
                    if clean_json.startswith('```json'):
                        clean_json = clean_json[7:-3].strip()
                    elif clean_json.startswith('```'):
                        clean_json = clean_json[3:-3].strip()

                    parsed = json.loads(clean_json)
                    grounding = candidate.get('groundingMetadata', {})
                    if 'groundingChunks' in grounding:
                        parsed['searchSources'] = [
                            {"title": c.get('web', {}).get('title', ''), "uri": c.get('web', {}).get('uri', '')}
                            for c in grounding.get('groundingChunks', [])
                            if c.get('web', {}).get('title') and c.get('web', {}).get('uri')
                        ][:3]
                    break
                except urllib.error.HTTPError as http_err:
                    last_error = f"HTTP {http_err.code}: {http_err.reason}"
                    if http_err.code in [429, 404, 400]:
                        continue
                    else:
                        break
                except Exception as ex:
                    last_error = str(ex)

            if not parsed:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": last_error or "All fallback attempts failed"}).encode('utf-8'))
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": parsed}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_sync_sheet(self):
        try:
            sheet_id = "1FHfpcyKwtGxmAhxD_e0qSfdEPtteVP-Ahb8B56nzxVQ"
            main_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=2026127503"
            rookie_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=1188258304"

            req_main = urllib.request.Request(main_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_main) as resp:
                main_csv = resp.read().decode('utf-8')

            req_rookie = urllib.request.Request(rookie_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_rookie) as resp:
                rookie_csv = resp.read().decode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response_data = {
                "success": True,
                "mainCsv": main_csv,
                "rookieCsv": rookie_csv
            }
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_cbs_status(self):
        try:
            session_path = os.path.join(DIRECTORY, 'data', 'cbs_session.json')
            data_path = os.path.join(DIRECTORY, 'data', 'cbs_league_data.json')
            has_session = os.path.exists(session_path)
            has_data = os.path.exists(data_path)
            last_synced = None
            if has_data:
                try:
                    with open(data_path, 'r', encoding='utf-8') as f:
                        ld = json.load(f)
                        last_synced = ld.get('league_info', {}).get('last_synced')
                except Exception:
                    pass

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "hasSession": has_session,
                "hasData": has_data,
                "playwrightReady": True,
                "lastSynced": last_synced
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_cbs_data(self):
        try:
            data_path = os.path.join(DIRECTORY, 'data', 'cbs_league_data.json')
            if not os.path.exists(data_path):
                data_path = os.path.join(DIRECTORY, 'public', 'data', 'cbs_league_data.json')

            if os.path.exists(data_path):
                with open(data_path, 'r', encoding='utf-8') as f:
                    league_data = json.load(f)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": league_data}).encode('utf-8'))
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "No CBS league data found"}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_cbs_sync(self):
        try:
            import subprocess
            script_path = os.path.join(DIRECTORY, 'scripts', 'cbs_sync.py')
            result = subprocess.run([sys.executable, script_path, '--sync'], capture_output=True, text=True, timeout=60)
            
            data_path = os.path.join(DIRECTORY, 'data', 'cbs_league_data.json')
            league_data = {}
            if os.path.exists(data_path):
                with open(data_path, 'r', encoding='utf-8') as f:
                    league_data = json.load(f)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "data": league_data
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_cbs_login(self):
        try:
            import subprocess
            script_path = os.path.join(DIRECTORY, 'scripts', 'cbs_sync.py')
            
            # Use CREATE_NEW_CONSOLE on Windows to ensure visible desktop window
            creation_flags = 0
            if sys.platform == 'win32' and hasattr(subprocess, 'CREATE_NEW_CONSOLE'):
                creation_flags = subprocess.CREATE_NEW_CONSOLE

            subprocess.Popen([sys.executable, script_path, '--login'], creationflags=creation_flags)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "message": "Interactive browser opened for CBS login. Please log in and close the browser window when done."
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

    def handle_cbs_save(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(content_length)
            body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
            
            data_path = os.path.join(DIRECTORY, 'data', 'cbs_league_data.json')
            public_path = os.path.join(DIRECTORY, 'public', 'data', 'cbs_league_data.json')
            
            with open(data_path, 'w', encoding='utf-8') as f:
                json.dump(body, f, indent=2)
            with open(public_path, 'w', encoding='utf-8') as f:
                json.dump(body, f, indent=2)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "message": "Saved successfully"}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))


# --- AUTO-RESTART FILE WATCHER ---
def get_file_mtimes():
    mtimes = {}
    valid_exts = {'.py', '.js', '.html', '.css', '.json', '.csv'}
    for root, dirs, files in os.walk(DIRECTORY):
        if 'node_modules' in root or '.git' in root:
            continue
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in valid_exts:
                full_path = os.path.join(root, f)
                try:
                    mtimes[full_path] = os.path.getmtime(full_path)
                except OSError:
                    pass
    return mtimes

def watch_files_and_restart(httpd, initial_mtimes):
    while True:
        time.sleep(1.0)
        current_mtimes = get_file_mtimes()
        changed_file = None
        for path, mtime in current_mtimes.items():
            if path not in initial_mtimes or mtime > initial_mtimes[path]:
                changed_file = path
                break
        if not changed_file and len(current_mtimes) != len(initial_mtimes):
            changed_file = "Files added or removed"

        if changed_file:
            print(f"\n[RELOAD] Detected change in: {os.path.basename(changed_file)}")
            print("[RELOAD] Restarting Python server...")
            try:
                httpd.shutdown()
                httpd.server_close()
            except Exception:
                pass
            python_bin = sys.executable
            args = [python_bin] + sys.argv
            os.execv(python_bin, args)
            break

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DraftAppHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print("================================================================")
        print("  ⚡ 2026 Fantasy Football Auction Draft Command Center")
        print(f"  🚀 Server running at: {url}")
        print(f"  🔒 Auth Whitelist active: {', '.join(ALLOWED_EMAILS)}")
        print("  🔄 Auto-restart enabled: Server will reload on code changes")
        print("================================================================")
        
        # Start file watcher in background thread
        initial_mtimes = get_file_mtimes()
        watcher_thread = threading.Thread(target=watch_files_and_restart, args=(httpd, initial_mtimes), daemon=True)
        watcher_thread.start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
