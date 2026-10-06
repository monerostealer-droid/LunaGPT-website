"""Read-only smoke check against the existing LunaServer; never generate or switch."""
import argparse
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright, expect

async def main(engine,local_file=False):
    async with async_playwright() as p:
        browser=await getattr(p,engine).launch()
        context=await browser.new_context()
        page=await context.new_page()
        try:
            url=(Path(__file__).resolve().parents[1]/'index.html').as_uri() if local_file else 'http://localhost:8788'
            await page.goto(url)
            await expect(page.locator('#connection-label')).to_have_text('Connected',timeout=35000)
            await page.locator('#open-settings').click()
            await page.locator('[data-tab="model"]').click()
            await expect(page.locator('#shortTermMemory')).to_be_checked()
            await expect(page.locator('#temperature')).to_have_value('0.7')
            await expect(page.locator('#topP')).to_have_value('0.9')
            await expect(page.locator('#topK')).to_have_value('40')
            await page.locator('#temperature').fill('0.55')
            await page.locator('[data-close="settings-dialog"]').click()
            await page.reload()
            await expect(page.locator('#connection-label')).to_have_text('Connected',timeout=35000)
            await page.locator('#open-settings').click()
            await page.locator('[data-tab="model"]').click()
            await expect(page.locator('#temperature')).to_have_value('0.55')
            print('PASS: '+('file:// ' if local_file else 'HTTP ')+engine+' automatic private login, real GitHub discovery, server status, defaults and settings persistence. No generation or model switch performed.')
        except Exception:
            # Do not print network URLs, traces or credentials from the real server.
            print('LIVE CONNECTION NOT VERIFIED in '+engine+'. Server may be offline or unreachable.')
            raise SystemExit(1)
        finally:
            await browser.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chromium','webkit'],default='chromium');parser.add_argument('--file',action='store_true')
    args=parser.parse_args();asyncio.run(main(args.browser,args.file))
