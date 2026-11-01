import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingGates, whatProModel, whatProUrl } from '../src/license/github-obsidian';
import { PRO_FEATURES } from '../src/pro-features';
import { PRO_UI, SPONSORS } from '../src/pro';
import { SAMPLE_NOTES, runSample, whatProFeatures } from '../src/what-pro';
import manifest from '../manifest.json';

const ROOT = join(import.meta.dirname, '..');
const read = (file: string): string | null => {
	try {
		return readFileSync(join(ROOT, file), 'utf8');
	} catch {
		return null;
	}
};
const demo = (id: string): HTMLElement => {
	const el = document.createElement('div');
	const f = whatProFeatures().find((x) => x.id === id);
	if (!f) throw new Error(`no feature ${id}`);
	f.demo(el);
	return el;
};

describe('What Pro adds: feature list', () => {
	it('lists the 5 Pro features of the plugin, one line each', () => {
		expect(PRO_FEATURES.map((f) => f.id)).toEqual(['or', 'not', 'property', 'list', 'saved']);
		for (const f of PRO_FEATURES) expect(f.line).toMatch(/^[A-Z].{20,160}\.$/);
		expect(whatProFeatures().map((f) => f.line)).toEqual(PRO_FEATURES.map((f) => f.line));
	});

	it('each listed feature has its Pro gate in src', () => {
		expect(missingGates(PRO_FEATURES, read)).toEqual([]);
	});

	it('negative control: a listed feature without a gate in src fails the gate check', () => {
		const ghost = { id: 'ghost', line: 'XOR finds notes that match one group only.', gate: { file: 'src/query.ts', text: "q.pro.push('XOR')" } };
		expect(missingGates([...PRO_FEATURES, ghost], read)).toEqual(['ghost']);
	});

	it('the README Pro section has the same lines and the same price text', () => {
		const readme = read('README.md') ?? '';
		const section = readme.slice(readme.indexOf('\n## Pro\n'));
		expect(section.startsWith('\n## Pro\n')).toBe(true);
		for (const f of PRO_FEATURES) expect(section).toContain(`\n- ${f.line}\n`);
		expect(section).toContain(PRO_UI.priceText);
	});
});

describe('What Pro adds: price and button', () => {
	it('the Sponsor $15 once button opens the one-time tab with metadata_source=<plugin id>-whatpro', () => {
		const m = whatProModel(null, { pluginId: manifest.id, features: PRO_FEATURES, priceText: PRO_UI.priceText }, SPONSORS);
		expect(m.sponsorText).toBe('Sponsor $15 once');
		expect(m.sponsorUrl).toBe('https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=search-operators-whatpro');
		expect(m.sponsorUrl).toBe(whatProUrl(SPONSORS, manifest.id));
		expect(m.priceText).toBe(PRO_UI.priceText);
	});
});

describe('What Pro adds: demos on sample notes', () => {
	const code = (el: HTMLElement): string => el.querySelector('code')?.textContent ?? '';
	it('OR: the free version lists nothing and names OR; Pro finds both notes', () => {
		expect(code(demo('or'))).toBe('Free version: nothing. The status line says: OR is Pro.\nPro: Budget review, Deep work');
	});

	it('NOT: leaves out the finance meeting', () => {
		expect(code(demo('not'))).toBe('Free version: nothing. The status line says: NOT is Pro.\nPro: Kickoff');
	});

	it('property operators: open notes with a priority above 5', () => {
		expect(code(demo('property'))).toBe('Free version: nothing. The status line says: property operators is Pro.\nPro: Search plan');
	});

	it('the query field runs again on each key, with a free query that needs no Pro', () => {
		const el = demo('or');
		const input = el.querySelector('input');
		if (!input) throw new Error('no input');
		input.value = 'tag:project';
		input.dispatchEvent(new Event('input'));
		expect(code(el)).toBe('Free version: Search plan, Kickoff\nPro: Search plan, Kickoff');
	});

	it('Markdown list: the text that goes into the note', () => {
		expect(code(demo('list'))).toBe('Search: `tag:project` (2 notes)\n\n- [[Projects/Search plan|Search plan]]\n- [[Meetings/Kickoff|Kickoff]]');
	});

	it('saved searches: the list of the command with the count of each search', () => {
		expect(code(demo('saved'))).toBe('1. tag:project  (2 notes)\n2. [status:open]  (2 notes)\n3. modified:2026-10  (5 notes)');
	});

	it('the demos never turn Pro on: the free result of a Pro query stays blocked', () => {
		for (const f of whatProFeatures()) f.demo(document.createElement('div'));
		expect(runSample('tag:book OR tag:finance', false).blocked).toEqual(['OR']);
		expect(SAMPLE_NOTES).toHaveLength(5);
	});
});

describe('What Pro adds: entry points', () => {
	const main = read('src/main.ts') ?? '';
	it('has one command and opens the window only from a user action', () => {
		expect(main).toContain("this.addCommand({ id: 'what-pro-adds', name: WHAT_PRO_TITLE, callback: () => this.openWhatPro() });");
		// onload never opens it: the only calls are inside callbacks.
		const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
		expect(onload.match(/openWhatPro\(\)/g)).toHaveLength(2);
		expect(onload).toContain('bindWhatPro(() => this.openWhatPro());');
	});
	it('has the settings button and the notice link', () => {
		expect(read('src/settings.ts')).toContain('sponsorsSettingItemsWithWhatPro(this.plugin.pro, PRO_UI, () => this.plugin.openWhatPro())');
		expect(read('src/pro.ts')).toContain('showProNoticeWithWhatPro(manager, lead, () => whatPro?.());');
	});
});
