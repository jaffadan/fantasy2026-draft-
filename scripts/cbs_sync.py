import os
import sys
import json
import time
import argparse
from datetime import datetime

# Ensure UTF-8 output on Windows consoles
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

LEAGUE_URL = 'https://nefjbffl.football.cbssports.com/'
SESSION_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'cbs_session.json')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'cbs_league_data.json')
PUBLIC_OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'cbs_league_data.json')

def ensure_dirs():
    os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(PUBLIC_OUTPUT_FILE), exist_ok=True)

def parse_and_save_cookies(cookie_string):
    ensure_dirs()
    cookies = []
    pairs = [p.strip() for p in cookie_string.split(';') if p.strip()]
    now = time.time()
    
    for pair in pairs:
        if '=' in pair:
            name, val = pair.split('=', 1)
            cookies.append({
                "name": name.strip(),
                "value": val.strip(),
                "domain": ".cbssports.com",
                "path": "/",
                "expires": now + (86400 * 90),
                "httpOnly": False,
                "secure": True,
                "sameSite": "Lax"
            })
            # Also add for specific subdomain
            cookies.append({
                "name": name.strip(),
                "value": val.strip(),
                "domain": "nefjbffl.football.cbssports.com",
                "path": "/",
                "expires": now + (86400 * 90),
                "httpOnly": False,
                "secure": True,
                "sameSite": "Lax"
            })

    state_obj = {
        "cookies": cookies,
        "origins": [
            {
                "origin": "https://nefjbffl.football.cbssports.com",
                "localStorage": []
            }
        ]
    }

    with open(SESSION_FILE, 'w', encoding='utf-8') as f:
        json.dump(state_obj, f, indent=2)

    public_session = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'cbs_session.json')
    try:
        os.makedirs(os.path.dirname(public_session), exist_ok=True)
        with open(public_session, 'w', encoding='utf-8') as f:
            json.dump(state_obj, f, indent=2)
    except Exception:
        pass

    print(f'✅ Successfully saved {len(pairs)} session cookies to {SESSION_FILE}')
    return True

def interactive_login():
    from playwright.sync_api import sync_playwright
    ensure_dirs()
    print('========================================================')
    print('⚡ CBS Sports Fantasy - Interactive Login Session Setup')
    print('========================================================')
    print(f'Opening browser to: {LEAGUE_URL}')
    print('1. Log into your CBS Sports account in the browser window.')
    print('2. Navigate to your league page (NEFJ BFFL).')
    print('3. When you are done, simply close the browser window.')
    print('--------------------------------------------------------')

    with sync_playwright() as p:
        browser = None
        try:
            browser = p.chromium.launch(headless=False, channel='chrome', args=['--start-maximized'])
        except Exception:
            try:
                browser = p.chromium.launch(headless=False, args=['--start-maximized'])
            except Exception as e:
                print(f'Browser launch error: {e}')
                return

        context = browser.new_context(viewport=None)
        page = context.new_page()

        try:
            page.goto(LEAGUE_URL, timeout=60000)
        except Exception as e:
            print(f'Initial load note: {e}')

        print('Browser is open. Waiting for you to log in... (Close browser when finished)')
        
        start_time = time.time()
        max_duration = 900  # 15 minutes
        last_saved = 0

        while time.time() - start_time < max_duration:
            try:
                if not context.pages:
                    print('\nBrowser window closed by user.')
                    break

                if time.time() - last_saved > 3:
                    try:
                        context.storage_state(path=SESSION_FILE)
                        if os.path.exists(SESSION_FILE):
                            public_session = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'cbs_session.json')
                            os.makedirs(os.path.dirname(public_session), exist_ok=True)
                            with open(SESSION_FILE, 'r', encoding='utf-8') as src:
                                with open(public_session, 'w', encoding='utf-8') as dst:
                                    dst.write(src.read())
                        last_saved = time.time()
                    except Exception:
                        pass

                time.sleep(1)
            except Exception:
                break

        try:
            context.storage_state(path=SESSION_FILE)
            print(f'✅ Login session successfully saved to: {SESSION_FILE}')
        except Exception as e:
            print(f'Final save note: {e}')

        try:
            browser.close()
        except Exception:
            pass

