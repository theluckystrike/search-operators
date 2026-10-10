import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SearchOperatorsPlugin from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings, savedList } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const cbs = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (cb: () => void) => {
			cbs.add(cb);
			return () => cbs.delete(cb);
		},
		set(v: boolean) {
			pro = v;
			for (const cb of cbs) cb();
		},
	};
}

describe('SearchOperatorsPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new SearchOperatorsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ createdProperty: 5 as never, maxResults: 'x' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ maxResults: 9999 }).maxResults).toBe(500);
		expect(normalizeSettings({ maxResults: 1 }).maxResults).toBe(20);
		expect(normalizeSettings({ createdProperty: ' created ' }).createdProperty).toBe('created');
	});

	it('saved searches are one per line without blanks or duplicates', () => {
		expect(savedList({ ...DEFAULT_SETTINGS, savedSearches: 'a\n\n b \na\r\nc' })).toEqual(['a', 'b', 'c']);
	});

	it('saveSearch needs Pro', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new SearchOperatorsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(await plugin.saveSearch('tag:x')).toBe(false);
		const m = fakeManager(true);
		bindPro(m as never);
		expect(await plugin.saveSearch('tag:x')).toBe(true);
		expect(await plugin.saveSearch('tag:x')).toBe(true);
		expect(plugin.settings.savedSearches).toBe('tag:x');
	});
});

describe('pro facade', () => {
	it('is off with no manager and follows the manager', () => {
		expect(isPro()).toBe(false);
		const m = fakeManager(false);
		let calls = 0;
		bindPro(m as never);
		const off = onProChange(() => calls++);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(calls).toBe(1);
		off();
		m.set(false);
		expect(calls).toBe(1);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});
