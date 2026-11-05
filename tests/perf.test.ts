import { describe, expect, it } from 'vitest';
import { parseQuery, search, type NoteData } from '../src/query';
import { GROWTH_LIMIT, growth } from './growth';

// 5,000 notes with text, tags and links. A wall-clock budget (150 ms strict, 1,500 ms default) failed on slow shared
// CI runners. The guard divides the time over 5,000 notes by the time over 500 notes, both measured in this test, so a
// slow runner slows both times and the ratio stays; a quadratic regression gives about 100 (s1103 CIFIX).

function vault(n: number, text = true): NoteData[] {
	const base = new Date(2026, 0, 1).getTime();
	return Array.from({ length: n }, (_, i) => ({
		path: `Notes/${String(i).padStart(5, '0')} note ${i % 97}.md`,
		ctime: base + i * 3_600_000,
		mtime: base + i * 3_600_000 + 60_000,
		tags: i % 3 === 0 ? ['project', `area/${i % 7}`] : ['daily'],
		links: [`Notes/${String((i * 7) % n).padStart(5, '0')} note ${((i * 7) % n) % 97}.md`],
		frontmatter: { status: i % 2 ? 'done' : 'open', priority: i % 10 },
		content: !text ? '' : `# Note ${i}\n\nSome words about topic ${i % 50} and the budget of week ${i % 52}.\n`.repeat(20),
	}));
}

describe('performance', () => {
	const sizes = new Map([5000, 500].map((n) => [n, vault(n)]));
	const now = new Date(2026, 9, 12, 12).getTime();
	for (const q of ['budget topic', 'created:2026-03 tag:project', 'linksto:[[00007 note 7]]', 'linkedfrom:[[00100 note 3]] OR [priority:>8] -tag:daily']) {
		it(`"${q}" over 5,000 notes runs in linear time`, () => {
			const r = search(parseQuery(q, Date.now()), sizes.get(5000)!, { allowPro: true });
			expect(r.errors).toEqual([]);
			const g = growth((n) => {
				const notes = sizes.get(n)!;
				return () => search(parseQuery(q, now), notes, { allowPro: true });
			}, 5000);
			expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
		});
	}
});

describe('performance without note text (s1103 CIFIX review D3)', () => {
	// Without text the work for each note is small, so an extra scan of all notes for each note shows in the growth
	// ratio. With text, such a scan can hide under the text work. 50,000 notes: an indexOf over all notes for each note
	// (review plant R3a) gave 45.6 and 46.0 here, correct code 12.8 (agent Mac, 2026-11-03).
	const now = new Date(2026, 9, 12, 12).getTime();
	it('"tag:project" over 50,000 notes without text runs in linear time', () => {
		const sizes = new Map([50000, 5000].map((n) => [n, vault(n, false)]));
		const r = search(parseQuery('tag:project', now), sizes.get(50000)!, { allowPro: true });
		expect(r.errors).toEqual([]);
		expect(r.hits.length).toBeGreaterThan(0);
		const g = growth((n) => {
			const notes = sizes.get(n)!;
			return () => search(parseQuery('tag:project', now), notes, { allowPro: true });
		}, 50000);
		expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
	});
});
