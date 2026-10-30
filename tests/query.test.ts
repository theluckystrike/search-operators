import { describe, expect, it } from 'vitest';
import { linkTarget, makeResolver, parseDateSpec, parseLocalTime, parseQuery, previewLine, search, toMarkdownList, tokenize, type NoteData } from '../src/query';

const now = new Date(2026, 9, 10, 12, 0).getTime();
const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime();

describe('tokenize', () => {
	it('keeps quotes, wiki links and property brackets in one token', () => {
		expect(tokenize('a "b c" linksto:[[My note]] [due:<2026-10-01] -tag:x')).toEqual(['a', '"b c"', 'linksto:[[My note]]', '[due:<2026-10-01]', '-tag:x']);
	});
	it('handles extra spaces and an open quote', () => {
		expect(tokenize('  a   "b c ')).toEqual(['a', '"b c ']);
	});
});

describe('parseDateSpec', () => {
	it('one day is a 24 hour span in local time', () => {
		expect(parseDateSpec('2026-09-01', now)).toEqual({ from: day(2026, 9, 1), to: day(2026, 9, 2) });
	});
	it('> starts after the day, < ends before it', () => {
		expect(parseDateSpec('>2026-09-01', now)).toEqual({ from: day(2026, 9, 2), to: null });
		expect(parseDateSpec('<2026-09-01', now)).toEqual({ from: null, to: day(2026, 9, 1) });
		expect(parseDateSpec('<=2026-09', now)).toEqual({ from: null, to: day(2026, 10, 1) });
	});
	it('ranges include both ends', () => {
		expect(parseDateSpec('2026-09..2026-10-05', now)).toEqual({ from: day(2026, 9, 1), to: day(2026, 10, 6) });
	});
	it('last-N counts back from now', () => {
		expect(parseDateSpec('last-7d', now)).toEqual({ from: now - 7 * 86_400_000, to: null });
		expect(parseDateSpec('last3m', now)).toEqual({ from: new Date(2026, 6, 10, 12, 0).getTime(), to: null });
		expect(parseDateSpec('last-1y', now)).toEqual({ from: new Date(2025, 9, 10, 12, 0).getTime(), to: null });
	});
	it('rejects bad dates', () => {
		for (const bad of ['', 'soon', '2026-00-01', '2026-01-32', '>last-7d', '2026-01-01..x']) expect(typeof parseDateSpec(bad, now)).toBe('string');
	});
});

describe('parseQuery', () => {
	it('marks Pro features', () => {
		expect(parseQuery('a OR b', now).pro).toEqual(['OR']);
		expect(parseQuery('-a', now).pro).toEqual(['NOT']);
		expect(parseQuery('[x]', now).pro).toEqual(['property operators']);
		expect(parseQuery('created:today linksto:x tag:y path:z file:w sort:name', now).pro).toEqual([]);
	});
	it('reads property operators', () => {
		expect(parseQuery('[due:<=2026-10-01]', now).groups[0]).toEqual([{ kind: 'prop', key: 'due', op: 'le', value: '2026-10-01', negate: false }]);
		expect(parseQuery('[due:]', now).groups[0]).toEqual([{ kind: 'prop', key: 'due', op: 'exists', value: '', negate: false }]);
		expect(parseQuery('[:x]', now).errors.length).toBe(1);
	});
});

