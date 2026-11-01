// "What Pro adds" for this plugin: the Pro lines of pro-features.ts, each with a demo that runs the real query code on
// sample notes in the window. A demo never reads or writes a vault file and never turns Pro on for a real search.
import type { App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { demoText, showWhatProAdds, type WhatProDemoFeature, type WhatProModal } from './license/github-obsidian';
import { parseQuery, search, toMarkdownList, type NoteData, type SearchResult } from './query';
import { PRO_FEATURES } from './pro-features';
import { PRO_UI, SPONSORS } from './pro';
import { DEFAULT_SETTINGS, savedList } from './settings';

const T = new Date(2026, 9, 30, 9, 0).getTime();
const note = (path: string, tags: string[], frontmatter: Record<string, unknown> | null, content: string, days: number): NoteData => ({
	path,
	ctime: T - days * 86_400_000,
	mtime: T - days * 86_400_000,
	tags,
	links: [],
	rawLinks: [],
	frontmatter,
	content,
});

/** Sample notes for the demos. They live only in this window. */
export const SAMPLE_NOTES: readonly NoteData[] = [
	note('Meetings/Kickoff.md', ['project'], { status: 'done', priority: 7 }, 'Kickoff with the design team.', 9),
	note('Meetings/Budget review.md', ['finance'], { status: 'open', priority: 3 }, 'Budget for the fourth quarter.', 4),
	note('Projects/Search plan.md', ['project'], { status: 'open', priority: 8 }, 'Plan for the search page.', 2),
	note('Daily/2026-10-30.md', [], null, 'Call with Ben about the budget.', 1),
	note('Reading/Deep work.md', ['book'], { status: 'done', priority: 2 }, 'Notes on a book about focus.', 20),
];

/** Runs a query on the sample notes, as the free version and as Pro. */
export function runSample(query: string, allowPro: boolean): SearchResult {
	return search(parseQuery(query, T), [...SAMPLE_NOTES], { allowPro });
}

const names = (r: SearchResult): string => (r.hits.length ? r.hits.map((h) => h.title).join(', ') : 'no notes');

/** A query field on the sample notes: the free result and the Pro result. Each key runs the query again. */
function queryDemo(el: HTMLElement, query: string): void {
	el.createEl('p', { text: `Edit the query. It runs on ${SAMPLE_NOTES.length} sample notes in this window.`, cls: 'pf-whatpro-demo-label' });
	const input = el.createEl('input', { type: 'text', value: query, cls: 'pf-whatpro-demo-input', attr: { 'aria-label': 'Sample query' } });
	const out = el.createEl('pre', { cls: 'pf-whatpro-demo-text' }).createEl('code');
	const draw = (): void => {
		const free = runSample(input.value, false);
		const pro = runSample(input.value, true);
		const freeText = free.blocked.length ? `nothing. The status line says: ${free.blocked.join(', ')} is Pro.` : names(free);
		out.setText(`Free version: ${freeText}\nPro: ${names(pro)}`);
	};
	input.addEventListener('input', draw);
	draw();
}

const DEMOS: Record<string, (el: HTMLElement) => void> = {
	or: (el) => queryDemo(el, 'tag:book OR tag:finance'),
	not: (el) => queryDemo(el, 'path:Meetings -tag:finance'),
	property: (el) => queryDemo(el, '[status:open] [priority:>5]'),
	list: (el) => {
		const query = 'tag:project';
		demoText(el, `The list for the query ${query}, as it goes into the note:`, toMarkdownList(runSample(query, true).hits, query).trimEnd());
	},
	saved: (el) => {
		const saved = savedList({ ...DEFAULT_SETTINGS, savedSearches: 'tag:project\n[status:open]\nmodified:2026-10' });
		const rows = saved.map((q, i) => `${i + 1}. ${q}  (${runSample(q, true).hits.length} notes)`);
		demoText(el, 'The command "Run a saved search" lists the saved searches. Select one to run it:', rows.join('\n'));
	},
};

export function whatProFeatures(): WhatProDemoFeature[] {
	return PRO_FEATURES.map((f) => ({ ...f, demo: DEMOS[f.id] ?? ((el: HTMLElement) => void el.createEl('p', { text: f.line })) }));
}

export function openWhatPro(app: App, pro: SponsorsManager | null, pluginId: string, pluginName: string): WhatProModal {
	return showWhatProAdds(app, pro, { pluginId, pluginName, features: whatProFeatures(), priceText: PRO_UI.priceText }, SPONSORS);
}
