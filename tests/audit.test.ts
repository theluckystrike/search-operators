import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SearchOperatorsPlugin from '../src/main';
import { parseDateSpec, parseQuery, search, type NoteData } from '../src/query';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());

const now = new Date(2026, 9, 10, 12, 0).getTime();
const note = (path: string, mtime: number, content: string): NoteData => ({ path, ctime: 0, mtime, tags: [], links: [], frontmatter: null, content });

describe('audit defects', () => {
	it('a title match ranks above a text match with many hits, also when the text match is newer', () => {
		const title = note('Budget.md', 1, 'no word here');
		const body = note('Notes.md', 2, 'budget '.repeat(20));
		const r = search(parseQuery('budget', now), [body, title], { allowPro: false });
		expect(r.hits.map((h) => h.path)).toEqual(['Budget.md', 'Notes.md']);
	});

	it('rejects a day that is not in the month', () => {
		for (const bad of ['2026-02-31', '2026-04-31', '2026-02-29..2026-03-05']) expect(typeof parseDateSpec(bad, now)).toBe('string');
		expect(typeof parseDateSpec('2028-02-29', now)).not.toBe('string');
	});

	it('an empty quoted phrase does not match each note', () => {
		const notes = [note('a.md', 0, 'x'), note('b.md', 0, 'y')];
		expect(search(parseQuery('"', now), notes, { allowPro: false }).empty).toBe(true);
		expect(search(parseQuery('x ""', now), notes, { allowPro: false }).hits.map((h) => h.path)).toEqual(['a.md']);
		expect(parseQuery('-""', now).pro).toEqual([]);
	});

	it('loadNotes skips a note that it cannot read and reads the others', async () => {
		const app = App.createConfigured__({ files: { 'a.md': 'alpha', 'b.md': 'beta' } });
		const plugin = new SearchOperatorsPlugin(app as never, manifest as never);
		const read = app.vault.cachedRead.bind(app.vault);
		app.vault.cachedRead = (f: { path: string }) => (f.path === 'a.md' ? Promise.reject(new Error('gone')) : read(f as never));
		await expect(plugin.loadNotes()).resolves.toBe(1);
		expect(plugin.noteData(true).find((n) => n.path === 'b.md')?.content).toBe('beta');
	});

	it('the Markdown list goes in at the cursor and keeps the selected text', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new SearchOperatorsPlugin(app as never, manifest as never);
		let doc = 'keep me';
		const editor = {
			getCursor: (side?: string) => ({ line: 0, ch: side === 'from' ? 0 : 7 }),
			replaceSelection: (t: string) => {
				doc = t;
			},
			replaceRange: (t: string, at: { line: number; ch: number }) => {
				doc = doc.slice(0, at.ch) + t + doc.slice(at.ch);
			},
		};
		const view = { editor, getMode: () => 'source' };
		app.workspace.getActiveViewOfType = (() => view) as never;
		await plugin.insertText('\nLIST');
		expect(doc).toBe('keep me\nLIST');
	});
});