describe('wildcard link targets', () => {
	it('parses * and ? in link targets as a wildcard', () => {
		expect(parseQuery('linksto:[[Project*]]', now).groups[0]).toEqual([
			{ kind: 'linksto', target: 'Project*', wildcard: true, negate: false },
		]);
		expect(parseQuery('linkedfrom:[[x?y]]', now).groups[0]).toEqual([
			{ kind: 'linkedfrom', target: 'x?y', wildcard: true, negate: false },
		]);
		expect(parseQuery('linksto:[[My note]]', now).groups[0]).toEqual([
			{ kind: 'linksto', target: 'My note', wildcard: false, negate: false },
		]);
	});
	it('linksto with a pattern matches raw link texts, including links that do not resolve', () => {
		const n: NoteData = {
			path: 'a.md',
			ctime: 0,
			mtime: 0,
			tags: [],
			links: [],
			rawLinks: ['[[Project plan]]', '[[Inbox/2026-10|today]]', '[[Moscow guide]]'],
			frontmatter: null,
		};
		const run = (q: string): string[] => search(parseQuery(q, now), [n], { allowPro: false }).hits.map((h) => h.path);
		expect(run('linksto:[[Project*]]')).toEqual(['a.md']);
		expect(run('linksto:[[Inbox/*]]')).toEqual(['a.md']);
		expect(run('linksto:[[moscow*]]')).toEqual(['a.md']);
		expect(run('linksto:[[Project?plan]]')).toEqual(['a.md']);
		expect(run('linksto:[[Nothing*]]')).toEqual([]);
	});
	it('linksto with a pattern makes no error when no note has the name', () => {
		const n: NoteData = { path: 'a.md', ctime: 0, mtime: 0, tags: [], links: [], rawLinks: [], frontmatter: null };
		const r = search(parseQuery('linksto:[[Nobody*]]', now), [n], { allowPro: false });
		expect(r.errors).toEqual([]);
	});
	it('linkedfrom with a pattern matches source note paths', () => {
		const sources: NoteData[] = [
			{ path: 'Projects/Plan A.md', ctime: 0, mtime: 0, tags: [], links: ['People/Ana.md'], frontmatter: null },
			{ path: 'Projects/Plan B.md', ctime: 0, mtime: 0, tags: [], links: [], frontmatter: null },
		];
		const target: NoteData = { path: 'People/Ana.md', ctime: 0, mtime: 0, tags: [], links: [], frontmatter: null };
		const r = search(parseQuery('linkedfrom:[[Projects/*]]', now), [...sources, target], { allowPro: false });
		expect(r.hits.map((h) => h.path)).toEqual(['People/Ana.md']);
	});
	it('a dot in a pattern matches only a literal dot', () => {
		const n: NoteData = { path: 'a.md', ctime: 0, mtime: 0, tags: [], links: [], rawLinks: ['[[a.b]]', '[[axb]]'], frontmatter: null };
		expect(search(parseQuery('linksto:[[a*.b]]', now), [n], { allowPro: false }).hits.map((h) => h.path)).toEqual(['a.md']);
	});
});

describe('helpers', () => {
	it('linkTarget strips brackets, alias and heading', () => {
		expect(linkTarget('[[A/B|c]]')).toBe('A/B');
		expect(linkTarget('"[[A#h]]"')).toBe('A');
		expect(linkTarget('plain')).toBe('plain');
	});
	it('makeResolver prefers the path, then the file name', () => {
		const r = makeResolver(['x/Note.md', 'Note.md', 'y/Other.md']);
		expect(r('Note')).toBe('Note.md');
		expect(r('x/note')).toBe('x/Note.md');
		expect(r('other')).toBe('y/Other.md');
		expect(r('none')).toBeNull();
	});
	it('parseLocalTime reads dates, date-times and ms', () => {
		expect(parseLocalTime('2026-10-01')).toBe(day(2026, 10, 1));
		expect(parseLocalTime('2026-10-01 08:30')).toBe(new Date(2026, 9, 1, 8, 30).getTime());
		expect(parseLocalTime(5)).toBe(5);
		expect(parseLocalTime('soon')).toBeNull();
		expect(parseLocalTime(['2026-10-01'])).toBeNull();
	});
	it('previewLine skips frontmatter and cuts long lines around the term', () => {
		expect(previewLine('---\na: 1\n---\n# Title\nbody', [])).toBe('body');
		expect(previewLine('# Only a heading', [])).toBe('Only a heading');
		expect(previewLine('one\n- [ ] call Ana', ['ana'])).toBe('call Ana');
		const long = 'x '.repeat(100) + 'needle ' + 'y '.repeat(100);
		const p = previewLine(long, ['needle']);
		expect(p).toContain('needle');
		expect(p.startsWith('…')).toBe(true);
		expect(p.endsWith('…')).toBe(true);
		expect(previewLine('', ['a'])).toBe('');
	});
	it('search fills previews when text is given', () => {
		const n: NoteData = { path: 'a.md', ctime: 0, mtime: 0, tags: [], links: [], frontmatter: null, content: 'first\nsecond hit' };
		expect(search(parseQuery('hit', now), [n], { allowPro: false }).hits[0]?.preview).toBe('second hit');
		expect(search(parseQuery('path:a', now), [{ ...n, content: undefined }], { allowPro: false }).hits[0]?.preview).toBe('');
	});
	it('toMarkdownList writes one wiki link per note', () => {
		const md = toMarkdownList([{ path: 'P/A b.md', title: 'A b', created: 0, modified: 0, score: 1, preview: '' }], 'tag:`x`');
		expect(md).toBe("Search: `tag:'x'` (1 notes)\n\n- [[P/A b|A b]]\n");
	});
});
