// The query language of Search Operators: a parser and an evaluator over plain note data.
// No Obsidian imports here, so the golden vectors and unit tests run without the app.

export type DateField = 'created' | 'modified';
export type SortKey = 'relevance' | 'modified' | 'created' | 'name';
export type PropOp = 'exists' | 'eq' | 'gt' | 'ge' | 'lt' | 'le';

/** A time span [from, to) in ms since the epoch. null = open end. */
export interface DateRange {
	from: number | null;
	to: number | null;
}

export type Clause =
	| { kind: 'text'; value: string; negate: boolean }
	| { kind: 'date'; field: DateField; range: DateRange; negate: boolean }
	| { kind: 'linksto' | 'linkedfrom'; target: string; wildcard: boolean; negate: boolean }
	| { kind: 'tag' | 'path' | 'file'; value: string; negate: boolean }
	| { kind: 'prop'; key: string; op: PropOp; value: string; negate: boolean };

export interface Query {
	/** OR of groups; each group is an AND of clauses. */
	groups: Clause[][];
	sort: SortKey | null;
	errors: string[];
	/** Pro features the query uses: OR, NOT, property operators. */
	pro: string[];
}

export interface NoteData {
	path: string;
	ctime: number;
	mtime: number;
	/** Tags without '#'. */
	tags: string[];
	/** Paths of the notes this note links to (resolved links only). */
	links: string[];
	/** Link texts of this note as written, with alias and heading kept (unresolved links included). */
	rawLinks?: string[];
	frontmatter: Record<string, unknown> | null;
	/** Note text. Leave undefined when the query has no text term; then no preview is made. */
	content?: string;
}

export interface SearchOptions {
	/** Pro features run only when this is true. */
	allowPro: boolean;
	/** Frontmatter key that holds the created date. Empty = file creation time. */
	createdProperty?: string;
	/** Frontmatter key that holds the modified date. Empty = file modification time. */
	modifiedProperty?: string;
	/** Link text to note path. Default: match by path, then by file name, case-insensitive. */
	resolve?: (linktext: string) => string | null;
}

export interface Hit {
	path: string;
	title: string;
	created: number;
	modified: number;
	score: number;
	preview: string;
}

export interface SearchResult {
	hits: Hit[];
	errors: string[];
	/** Pro features in the query that did not run (no Pro). When not empty, hits is empty. */
	blocked: string[];
	/** True when the query holds no operator and no text: nothing to search. */
	empty: boolean;
}

const DAY = 86_400_000;
const OPERATORS = new Set(['created', 'modified', 'linksto', 'linkedfrom', 'tag', 'path', 'file', 'sort']);
const SORTS = new Set<SortKey>(['relevance', 'modified', 'created', 'name']);
const PREVIEW_MAX = 140;

