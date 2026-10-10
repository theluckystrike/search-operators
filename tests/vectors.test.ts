import { describe, expect, it } from 'vitest';
import vectors from './vectors/search-operators.json';
import { parseLocalTime, parseQuery, search, type NoteData, type SearchOptions } from '../src/query';

interface VNote extends Omit<NoteData, 'ctime' | 'mtime'> {
	ctime: string;
	mtime: string;
}
interface Expected {
	paths?: string[];
	errors?: string[];
	blocked?: string[];
	empty?: boolean;
}

const t = (s: string): number => parseLocalTime(s) ?? NaN;

describe('golden vectors (packages/spec/vectors/search-operators.json)', () => {
	it('has at least 40 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(40);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [query, raw, opts] = c.args as [string, VNote[], SearchOptions & { now: string }];
			const notes: NoteData[] = raw.map((n) => ({ ...n, ctime: t(n.ctime), mtime: t(n.mtime) }));
			const r = search(parseQuery(query, t(opts.now)), notes, opts);
			const got: Required<Expected> = { paths: r.hits.map((h) => h.path), errors: r.errors, blocked: r.blocked, empty: r.empty };
			const want = c.expected as Expected;
			const picked = Object.fromEntries(Object.keys(want).map((k) => [k, got[k as keyof Expected]]));
			expect(picked).toEqual(want);
		});
	}
});
