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

const TABLES = ['853091673', '853057065'];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  try {
    await loginViaUI(ctx, process.env.BGA_USERNAME!, process.env.BGA_PASSWORD!);
    const page = await ctx.newPage();
    const cookies = await ctx.cookies();
    const idt = cookies.find(c => c.name === 'TournoiEnLigneidt')?.value;
    for (const tableId of TABLES) {
      console.log(`\n=== ${tableId} ===`);
      const url = `https://boardgamearena.com/table/table/tableinfos.html?id=${tableId}&nosuggest=true&table=${tableId}&noerrortracking=true&dojo.preventCache=${Date.now()}`;
      const resp = await ctx.request.get(url, { headers: { 'x-requested-with': 'XMLHttpRequest', 'x-request-token': idt ?? '' } });
      const j: any = await resp.json();
      const d: any = j.data ?? {};
      console.log('status:', d.status);
      console.log('gameserver:', d.gameserver);
      console.log('current_player_nbr:', d.current_player_nbr, 'min:', d.min_player, 'max:', d.max_player);
      console.log('table_creator:', d.table_creator);
      console.log('gamestart:', d.gamestart);
      console.log('players keys:', Object.keys(d.players ?? {}));
      for (const [pid, p] of Object.entries<any>(d.players ?? {})) {
        console.log(' ', pid, 'table_status=', p.table_status, 'status=', p.status, 'name=', p.fullname, 'table_order=', p.table_order, 'score=', p.score);
      }
      if (d.result?.player) {
        console.log('result.player:');
        for (const p of d.result.player) {
          console.log('  ', p.player_id, 'score=', p.score, 'name=', p.name);
        }
      }
      console.log('keys w/ wait/accept/decision/gamestart/result:', Object.keys(d).filter(k => /wait|accept|decision|gamestart|result/i.test(k)));
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