/** Splits a query into tokens. Quotes, [[links]] and [property] brackets stay in one token. */
export function tokenize(text: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote = false;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? '';
		if (ch === '"' && depth === 0) quote = !quote;
		else if (!quote && ch === '[') depth++;
		else if (!quote && ch === ']' && depth > 0) depth--;
		if (!quote && depth === 0 && /\s/.test(ch)) {
			if (cur) out.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	if (cur) out.push(cur);
	return out;
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s.replace(/^"/, ''));

/** [[Note|alias]] or [[Note#Heading]] or Note to "Note". */
export function linkTarget(raw: string): string {
	let t = unquote(raw.trim());
	if (t.startsWith('[[') && t.endsWith(']]')) t = t.slice(2, -2);
	t = t.split('|')[0] ?? '';
	t = t.split('#')[0] ?? '';
	return t.trim();
}

/** Local midnight of a date. */
const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime();

/** True when day d is in that month, so 2026-02-31 is not a date. */
const realDay = (y: number, m: number, d: number): boolean => new Date(y, m - 1, d).getDate() === d;

/** A date token as a span: YYYY-MM-DD (one day), YYYY-MM (month), YYYY (year), today, yesterday. */
function tokenSpan(tok: string, now: number): DateRange | null {
	const t = tok.toLowerCase();
	const n = new Date(now);
	const today = day(n.getFullYear(), n.getMonth() + 1, n.getDate());
	if (t === 'today') return { from: today, to: day(n.getFullYear(), n.getMonth() + 1, n.getDate() + 1) };
	if (t === 'yesterday') return { from: day(n.getFullYear(), n.getMonth() + 1, n.getDate() - 1), to: today };
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
	if (m) {
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		if (mo < 1 || mo > 12 || d < 1 || !realDay(y, mo, d)) return null;
		return { from: day(y, mo, d), to: day(y, mo, d + 1) };
	}
	m = /^(\d{4})-(\d{1,2})$/.exec(t);
	if (m) {
		const [y, mo] = [Number(m[1]), Number(m[2])];
		if (mo < 1 || mo > 12) return null;
		return { from: day(y, mo, 1), to: day(y, mo + 1, 1) };
	}
	m = /^(\d{4})$/.exec(t);
	if (m) return { from: day(Number(m[1]), 1, 1), to: day(Number(m[1]) + 1, 1, 1) };
	return null;
}

/** last-7d, last-2w, last-3m, last-1y: from that long before now, with no end. */
function lastSpan(tok: string, now: number): DateRange | null {
	const m = /^last-?(\d{1,4})([dwmy])$/i.exec(tok);
	if (!m) return null;
	const k = Number(m[1]);
	const unit = (m[2] ?? 'd').toLowerCase();
	if (unit === 'd' || unit === 'w') return { from: now - k * (unit === 'd' ? 1 : 7) * DAY, to: null };
	const d = new Date(now);
	if (unit === 'm') d.setMonth(d.getMonth() - k);
	else d.setFullYear(d.getFullYear() - k);
	return { from: d.getTime(), to: null };
}

/**
 * A date operator value as a span, or an error text.
 * 2026-09-01 = that day. >2026-09-01 = after that day. >= <= < as you expect. a..b = from a to b, both days included.
 */
export function parseDateSpec(spec: string, now: number): DateRange | string {
	const s = unquote(spec.trim());
	const bad = `"${s}" is not a date. Use 2026-09-01, 2026-09, 2026, today, yesterday, last-7d or a range like 2026-09-01..2026-09-30.`;
	if (!s) return bad;
	const last = lastSpan(s, now);
	if (last) return last;
	const range = /^(.+?)\.\.(.+)$/.exec(s);
	if (range) {
		const a = tokenSpan(range[1] ?? '', now);
		const b = tokenSpan(range[2] ?? '', now);
		if (!a || !b) return bad;
		return { from: a.from, to: b.to };
	}
	const m = /^(>=|<=|>|<)?(.+)$/.exec(s);
	const op = m?.[1] ?? '';
	const span = tokenSpan(m?.[2] ?? '', now);
	if (!span) return bad;
	if (op === '>') return { from: span.to, to: null };
	if (op === '>=') return { from: span.from, to: null };
	if (op === '<') return { from: null, to: span.from };
	if (op === '<=') return { from: null, to: span.to };
	return span;
}

/** [key], [key:value], [key:>value], [key:>=value], [key:<value], [key:<=value]. */
function parseProp(body: string): { key: string; op: PropOp; value: string } | null {
	const i = body.indexOf(':');
	if (i < 0) return body.trim() ? { key: body.trim(), op: 'exists', value: '' } : null;
	const key = body.slice(0, i).trim();
	const rest = body.slice(i + 1).trim();
	if (!key) return null;
	const m = /^(>=|<=|>|<)?(.*)$/.exec(rest);
	const ops: Record<string, PropOp> = { '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le' };
	const op = ops[m?.[1] ?? ''] ?? 'eq';
	const value = unquote((m?.[2] ?? '').trim());
	if (!value) return { key, op: 'exists', value: '' };
	return { key, op, value };
}

/** Parses one token into a clause, a sort key, or an error. */
function parseToken(token: string, now: number): Clause | { sort: SortKey } | { error: string } {
	let t = token;
	let negate = false;
	if (t.length > 1 && t.startsWith('-')) {
		negate = true;
		t = t.slice(1);
	}
	if (t.startsWith('[') && t.endsWith(']') && !t.startsWith('[[')) {
		const p = parseProp(t.slice(1, -1));
		return p ? { kind: 'prop', ...p, negate } : { error: `"${token}" is not a property operator. Use [status:done] or [due:<2026-10-01].` };
	}
	const m = /^([a-z]+):(.*)$/i.exec(t);
	const op = m?.[1]?.toLowerCase() ?? '';
	if (!m || !OPERATORS.has(op)) return { kind: 'text', value: unquote(t).toLowerCase(), negate };
	const value = m[2] ?? '';
	if (!value) return { error: `${op}: needs a value.` };
	if (op === 'sort') {
		const k = value.toLowerCase() as SortKey;
		return SORTS.has(k) ? { sort: k } : { error: `sort:${value} is unknown. Use sort:modified, sort:created, sort:name or sort:relevance.` };
	}
	if (op === 'created' || op === 'modified') {
		const r = parseDateSpec(value, now);
		return typeof r === 'string' ? { error: `${op}: ${r}` } : { kind: 'date', field: op, range: r, negate };
	}
	if (op === 'linksto' || op === 'linkedfrom') {
		const target = linkTarget(value);
		return target ? { kind: op, target, wildcard: /[*?]/.test(target), negate } : { error: `${op}: needs a note name, like ${op}:[[Project plan]].` };
	}
	const v = unquote(value).toLowerCase();
	if (op === 'tag') return { kind: 'tag', value: v.replace(/^#/, ''), negate };
	return { kind: op === 'path' ? 'path' : 'file', value: v, negate };
}

/** Parses a query. now = the time "today" and "last-7d" count from. */
export function parseQuery(text: string, now: number): Query {
	const q: Query = { groups: [[]], sort: null, errors: [], pro: [] };
	for (const token of tokenize(text)) {
		if (token === 'OR') {
			if ((q.groups[q.groups.length - 1] ?? []).length) q.groups.push([]);
			continue;
		}
		const r = parseToken(token, now);
		// An empty phrase ("" or a lone quote while you type) is in each note, so it is not a term.
		if ('kind' in r && r.kind === 'text' && r.value === '') continue;
		if ('error' in r) q.errors.push(r.error);
		else if ('sort' in r) q.sort = r.sort;
		else q.groups[q.groups.length - 1]?.push(r);
	}
	q.groups = q.groups.filter((g) => g.length);
	const all = q.groups.flat();
	if (q.groups.length > 1) q.pro.push('OR');
	if (all.some((c) => c.negate)) q.pro.push('NOT');
	if (all.some((c) => c.kind === 'prop')) q.pro.push('property operators');
	return q;
}

/** A frontmatter value as a time in ms: a number (ms) or a date text in local time. null when it is neither. */
export function parseLocalTime(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v !== 'string') return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
	if (!m) return null;
	const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
	return Number.isFinite(t) ? t : null;
}

function propValue(fm: Record<string, unknown> | null, key: string): unknown {
	if (!fm) return undefined;
	const k = key.toLowerCase();
	const hit = Object.keys(fm).find((x) => x.toLowerCase() === k);
	return hit === undefined ? undefined : fm[hit];
}

/** The created and modified times of a note, from the chosen properties or the file. */
export function noteTimes(note: NoteData, opts: SearchOptions): { created: number; modified: number } {
	const c = opts.createdProperty ? parseLocalTime(propValue(note.frontmatter, opts.createdProperty)) : null;
	const m = opts.modifiedProperty ? parseLocalTime(propValue(note.frontmatter, opts.modifiedProperty)) : null;
	return { created: c ?? note.ctime, modified: m ?? note.mtime };
}

const basename = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

/** Default link resolution: exact path (with or without .md), then file name. Case-insensitive. */
export function makeResolver(paths: string[]): (linktext: string) => string | null {
	const byPath = new Map<string, string>();
	const byName = new Map<string, string>();
	for (const p of [...paths].sort()) {
		const lp = p.toLowerCase();
		byPath.set(lp, p);
		byPath.set(lp.replace(/\.md$/, ''), p);
		const n = basename(p).toLowerCase();
		if (!byName.has(n)) byName.set(n, p);
	}
	return (t) => {
		const k = t.trim().toLowerCase();
		return byPath.get(k) ?? byName.get(k) ?? null;
	};
}

/** Turn a pattern with '*' and '?' into a case-insensitive RegExp. Other characters are plain. */
const wildcardRegExp = (pattern: string): RegExp => {
	let out = '';
	for (const ch of pattern) {
		if (ch === '*') out += '.*';
		else if (ch === '?') out += '.';
		else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${out}$`, 'i');
};

/**
 * True when a pattern matches a note path the way Obsidian resolves a link: the full path or any end part
 * of it that starts after a '/', with or without .md. So `Projects/*` finds a Projects folder at any depth.
 */
const patternHitsPath = (rx: RegExp, path: string): boolean => {
	for (const p of [path, path.replace(/\.md$/i, '')]) {
		for (let i = 0; i >= 0; i = p.indexOf('/', i) + 1 || -1) if (rx.test(p.slice(i))) return true;
	}
	return false;
};

const asTexts = (v: unknown): string[] => {
	if (v === null || v === undefined) return [];
	if (Array.isArray(v)) return v.flatMap(asTexts);
	if (typeof v === 'string') return [linkTarget(v) || v];
	if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
	return [];
};

function compare(a: string, b: string): number {
	const na = Number(a);
	const nb = Number(b);
	if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
	return a.localeCompare(b);
}

function propMatch(fm: Record<string, unknown> | null, c: Extract<Clause, { kind: 'prop' }>): boolean {
	const values = asTexts(propValue(fm, c.key)).filter((x) => x !== '');
	if (c.op === 'exists') return values.length > 0;
	const want = c.value.toLowerCase();
	return values.some((raw) => {
		const v = raw.toLowerCase();
		if (c.op === 'eq') return v === want || v.includes(want);
		const d = compare(v, want);
		return c.op === 'gt' ? d > 0 : c.op === 'ge' ? d >= 0 : c.op === 'lt' ? d < 0 : d <= 0;
	});
}

const inRange = (t: number, r: DateRange): boolean => (r.from === null || t >= r.from) && (r.to === null || t < r.to);

interface Ctx {
	opts: SearchOptions;
	resolve: (linktext: string) => string | null;
	byPath: Map<string, NoteData>;
	errors: Set<string>;
	/** Wildcard RegExps and linkedfrom target sets, made once for each query, not once for each note. */
	patterns: Map<string, RegExp>;
	linkedFrom: Map<string, Set<string>>;
}

/** Score of one clause on a note: 0 = no match. Text terms score by where they hit. */
function clauseScore(c: Clause, note: NoteData, times: { created: number; modified: number }, ctx: Ctx): number {
	switch (c.kind) {
		case 'text': {
			const title = basename(note.path).toLowerCase();
			let s = title.includes(c.value) ? 10 : note.path.toLowerCase().includes(c.value) ? 3 : 0;
			const body = (note.content ?? '').toLowerCase();
			// Text hits add 1 to 9, less than the 10 of a title hit, so a title hit ranks first.
			if (body.includes(c.value)) s += 1 + Math.min(8, body.split(c.value).length - 2);
			return s;
		}
		case 'date':
			return inRange(c.field === 'created' ? times.created : times.modified, c.range) ? 1 : 0;
		case 'linksto':
		case 'linkedfrom': {
			if (c.wildcard) {
				// A pattern target matches the link text as written, so links to notes that do not
				// exist also count (forum topic 11567). No resolve, no error.
				let rx = ctx.patterns.get(c.target);
				if (!rx) ctx.patterns.set(c.target, (rx = wildcardRegExp(c.target)));
				if (c.kind === 'linksto') {
					// Strip [[ ]], then the alias and heading parts, as linkTarget does.
					const head = (l: string): string => {
						const bare = l.replace(/^\[\[/, '').replace(/\]\]$/, '');
						return (bare.split('|')[0] ?? '').split('#')[0] ?? '';
					};
					// Most wiki links name the note without its folder, so the pattern matches the
					// resolved link path too.
					return (note.rawLinks ?? []).some((l) => rx.test(head(l))) || note.links.some((l) => patternHitsPath(rx, l)) ? 1 : 0;
				}
				// linkedfrom with a pattern: the pattern matches source notes by path or file name.
				let targets = ctx.linkedFrom.get(c.target);
				if (!targets) {
					targets = new Set();
					for (const src of ctx.byPath.values()) if (patternHitsPath(rx, src.path)) for (const l of src.links) targets.add(l);
					ctx.linkedFrom.set(c.target, targets);
				}
				return targets.has(note.path) ? 1 : 0;
			}
			const target = ctx.resolve(c.target);
			if (!target) {
				ctx.errors.add(`No note named "${c.target}".`);
				return 0;
			}
			if (c.kind === 'linksto') return note.links.includes(target) ? 1 : 0;
			return (ctx.byPath.get(target)?.links ?? []).includes(note.path) ? 1 : 0;
		}
		case 'tag':
			return note.tags.some((t) => {
				const x = t.toLowerCase().replace(/^#/, '');
				return x === c.value || x.startsWith(c.value + '/');
			})
				? 1
				: 0;
		case 'path':
			return note.path.toLowerCase().includes(c.value) ? 1 : 0;
		case 'file':
			return (note.path.split('/').pop() ?? '').toLowerCase().includes(c.value) ? 1 : 0;
		case 'prop':
			return propMatch(note.frontmatter, c) ? 1 : 0;
	}
}

/** Score of a group (AND): 0 when a clause fails. */
function groupScore(g: Clause[], note: NoteData, times: { created: number; modified: number }, ctx: Ctx): number {
	let total = 1;
	for (const c of g) {
		const s = clauseScore(c, note, times, ctx);
		if (c.negate ? s > 0 : s === 0) return 0;
		if (!c.negate) total += s;
	}
	return total;
}

/** The first line with a text term, cut around the term; else the first line that is not a heading. Frontmatter is skipped. */
export function previewLine(content: string, terms: string[]): string {
	const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
	const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
	const clean = (l: string): string => l.replace(/^(#{1,6}\s+|[-*+]\s+(\[.\]\s+)?|>\s*|\d+\.\s+)/, '');
	for (const term of terms) {
		const line = lines.find((l) => l.toLowerCase().includes(term));
		if (!line) continue;
		const text = clean(line);
		const at = text.toLowerCase().indexOf(term);
		if (text.length <= PREVIEW_MAX || at < 0) return text.slice(0, PREVIEW_MAX);
		const start = Math.max(0, Math.min(at - 40, text.length - PREVIEW_MAX));
		return (start > 0 ? '…' : '') + text.slice(start, start + PREVIEW_MAX).trim() + (start + PREVIEW_MAX < text.length ? '…' : '');
	}
	// No term hit: the first line of body text, so a heading that repeats the title is not the preview.
	const first = lines.find((l) => !/^#{1,6}\s/.test(l)) ?? lines[0];
	if (first === undefined) return '';
	const text = clean(first);
	return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX).trim() + '…' : text;
}

/** Text terms of a query (not negated), for highlight and preview. */
export const textTerms = (q: Query): string[] => [...new Set(q.groups.flat().flatMap((c) => (c.kind === 'text' && !c.negate ? [c.value] : [])))];

/** True when a query has a text term, so note text must be read. */
export const needsContent = (q: Query): boolean => q.groups.flat().some((c) => c.kind === 'text');

function sortHits(hits: Hit[], key: SortKey): Hit[] {
	const by: Record<SortKey, (a: Hit, b: Hit) => number> = {
		relevance: (a, b) => b.score - a.score || b.modified - a.modified || a.path.localeCompare(b.path),
		modified: (a, b) => b.modified - a.modified || a.path.localeCompare(b.path),
		created: (a, b) => b.created - a.created || a.path.localeCompare(b.path),
		name: (a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path),
	};
	return [...hits].sort(by[key]);
}

/** Runs a query over notes. Sort: sort: operator, else relevance with text terms, else newest modified first. */
export function search(query: Query, notes: NoteData[], opts: SearchOptions): SearchResult {
	const ctx: Ctx = { opts, resolve: opts.resolve ?? makeResolver(notes.map((n) => n.path)), byPath: new Map(notes.map((n) => [n.path, n])), errors: new Set(query.errors), patterns: new Map(), linkedFrom: new Map() };
	if (!query.groups.length) return { hits: [], errors: [...ctx.errors], blocked: [], empty: true };
	if (query.pro.length && !opts.allowPro) return { hits: [], errors: [...ctx.errors], blocked: [...query.pro], empty: false };
	const terms = textTerms(query);
	const hits: Hit[] = [];
	for (const note of notes) {
		const times = noteTimes(note, opts);
		let score = 0;
		for (const g of query.groups) score = Math.max(score, groupScore(g, note, times, ctx));
		if (score === 0) continue;
		const preview = note.content === undefined ? '' : previewLine(note.content, terms);
		hits.push({ path: note.path, title: basename(note.path), created: times.created, modified: times.modified, score, preview });
	}
	return { hits: sortHits(hits, query.sort ?? (terms.length ? 'relevance' : 'modified')), errors: [...ctx.errors], blocked: [], empty: false };
}

/** Results as a Markdown list of wiki links, one per note. */
export function toMarkdownList(hits: Hit[], query: string): string {
	const lines = hits.map((h) => `- [[${h.path.replace(/\.md$/i, '')}|${h.title}]]`);
	return `Search: \`${query.replace(/`/g, "'")}\` (${hits.length} notes)\n\n${lines.join('\n')}\n`;
}
