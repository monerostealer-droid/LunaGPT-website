"""Real browser + local WebSocket fixture; no model/GitHub credentials are used."""
import asyncio
import argparse
import json
import threading
import shutil
import tempfile
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright, expect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'screenshots'
REPLY = 'Here is a simple example:\n\n```python\ndef add_numbers(a, b):\n    return a + b\n\nprint(add_numbers(2, 3))  # 5\n```\n\nThe function returns the sum. <img src=x onerror="window.injected=true">'
REPLY += '\n\n```text\nPlain text stays plain.\n```\n\n```custom language\n    exact indentation\n```'
requests = []

class QuietHandler(SimpleHTTPRequestHandler):
    websocket_url = ''

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/private-config.js':
            self.send_response(200)
            self.send_header('Content-Type','text/javascript')
            self.end_headers()
            self.wfile.write(b'window.LUNA_PRIVATE_CONFIG={password:""};')
            return
        if self.path.split('?')[0] == '/connection.json':
            payload=json.dumps({'ws_url':self.websocket_url}).encode()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            super().do_GET()

    def log_message(self, *_):
        pass

async def fixture(ws):
    if parse_qs(urlparse(ws.request.path).query).get('token') != ['test-password']:
        await ws.close()
        return
    current = 'v6'
    task = None
    async def send(data):
        await ws.send(json.dumps(data))
    async def status():
        await send({'type':'status','current':current,'loading':None,'busy':False,'models':[{'id':'v6','label':'LunaGPT v6'},{'id':'v7','label':'LunaGPT v7'}]})
    async def stream(prompt):
        content = ''
        try:
            if prompt == 'TOOL':
                await send({'type':'tool','tool':'python','body':'print(1 + 1)'})
                return
            if prompt == 'BURST':
                reply='A smooth response should appear progressively even when the server sends everything at once.'
                for i in range(0,len(reply),9):
                    await send({'type':'token','text':reply[i:i+9]})
                await send({'type':'done','text':reply,'aborted':False})
                return
            for i in range(0, len(REPLY), 12):
                part = REPLY[i:i+12]
                content += part
                await send({'type':'token','text':part})
                await asyncio.sleep(.07 if prompt != 'STOP' else .3)
                if prompt == 'DROP' and len(content) >= 48:
                    await ws.close()
                    return
            await send({'type':'done','text':REPLY,'aborted':False})
        except asyncio.CancelledError:
            try:
                await send({'type':'done','text':content,'aborted':False})
            except ConnectionClosed:
                pass
    await status()
    try:
        async for raw in ws:
            data = json.loads(raw)
            if data['cmd'] == 'generate':
                requests.append(data)
                task = asyncio.create_task(stream(data['text']))
            elif data['cmd'] == 'stop' and task:
                task.cancel()
            elif data['cmd'] == 'switch':
                current = data['model']
                await status()
            elif data['cmd'] == 'status':
                await status()
            elif data['cmd'] in ('tool_deny','tool_result'):
                await send({'type':'done','text':'' if data['cmd']=='tool_deny' else 'Tool handled.','aborted':data['cmd']=='tool_deny'})
            elif data['cmd'] == 'ping':
                await send({'type':'pong'})
    except ConnectionClosed:
        pass
    finally:
        if task and not task.done():
            task.cancel()

