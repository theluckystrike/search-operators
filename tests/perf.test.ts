import { describe, expect, it } from 'vitest';
import { parseQuery, search, type NoteData } from '../src/query';

// 5,000 notes with text, tags and links. Strict budget only under FX_PERF_STRICT=1; the default ceiling
// tolerates a busy machine and still catches an algorithmic regression.
const BUDGET_MS = process.env.FX_PERF_STRICT === '1' ? 150 : 1500;

function vault(n: number): NoteData[] {
	const base = new Date(2026, 0, 1).getTime();
	return Array.from({ length: n }, (_, i) => ({
		path: `Notes/${String(i).padStart(5, '0')} note ${i % 97}.md`,
		ctime: base + i * 3_600_000,
		mtime: base + i * 3_600_000 + 60_000,
		tags: i % 3 === 0 ? ['project', `area/${i % 7}`] : ['daily'],
		links: [`Notes/${String((i * 7) % n).padStart(5, '0')} note ${((i * 7) % n) % 97}.md`],
		frontmatter: { status: i % 2 ? 'done' : 'open', priority: i % 10 },
		content: `# Note ${i}\n\nSome words about topic ${i % 50} and the budget of week ${i % 52}.\n`.repeat(20),
	}));
}

describe('performance', () => {
	const notes = vault(5000);
	for (const q of ['budget topic', 'created:2026-03 tag:project', 'linksto:[[00007 note 7]]', 'linkedfrom:[[00100 note 3]] OR [priority:>8] -tag:daily']) {
		it(`"${q}" over 5,000 notes is under ${BUDGET_MS} ms`, () => {
			const t0 = performance.now();
			const r = search(parseQuery(q, Date.now()), notes, { allowPro: true });
			const ms = performance.now() - t0;
			expect(r.errors).toEqual([]);
			expect(ms).toBeLessThan(BUDGET_MS);
		});
	}
});
