import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SearchOperatorsPlugin from '../src/main';
import { parseQuery, search, type NoteData } from '../src/query';
import manifest from '../manifest.json';

const now = new Date(2026, 9, 12, 12).getTime();
const note = (path: string, links: string[] = [], rawLinks: string[] = []): NoteData => ({ path, ctime: 0, mtime: 0, tags: [], links, rawLinks, frontmatter: null });
const paths = (q: string, notes: NoteData[]): string[] => search(parseQuery(q, now), notes, { allowPro: false }).hits.map((h) => h.path).sort();

describe('link patterns', () => {
	it('linkedfrom with a pattern matches the file name of the source, as a plain target does', () => {
		const notes = [note('Meetings/2026-10-01 Kickoff.md', ['People/Ana.md']), note('People/Ana.md')];
		expect(paths('linkedfrom:[[2026-10-01 Kickoff]]', notes)).toEqual(['People/Ana.md']);
		expect(paths('linkedfrom:[[2026-10-01*]]', notes)).toEqual(['People/Ana.md']);
		expect(paths('linkedfrom:[[*Kickoff]]', notes)).toEqual(['People/Ana.md']);
	});
	it('linksto with a pattern matches a resolved link by file name or by path without .md', () => {
		// An embed or a frontmatter link: resolved, but not in the body links.
		const notes = [note('a.md', ['Projects/Project plan.md']), note('Projects/Project plan.md')];
		expect(paths('linksto:[[Project p*]]', notes)).toEqual(['a.md']);
		expect(paths('linksto:[[*plan]]', notes)).toEqual(['a.md']);
		expect(paths('linksto:[[Projects/Project pla?]]', notes)).toEqual(['a.md']);
	});
	it('a folder pattern matches the folder at any depth, as a link path does', () => {
		const notes = [
			note('Work/Daily/d.md', ['Work/Projects/Project plan.md'], ['Project plan']),
			note('Work/Projects/Project plan.md', ['Work/People/Ana.md']),
			note('Work/People/Ana.md'),
			note('MyProjects/x.md', ['Work/People/Ben.md']),
			note('Work/People/Ben.md'),
		];
		expect(paths('linksto:[[Projects/*]]', notes)).toEqual(['Work/Daily/d.md']);
		expect(paths('linkedfrom:[[Projects/*]]', notes)).toEqual(['Work/People/Ana.md']);
		expect(paths('linkedfrom:[[Work/Projects/*]]', notes)).toEqual(['Work/People/Ana.md']);
	});
	it('linkedfrom with a pattern over 5,000 notes is fast', () => {
		const n = 5000;
		const notes = Array.from({ length: n }, (_, i) => note(`Notes/${i}.md`, [`Notes/${(i * 7) % n}.md`, `Notes/${(i * 3) % n}.md`]));
		const t0 = performance.now();
		const r = search(parseQuery('linkedfrom:[[Notes/1*]]', now), notes, { allowPro: false });
		const ms = performance.now() - t0;
		expect(r.hits.length).toBeGreaterThan(0);
		expect(ms).toBeLessThan(process.env.FX_PERF_STRICT === '1' ? 150 : 1500);
	});
});

describe('raw links in noteData', () => {
	it('keeps unresolved embeds and frontmatter links as raw links', async () => {
		const app = App.createConfigured__({ files: { 'a.md': 'x' } });
		const plugin = new SearchOperatorsPlugin(app as never, manifest as never);
		const mc = plugin.app.metadataCache as unknown as Record<string, unknown>;
		mc.getFileCache = () => ({
			links: [{ link: 'Future/one' }],
			embeds: [{ link: 'Future/two' }],
			frontmatterLinks: [{ key: 'related', link: 'Future/three' }],
		});
		const data = plugin.noteData(false).find((d) => d.path === 'a.md');
		expect(data?.rawLinks).toEqual(['Future/one', 'Future/two', 'Future/three']);
	});
});
