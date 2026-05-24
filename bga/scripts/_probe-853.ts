import { chromium } from 'playwright';
import { loginViaUI } from './lib/login-flow';
import * as fs from 'node:fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  try {
    await loginViaUI(ctx, process.env.BGA_USERNAME!, process.env.BGA_PASSWORD!);
    const page = await ctx.newPage();
    await page.goto('https://boardgamearena.com/table?table=853277650', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);
    const cookies = await ctx.cookies();
    const idt = cookies.find(c => c.name === 'TournoiEnLigneidt')?.value;
    const url = 'https://boardgamearena.com/table/table/tableinfos.html?id=853277650&nosuggest=true&table=853277650&noerrortracking=true&dojo.preventCache=' + Date.now();
    const resp = await ctx.request.get(url, { headers: { 'x-requested-with': 'XMLHttpRequest', 'x-request-token': idt ?? '' } });
    const j: any = await resp.json();
    const d: any = j.data ?? {};
    console.log('status:', d.status);
    console.log('gamestart:', d.gamestart, 'now:', Math.floor(Date.now()/1000));
    console.log('current_player_nbr:', d.current_player_nbr, 'min:', d.min_player, 'max:', d.max_player);
    console.log('players:');
    for (const [pid, p] of Object.entries<any>(d.players ?? {})) {
      console.log('  ', pid, 'table_status=', p.table_status, 'status=', p.status, 'name=', p.fullname, 'table_order=', p.table_order);
    }
    console.log('decision/wait keys:', Object.keys(d).filter(k => /wait|accept|decision|gamestart|seat/i.test(k)));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
