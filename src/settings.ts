import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type SearchOperatorsPlugin from './main';

export interface SearchOperatorsSettings {
	/** Frontmatter key with the created date. Empty = file creation time. */
	createdProperty: string;
	/** Frontmatter key with the modified date. Empty = file modification time. */
	modifiedProperty: string;
	/** Pro: saved searches, one query per line. */
	savedSearches: string;
	/** Most results the modal lists. */
	maxResults: number;
}

export const MAX_RESULTS_MIN = 20;
export const MAX_RESULTS_MAX = 500;

export const DEFAULT_SETTINGS: SearchOperatorsSettings = {
	createdProperty: '',
	modifiedProperty: '',
	savedSearches: '',
	maxResults: 100,
};

const text = (v: unknown, d: string): string => (typeof v === 'string' ? v.trim() : d);

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<SearchOperatorsSettings> | null | undefined): SearchOperatorsSettings {
	const s = saved ?? {};
	const n = typeof s.maxResults === 'number' && Number.isFinite(s.maxResults) ? Math.round(s.maxResults) : DEFAULT_SETTINGS.maxResults;
	return {
		createdProperty: text(s.createdProperty, DEFAULT_SETTINGS.createdProperty),
		modifiedProperty: text(s.modifiedProperty, DEFAULT_SETTINGS.modifiedProperty),
		savedSearches: typeof s.savedSearches === 'string' ? s.savedSearches : DEFAULT_SETTINGS.savedSearches,
		maxResults: Math.min(MAX_RESULTS_MAX, Math.max(MAX_RESULTS_MIN, n)),
	};
}

/** Saved searches as a list: one query per line, blank lines and duplicates dropped. */
export function savedList(s: SearchOperatorsSettings): string[] {
	return [...new Set(s.savedSearches.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ''))];
}

export class SearchOperatorsSettingTab extends PluginSettingTab {
	plugin: SearchOperatorsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: SearchOperatorsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Created date property',
				desc: 'Frontmatter property that holds the date a note was made, for example created. Leave empty to use the file creation time. A note without the property uses the file time.',
				control: { type: 'text', key: 'createdProperty', defaultValue: DEFAULT_SETTINGS.createdProperty, placeholder: 'created' },
			},
			{
				name: 'Modified date property',
				desc: 'Frontmatter property that holds the date a note was last changed, for example updated. Leave empty to use the file modification time.',
				control: { type: 'text', key: 'modifiedProperty', defaultValue: DEFAULT_SETTINGS.modifiedProperty, placeholder: 'updated' },
			},
			{
				name: 'Most results',
				desc: `The modal lists at most this many notes, from ${MAX_RESULTS_MIN} to ${MAX_RESULTS_MAX}. The count above the list is the full count.`,
				control: { type: 'slider', key: 'maxResults', defaultValue: DEFAULT_SETTINGS.maxResults, min: MAX_RESULTS_MIN, max: MAX_RESULTS_MAX, step: 10 },
			},
			{
				name: 'Saved searches',
				desc: 'Pro: one query per line. Press Ctrl or Cmd + S in the search modal to add the current query. Run one with the command "Run a saved search".',
				control: { type: 'textarea', key: 'savedSearches', defaultValue: DEFAULT_SETTINGS.savedSearches, rows: 5, placeholder: 'modified:last-7d tag:#project' },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: OR and NOT, property operators, saved searches and results as a Markdown list.'
					: 'Free version: text, created:, modified:, linksto:, linkedfrom:, tag:, path:, file: and sort:. Pro adds OR and NOT, property operators like [status:done], saved searches and results as a Markdown list in your note.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
