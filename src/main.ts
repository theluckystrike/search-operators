import { FuzzySuggestModal, MarkdownView, Notice, Plugin, TFile, getAllTags, type App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { OperatorSearchModal } from './modal';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { needsContent, parseQuery, search, toMarkdownList, type NoteData, type Query, type SearchResult } from './query';
import { DEFAULT_SETTINGS, SearchOperatorsSettingTab, normalizeSettings, savedList, type SearchOperatorsSettings } from './settings';

/** A notice for a Pro feature that is off. */
export function needsPro(what: string): void {
	new Notice(`${what} a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
}

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

interface TextEntry {
	mtime: number;
	size: number;
	text: string;
}

export default class SearchOperatorsPlugin extends Plugin {
	settings: SearchOperatorsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The result of the last query, for the Markdown list. */
	lastResult: SearchResult | null = null;
	private settingTab: SearchOperatorsSettingTab | null = null;
	/** Note text by path, checked against mtime and size. */
	private texts = new Map<string, TextEntry>();

	async onload(): Promise<void> {
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new SearchOperatorsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addRibbonIcon('search-code', 'Search with operators', () => this.openSearch());
		this.addCommand({ id: 'open-search', name: 'Search notes with operators', callback: () => this.openSearch() });
		this.addCommand({
			id: 'links-to-current',
			name: 'Find notes that link to the current note',
			checkCallback: (checking) => this.withActive(checking, (f) => `linksto:[[${f.path.replace(/\.md$/i, '')}]] `),
		});
		this.addCommand({
			id: 'linked-from-current',
			name: 'Find notes the current note links to',
			checkCallback: (checking) => this.withActive(checking, (f) => `linkedfrom:[[${f.path.replace(/\.md$/i, '')}]] `),
		});
		this.addCommand({ id: 'run-saved', name: 'Run a saved search', callback: () => this.openSaved() });
		this.registerEvent(this.app.vault.on('delete', (f) => this.texts.delete(f.path)));
		this.registerEvent(this.app.vault.on('rename', (_f, old) => this.texts.delete(old)));
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
		this.texts.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<SearchOperatorsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	openSearch(initial = ''): OperatorSearchModal {
		const m = new OperatorSearchModal(this.app, this, initial);
		m.open();
		return m;
	}

	/** Pro: runs a query and writes the results as a Markdown list into the active note (or the clipboard). */
	async insertResults(query: string): Promise<number> {
		if (!isPro()) {
			needsPro('Results as a Markdown list is');
			return 0;
		}
		await this.loadNotes();
		const r = this.run(parseQuery(query, Date.now()));
		await this.insertText(toMarkdownList(r.hits, query.trim()));
		return r.hits.length;
	}

	private withActive(checking: boolean, query: (f: TFile) => string): boolean {
		const f = this.app.workspace.getActiveFile();
		if (!f || f.extension !== 'md') return false;
		if (!checking) this.openSearch(query(f));
		return true;
	}

	/** Pro: picks a saved search and opens the modal with it. */
	openSaved(): void {
		if (!isPro()) {
			needsPro('Saved searches are');
			return;
		}
		const list = savedList(this.settings);
		if (!list.length) {
			new Notice('No saved searches yet. Press Ctrl or Cmd + S in the search modal to save one.');
			return;
		}
		new SavedSearchModal(this.app, list, (q) => this.openSearch(q)).open();
	}

	/** Pro: adds a query to the saved searches. */
	async saveSearch(query: string): Promise<boolean> {
		const q = query.trim();
		if (!isPro()) {
			needsPro('Saved searches are');
			return false;
		}
		if (!q) return false;
		const list = savedList(this.settings);
		if (!list.includes(q)) list.push(q);
		this.settings.savedSearches = list.join('\n');
		await this.saveSettings();
		new Notice(`Saved search: ${q}`);
		return true;
	}

	/** Reads the text of changed notes into the cache. Unchanged notes are not read again. */
	async loadNotes(): Promise<number> {
		let n = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const hit = this.texts.get(file.path);
			if (hit && hit.mtime === file.stat.mtime && hit.size === file.stat.size) continue;
			let text: string;
			try {
				text = await this.app.vault.cachedRead(file);
			} catch {
				// The note was deleted or moved during the read. Skip it, so the search still opens.
				continue;
			}
			this.texts.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, text });
			n++;
		}
		return n;
	}

	/** Plain note data for the evaluator, from the metadata cache and the text cache. */
	noteData(withText: boolean): NoteData[] {
		const resolved = this.app.metadataCache.resolvedLinks;
		return this.app.vault.getMarkdownFiles().map((file) => {
			const cache = this.app.metadataCache.getFileCache(file);
			// Body links, embeds and frontmatter links as written, as resolvedLinks has all three.
			const rawLinks = [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])].map((l) => l.link);
			return {
				path: file.path,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				tags: (cache ? (getAllTags(cache) ?? []) : []).map((t) => t.replace(/^#/, '')),
				links: Object.keys(resolved[file.path] ?? {}),
				rawLinks,
				frontmatter: cache?.frontmatter ?? null,
				content: withText ? (this.texts.get(file.path)?.text ?? '') : this.texts.get(file.path)?.text,
			};
		});
	}

	/** Runs a parsed query over the vault. */
	run(q: Query): SearchResult {
		const r = search(q, this.noteData(needsContent(q)), {
			allowPro: isPro(),
			createdProperty: this.settings.createdProperty,
			modifiedProperty: this.settings.modifiedProperty,
			resolve: (t) => this.app.metadataCache.getFirstLinkpathDest(t, '')?.path ?? null,
		});
		this.lastResult = r;
		return r;
	}

	async openPath(path: string, newTab: boolean): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f);
	}

	/** Inserts text at the cursor of the active note, or copies it when no note is in edit mode. Selected text stays. */
	async insertText(text: string): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.getMode() === 'source') {
			view.editor.replaceRange(text, view.editor.getCursor('to'));
			new Notice('Inserted the results as a list.');
			return;
		}
		await navigator.clipboard.writeText(text);
		new Notice('No note in edit mode, so the list is on the clipboard.');
	}
}

class SavedSearchModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private list: string[],
		private pick: (q: string) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a saved search');
	}
	getItems(): string[] {
		return this.list;
	}
	getItemText(item: string): string {
		return item;
	}
	onChooseItem(item: string): void {
		this.pick(item);
	}
}