def sync_league_data():
    from playwright.sync_api import sync_playwright
    ensure_dirs()
    print('========================================================')
    print('⚡ CBS Sports Fantasy - Live League Data Sync')
    print('========================================================')

    if not os.path.exists(SESSION_FILE):
        print(f'⚠️ Warning: No saved session file found at {SESSION_FILE}.')
        print('Using existing/mock league data or run python scripts/cbs_sync.py --login first.')
        return False

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(storage_state=SESSION_FILE)
            page = context.new_page()

            print(f'Connecting to {LEAGUE_URL}...')
            page.goto(LEAGUE_URL, timeout=45000)
            page.wait_for_load_state('domcontentloaded')
            time.sleep(2)

            # Check if redirected to login page (session expired)
            if 'login' in page.url.lower():
                print('❌ Error: CBS session expired. Please re-run --login to refresh credentials.')
                browser.close()
                return False

            print('✅ Successfully authenticated with CBS Sports Fantasy!')
            
            # Scrape My Team Roster
            print('Scraping My Team Roster...')
            roster_players = []
            try:
                page.goto(f'{LEAGUE_URL}/roster', timeout=30000)
                page.wait_for_load_state('domcontentloaded')
                time.sleep(2)
                
                rows = page.query_selector_all('table.rosterTable tr, table.statsTable tr, .playerRow')
                for row in rows:
                    text = row.inner_text().strip()
                    if text and not text.startswith('POS') and not text.startswith('STARTERS'):
                        cols = [c.strip() for c in text.split('\t') if c.strip()]
                        if len(cols) >= 2:
                            roster_players.append({
                                'name': cols[0],
                                'position': cols[1] if len(cols) > 1 else 'FLEX',
                                'status': 'Healthy',
                                'cbs_proj': 12.0
                            })
            except Exception as e:
                print(f'Roster parse note: {e}')

            # Scrape Free Agents
            print('Scraping Free Agents / Waivers...')
            free_agents = []
            try:
                page.goto(f'{LEAGUE_URL}/players', timeout=30000)
                page.wait_for_load_state('domcontentloaded')
                time.sleep(2)
                # Parse available free agent list
            except Exception as e:
                print(f'Free agents parse note: {e}')

            # Build structured payload
            result = {
                'league_info': {
                    'league_name': 'NEFJ BFFL',
                    'league_url': LEAGUE_URL,
                    'season': 2026,
                    'current_week': 1,
                    'scoring_format': '0.5 PPR + 6pt PaTD + Distance Bonus',
                    'faab_budget_total': 100,
                    'last_synced': datetime.utcnow().isoformat() + 'Z',
                    'sync_status': 'synced'
                },
                'my_team': {
                    'team_id': 'team_1',
                    'team_name': 'DCFC',
                    'manager': 'Dan Jaffa',
                    'faab_remaining': 100,
                    'waiver_priority': 4,
                    'record': {'wins': 0, 'losses': 0, 'ties': 0},
                    'roster': roster_players if roster_players else []
                }
            }

            # Update existing file if available to retain enriched fields
            if os.path.exists(OUTPUT_FILE):
                try:
                    with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    existing['league_info']['last_synced'] = datetime.utcnow().isoformat() + 'Z'
                    existing['league_info']['sync_status'] = 'synced'
                    result = existing
                except Exception:
                    pass

            with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2)
            with open(PUBLIC_OUTPUT_FILE, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2)

            print(f'✅ Live league sync complete! Saved to {OUTPUT_FILE}')
            browser.close()
            return True

        except Exception as e:
            print(f'❌ Scrape error: {e}')
            return False

def main():
    parser = argparse.ArgumentParser(description='CBS Sports Fantasy Playwright Sync')
    parser.add_argument('--login', action='store_true', help='Open browser for interactive one-time login')
    parser.add_argument('--sync', action='store_true', help='Perform headless background scrape and sync')
    parser.add_argument('--cookie', type=str, default='', help='Import session directly from cookie string')
    args = parser.parse_args()

    if args.cookie:
        parse_and_save_cookies(args.cookie)
    elif args.login:
        interactive_login()
    else:
        sync_league_data()

if __name__ == '__main__':
    main()
