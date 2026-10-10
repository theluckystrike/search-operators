import { SuggestModal, type App } from 'obsidian';
import { isPro } from './pro';
import { parseQuery, textTerms, type Hit } from './query';
import { needsPro } from './main';
import type SearchOperatorsPlugin from './main';

const HELP = 'Try: modified:last-7d · created:>2026-09-01 · linksto:[[Note]] · linkedfrom:[[Note]] · tag:#project · path:Daily';

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Local date as YYYY-MM-DD. */
export function ymd(t: number): string {
	const d = new Date(t);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The search modal: type a query, see matching notes with a preview line, Enter opens one. */
export class OperatorSearchModal extends SuggestModal<Hit> {
	private statusEl: HTMLElement;
	private lastHits: Hit[] = [];
	private lastQuery = '';
	private terms: string[] = [];
	private ready = false;

	constructor(
		app: App,
		private plugin: SearchOperatorsPlugin,
		private initial = '',
	) {
		super(app);
		this.modalEl.addClass('search-operators-modal');
		this.setPlaceholder('Type words or operators, for example modified:last-7d');
		this.statusEl = createDiv({ cls: 'search-operators-status', text: 'Reading notes…' });
		this.resultContainerEl.before(this.statusEl);
		this.setInstructions([
			{ command: '↵', purpose: 'open' },
			{ command: 'mod ↵', purpose: 'open in new tab' },
			{ command: 'mod s', purpose: 'save search (Pro)' },
			{ command: 'mod shift ↵', purpose: 'insert results as a list (Pro)' },
		]);
		this.scope.register(['Mod'], 'Enter', (evt) => {
			const hit = this.selectedHit();
			if (hit) {
				evt.preventDefault();
				this.close();
				void this.plugin.openPath(hit.path, true);
			}
			return false;
		});
		this.scope.register(['Mod'], 's', (evt) => {
			evt.preventDefault();
			void this.plugin.saveSearch(this.inputEl.value);
			return false;
		});
		this.scope.register(['Mod', 'Shift'], 'Enter', (evt) => {
			evt.preventDefault();
			void this.insertList();
			return false;
		});
	}

	onOpen(): void {
		void super.onOpen();
		if (this.initial) this.inputEl.value = this.initial;
		void this.plugin.loadNotes().then(() => {
			this.ready = true;
			this.inputEl.dispatchEvent(new Event('input'));
		});
	}

	private selectedHit(): Hit | null {
		const chooser = (this as unknown as { chooser?: { selectedItem?: number } }).chooser;
		const i = chooser?.selectedItem ?? 0;
		return this.lastHits[i] ?? null;
	}

	/** Pro: writes the results as a Markdown list into the active note, or copies it when no note is open. */
	private async insertList(): Promise<void> {
		if (!isPro()) {
			needsPro('Results as a Markdown list is');
			return;
		}
		this.close();
		await this.plugin.insertResults(this.lastQuery);
	}

	getSuggestions(query: string): Hit[] {
		this.lastQuery = query;
		if (!this.ready) return [];
		const q = parseQuery(query, Date.now());
		this.terms = textTerms(q);
		const r = this.plugin.run(q);
		const shown = r.hits.slice(0, this.plugin.settings.maxResults);
		this.lastHits = shown;
		const notes = r.errors.length ? r.errors.join(' ') : '';
		if (r.blocked.length) {
			this.statusEl.setText(`${r.blocked.join(', ')}: this is a Pro feature. Pro adds OR, NOT and property operators. Sponsor on GitHub, then sign in from the plugin settings.`);
			this.statusEl.toggleClass('is-warning', true);
		} else if (r.empty) {
			this.statusEl.setText(notes || HELP);
			this.statusEl.toggleClass('is-warning', notes !== '');
		} else {
			const more = r.hits.length > shown.length ? `, showing ${shown.length}` : '';
			this.statusEl.setText(`${r.hits.length} ${r.hits.length === 1 ? 'note' : 'notes'}${more}${notes ? '. ' + notes : ''}`);
			this.statusEl.toggleClass('is-warning', notes !== '');
		}
		this.emptyStateText = r.empty ? 'Type a word or an operator.' : 'No notes match.';
		return shown;
	}

	renderSuggestion(hit: Hit, el: HTMLElement): void {
		el.addClass('search-operators-hit');
		const title = el.createDiv({ cls: 'search-operators-title' });
		this.highlight(title, hit.title);
		el.createDiv({ cls: 'search-operators-meta', text: `${hit.path} · created ${ymd(hit.created)} · modified ${ymd(hit.modified)}` });
		if (hit.preview) this.highlight(el.createDiv({ cls: 'search-operators-preview' }), hit.preview);
	}

	/** Writes text and marks the text terms with <mark>. */
	private highlight(el: HTMLElement, text: string): void {
		const terms = this.terms.filter((t) => t.length > 0);
		if (!terms.length) {
			el.setText(text);
			return;
		}
		const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
		for (const part of text.split(re)) {
			if (!part) continue;
			if (terms.includes(part.toLowerCase())) el.createEl('mark', { text: part });
			else el.appendText(part);
		}
	}

	onChooseSuggestion(hit: Hit): void {
		void this.plugin.openPath(hit.path, false);
	}
}
