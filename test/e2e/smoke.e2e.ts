import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

// Real-app checks of the search modal on the sample vault (test/e2e/vault/Search Operators, 13 notes).
// Dates come from the created and updated properties, so the results do not depend on file times.

interface ModalState {
	titles: string[];
	status: string;
	previews: string[];
}

/** Opens the modal with a query and returns the listed titles, the status line and the previews. */
async function runQuery(query: string): Promise<ModalState> {
	await browser.executeObsidian(({ app }, id, q) => {
		document.querySelectorAll('.search-operators-modal').forEach((el) => el.closest('.modal-container')?.remove());
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: Record<string, unknown>; openSearch(q: string): unknown }> } }).plugins.plugins[id];
		if (!p) throw new Error('plugin not loaded');
		p.settings.createdProperty = 'created';
		p.settings.modifiedProperty = 'updated';
		p.openSearch(q);
	}, pluginId, query);
	let state: ModalState = { titles: [], status: '', previews: [] };
	await browser.waitUntil(
		async () => {
			state = await browser.execute(() => {
				const m = document.querySelector('.search-operators-modal');
				return {
					titles: Array.from(m?.querySelectorAll('.search-operators-title') ?? []).map((e) => e.textContent ?? ''),
					status: m?.querySelector('.search-operators-status')?.textContent ?? '',
					previews: Array.from(m?.querySelectorAll('.search-operators-preview') ?? []).map((e) => e.textContent ?? ''),
				};
			});
			return state.status !== '' && !state.status.startsWith('Reading');
		},
		{ timeout: 10000, timeoutMsg: `no results for ${query}` },
	);
	return state;
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('created: with a date range lists the meetings of September', async function () {
		const s = await runQuery('path:meetings created:2026-09-01..2026-09-30');
		expect(s.titles).toEqual(['2026-09-15 Budget review', '2026-09-05 Team sync']);
		expect(s.status).toBe('2 notes');
	});

	it('created:> lists notes made after a day, newest change first', async function () {
		const s = await runQuery('tag:meeting created:>2026-09-30');
		expect(s.titles).toEqual(['2026-10-08 Design review', '2026-10-01 Kickoff']);
	});

	it('linksto: lists the backlinks of a note', async function () {
		const s = await runQuery('linksto:[[Project plan]] sort:name');
		expect(s.titles).toEqual(['2026-09-05 Team sync', '2026-09-15 Budget review', '2026-10-01 Kickoff', '2026-10-07', '2026-10-08', '2026-10-09', 'Search spec']);
	});

	it('linkedfrom: lists the notes a note links to', async function () {
		const s = await runQuery('linkedfrom:[[Project plan]] sort:name');
		expect(s.titles).toEqual(['2026-10-01 Kickoff', 'Ana', 'Search spec']);
	});

	it('text terms show a preview line with the term', async function () {
		const s = await runQuery('budget tag:meeting');
		expect(s.titles[0]).toBe('2026-09-15 Budget review');
		expect(s.previews[0]?.toLowerCase()).toContain('budget');
	});

	it('OR without Pro shows the Pro message and no results', async function () {
		const s = await runQuery('tag:finance OR tag:person');
		expect(s.titles).toEqual([]);
		expect(s.status).toContain('OR: this is a Pro feature');
	});

	it('a missing link target is reported', async function () {
		const s = await runQuery('linksto:[[Nobody]]');
		expect(s.status).toContain('No note named "Nobody".');
	});

	it('the commands are registered', async function () {
		const ids = await browser.executeObsidian(({ app }, id) => Object.keys((app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands).filter((c) => c.startsWith(id + ':')).sort(), pluginId);
		expect(ids).toEqual([`${pluginId}:linked-from-current`, `${pluginId}:links-to-current`, `${pluginId}:open-search`, `${pluginId}:run-saved`, `${pluginId}:send-feedback`, `${pluginId}:show-whats-new`]);
		await browser.execute(() => document.querySelectorAll('.search-operators-modal').forEach((el) => el.closest('.modal-container')?.remove()));
	});
});
