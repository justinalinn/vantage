/**
 * Validates our pure-function group derivation against the FCC's own
 * `group_code` field on every amateur license in the ULS weekly dump.
 *
 * Run: npm run -s exec -- tsx scripts/validate-groups.ts
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { groupForCall } from '../src/lib/callsign/groups';
import { parseCall } from '../src/lib/callsign/format';

const ZIP = path.join(process.cwd(), 'data/raw/l_amat.zip');

async function main() {
  const proc = spawn('unzip', ['-p', ZIP, 'AM.dat']);
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

  let total = 0;
  let compared = 0;
  let agree = 0;
  const disagree = new Map<string, { count: number; samples: string[] }>();
  const unparsed = new Map<string, number>();

  for await (const line of rl) {
    const f = line.split('|');
    if (f.length < 8) continue;
    total++;
    const call = f[4];
    const fccGroup = f[6];
    if (!call || !fccGroup) continue;

    const ours = groupForCall(call);
    compared++;
    if (ours === fccGroup) {
      agree++;
    } else {
      const p = parseCall(call);
      const key = `fcc=${fccGroup} ours=${ours ?? 'null'} fmt=${p?.format ?? '?'} pfx=${p?.prefix ?? '?'}`;
      const e = disagree.get(key) ?? { count: 0, samples: [] };
      e.count++;
      if (e.samples.length < 6) e.samples.push(call);
      disagree.set(key, e);
      if (!ours) unparsed.set(call.slice(0, 2), (unparsed.get(call.slice(0, 2)) ?? 0) + 1);
    }
  }

  console.log(`rows            : ${total.toLocaleString()}`);
  console.log(`compared        : ${compared.toLocaleString()}`);
  console.log(`agree           : ${agree.toLocaleString()} (${((agree / compared) * 100).toFixed(4)}%)`);
  console.log(`disagree        : ${(compared - agree).toLocaleString()}`);
  console.log('\ntop disagreements:');
  [...disagree.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .forEach(([k, v]) => console.log(`  ${String(v.count).padStart(8)}  ${k}  e.g. ${v.samples.join(' ')}`));
}

main();