async def main(browser_name='chromium',local_file=False):
    OUT.mkdir(exist_ok=True)
    http = ThreadingHTTPServer(('127.0.0.1',0), partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base = f'http://localhost:{http.server_port}'
    scratch=None
    if local_file:
        # Test a clean private copy without ever loading the real embedded password.
        scratch=tempfile.TemporaryDirectory(prefix='luna-file-test-')
        target=Path(scratch.name)
        for name in ('index.html','style.css','polish.css','luna.js','manifest.webmanifest'):
            shutil.copy2(ROOT/name,target/name)
        shutil.copytree(ROOT/'assets',target/'assets')
        (target/'private-config.js').write_text('window.LUNA_PRIVATE_CONFIG={password:""};',encoding='utf-8')
        start_url=(target/'index.html').as_uri()
    else:
        start_url=base
    async with serve(fixture,'127.0.0.1',0) as ws_server, async_playwright() as p:
        ws_port = ws_server.sockets[0].getsockname()[1]
        QuietHandler.websocket_url=f'ws://127.0.0.1:{ws_port}/ws'
        if browser_name == 'webkit':
            browser = await p.webkit.launch()
        else:
            try:
                browser = await p.chromium.launch()
            except Exception:
                browser = await p.chromium.launch(channel='msedge')
        context = await browser.new_context(viewport={'width':1440,'height':980}, device_scale_factor=1)
        async def discovery(route):
            await route.fulfill(json={'ws_url':f'ws://127.0.0.1:{ws_port}/ws'},headers={'Access-Control-Allow-Origin':'*'})
        await context.route('https://api.github.com/**',discovery)
        await context.route('https://raw.githubusercontent.com/**',discovery)
        errors=[]
        page=await context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        diagnostics=[]
        page.on('console',lambda msg:diagnostics.append(msg.text) if msg.type=='error' else None)
        # Supply a registry to exercise optional WebMCP, including invalid input.
        await page.add_init_script('window.testTools={}; document.modelContext={registerTool:t=>{window.testTools[t.name]=t}};')
        await page.goto(start_url)
        await expect(page.locator('#login-dialog')).to_be_visible()
        await page.locator('#password').fill('test-password')
        await page.locator('#remember').check()
        await page.locator('#login-form summary').click()
        await page.locator('#discovery-url').fill(base+'/connection.json')
        await page.locator('#login-submit').click()
        try:
            await expect(page.locator('#connection-label')).to_have_text('Connected')
        except AssertionError:
            print('Login failed in test fixture; browser error count:',len(errors))
            raise
        await page.screenshot(path=str(OUT/'desktop-home.png'),full_page=True)
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        tools=await page.evaluate('Object.keys(window.testTools)')
        assert set(tools)=={'read_luna_state','start_luna_conversation','stage_luna_message'}
        assert await page.evaluate('window.testTools.read_luna_state.execute({}).connected')
        await page.evaluate('window.testTools.stage_luna_message.execute({text:"Write add_numbers in Python"})')
        await expect(page.locator('#input')).to_have_value('Write add_numbers in Python')
        invalid=await page.evaluate('async()=>{try{await testTools.stage_luna_message.execute({text:1});return false}catch{return true}}')
        assert invalid
        await page.locator('#send').click()
        await expect(page.locator('.streaming')).to_be_visible()
        await expect(page.locator('.assistant .message-content')).to_contain_text('Here is',timeout=5000)
        await expect(page.locator('.code-language').first).to_have_text('python')
        await page.evaluate('window.streamingCodeBlock = document.querySelector(".code-block")')
        await expect(page.locator('.streaming')).to_have_count(0)
        await expect(page.locator('.code-heading').first).to_contain_text('python')
        assert await page.locator('.code-block code').first.inner_text()=='def add_numbers(a, b):\n    return a + b\n\nprint(add_numbers(2, 3))  # 5'
        assert await page.locator('.code-language').all_text_contents()==['python','text','custom language']
        assert await page.evaluate('window.streamingCodeBlock === document.querySelector(".code-block")')
        assert await page.evaluate('window.injected === undefined')
        assert await page.locator('.message-content img').count()==0
        await page.screenshot(path=str(OUT/'desktop-chat.png'),full_page=True)
        # Regeneration must replace the existing assistant reply, not append a new pair.
        original_id=await page.locator('.assistant').get_attribute('data-id')
        assert await page.locator('.message-actions').all_text_contents()==['','']
        await page.get_by_role('button',name='Regenerate',exact=True).click()
        await expect(page.locator('.streaming')).to_be_visible()
        await expect(page.locator('.message')).to_have_count(2)
        await expect(page.locator('.streaming .code-block')).to_have_count(0)
        await expect(page.locator('.streaming')).to_have_count(0,timeout=10000)
        assert await page.locator('.assistant').get_attribute('data-id')==original_id
        assert requests[-1]['text']=='Write add_numbers in Python'
        assert 'turns' not in requests[-1]
        await page.locator('#open-settings').click()
        await page.locator('[data-theme-choice="midnight"]').click()
        await page.locator('[data-tab="model"]').click()
        await page.locator('#shortTermMemory').check()
        await page.locator('#temperature').fill('0.35')
        await page.locator('#topK').fill('20')
        await page.locator('#topP').fill('0.85')
        await page.locator('[data-close="settings-dialog"]').click()
        await page.locator('#input').fill('A second question')
        await page.locator('#send').click()
        await expect(page.locator('.streaming')).to_have_count(0,timeout=10000)
        assert requests[-1]['temperature']==.35
        assert requests[-1]['top_k']==20 and requests[-1]['top_p']==.85
        assert len(requests[-1]['turns'])==3
        assert requests[-1]['turns'][0]['text']=='Write add_numbers in Python'
        assert requests[-1]['turns'][1]['text']==REPLY
        assert requests[-1]['turns'][2]['text']=='A second question'
        await expect(page.get_by_role('button',name='Regenerate',exact=True)).to_have_count(1)
        await page.get_by_role('button',name='Regenerate',exact=True).click()
        await expect(page.locator('.streaming')).to_be_visible()
        await expect(page.locator('.message')).to_have_count(4)
        await expect(page.locator('.streaming')).to_have_count(0,timeout=10000)
        assert len(requests[-1]['turns'])==3
        assert requests[-1]['turns'][-1]['text']=='A second question'
        await page.locator('#model').select_option('v7')
        await expect(page.locator('#model')).to_be_enabled()
        await page.locator('#input').fill('Draft persists too')
        await page.wait_for_timeout(300)
        await page.reload()
        await expect(page.locator('#connection-label')).to_have_text('Connected')
        await expect(page.locator('.message')).to_have_count(4)
        await expect(page.locator('#input')).to_have_value('Draft persists too')
        assert await page.locator('html').get_attribute('data-theme')=='midnight'
        await page.locator('#input').fill('STOP')
        await page.locator('#send').click()
        await expect(page.locator('.streaming .message-content')).to_contain_text('Here')
        await page.locator('#stop').click()
        await expect(page.locator('.streaming')).to_have_count(0)
        await expect(page.locator('.message-note').last).to_contain_text('stopped')
        assert await page.locator('#stop').is_enabled()
        await page.locator('#input').fill('TOOL')
        await page.locator('#send').click()
        await expect(page.locator('#tool-request')).to_be_visible()
        await page.locator('#deny-tool').click()
        await expect(page.locator('.streaming')).to_have_count(0)
        await expect(page.locator('#tool-request')).to_be_hidden()
        await page.locator('#input').fill('DROP')
        await page.locator('#send').click()
        await expect(page.locator('.message-note').last).to_contain_text('Connection lost')
        await expect(page.locator('#connection-label')).to_have_text('Connected',timeout=15000)
        await page.reload()
        await expect(page.locator('.message')).to_have_count(10)
        await expect(page.locator('.message-note').last).to_contain_text('Connection lost')
        await expect(page.locator('#connection-label')).to_have_text('Connected')
        # Export, import safely as a separate chat, then exercise a fresh mobile layout.
        await page.locator('#open-settings').click()
        await page.locator('[data-tab="app"]').click()
        async with page.expect_download() as download_info:
            await page.locator('#export').click()
        path=await (await download_info.value).path()
        data=json.loads(Path(path).read_text(encoding='utf-8'))
        assert 'test-password' not in json.dumps(data)
        await page.locator('#import-file').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
        await expect(page.locator('#toast')).to_contain_text('imported')
        await page.locator('[data-close="settings-dialog"]').click()
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('#open-sidebar').click()
        await expect(page.locator('#sidebar')).to_have_class('open')
        await page.locator('#new-chat').click()
        await expect(page.locator('#welcome')).to_be_visible()
        await expect(page.locator('#sidebar')).not_to_have_class('open')
        await expect(page.locator('#toast')).to_be_hidden(timeout=6000)
        await page.evaluate('''() => {
          window.revealSamples=[];
          const sample=()=>{const el=document.querySelector('.assistant .message-content');
            if(el)window.revealSamples.push(el.textContent.length);
            window.sampleFrame=requestAnimationFrame(sample);};sample();
        }''')
        await page.locator('#input').fill('BURST')
        await page.locator('#send').click()
        await expect(page.locator('.assistant .message-content')).to_have_text('A smooth response should appear progressively even when the server sends everything at once.')
        await expect(page.locator('.streaming')).to_have_count(0)
        samples=await page.evaluate('cancelAnimationFrame(window.sampleFrame); window.revealSamples')
        assert len(set(n for n in samples if 0<n<91))>=3, f'Expected gradual reveal, got lengths {samples}'
        await page.locator('#open-sidebar').click()
        await page.locator('.chat-row.active .chat-menu').click()
        await page.get_by_role('button',name='Delete conversation',exact=True).click()
        await page.locator('#new-chat').click()
        await expect(page.locator('#welcome')).to_be_visible()
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT/'mobile-home.png'),full_page=True)
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        ring=await page.locator('.orbit').bounding_box()
        assert abs(ring['width']-ring['height'])<1, 'Moon ring must be circular'
        for width,height in [(320,568),(844,390),(390,430)]:
            await page.set_viewport_size({'width':width,'height':height})
            await page.wait_for_timeout(200)
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            composer=await page.locator('#composer').bounding_box()
            assert composer['y']+composer['height']<=height+1
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('#open-sidebar').click()
        await page.locator('#open-settings').click()
        await page.locator('[data-tab="look"]').click()
        await expect(page.locator('[data-tab="look"]')).to_have_attribute('aria-selected','true')
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT/'mobile-settings.png'),full_page=True)
        await page.locator('[data-close="settings-dialog"]').click()
        await page.locator('#close-sidebar').click()
        # Offline shell loads from service worker; history remains available.
        if not local_file:
            await page.evaluate('navigator.serviceWorker.ready')
        if browser_name == 'chromium' and not local_file:
            await context.set_offline(True)
            await page.reload()
            await expect(page.locator('#welcome')).to_be_visible()
            await expect(page.locator('#chat-count')).to_have_text('2')
            await context.set_offline(False)
        elif not local_file:
            # Windows Playwright WebKit fails navigation internally with set_offline.
            # Validate installed shell cache here; offline navigation is tested in Chromium.
            assert await page.evaluate('async()=>!!(await caches.match(new URL("./",location.href).href))')
        assert not errors, errors
        await browser.close()
    http.shutdown()
    if scratch:
        resolved=Path(scratch.name).resolve()
        assert resolved.parent==Path(tempfile.gettempdir()).resolve() and resolved.name.startswith('luna-file-test-')
        scratch.cleanup()
    print('PASS ('+browser_name+(' file://' if local_file else ' HTTP')+'): discovery, login, streaming, stable code blocks, Markdown safety, settings, memory, model switch, persistence, stop, tool denial, reconnect, export/import, mobile, WebMCP. Offline reload tested on HTTP Chromium only.')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',choices=['chromium','webkit'],default='chromium')
    parser.add_argument('--file',action='store_true')
    args=parser.parse_args()
    asyncio.run(main(args.browser,args.file))
