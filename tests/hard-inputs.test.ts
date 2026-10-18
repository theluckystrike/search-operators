import { expect, it } from 'vitest';
import { parseQuery, search, type NoteData } from '../src/query';
const note: NoteData = { path: 'Long.md', ctime: 0, mtime: 0, tags: [], links: [], frontmatter: null, content: Array.from({ length: 4999 }, () => 'padding').join('\n') + '\nHe said "hello world" and /a+b/.' };
it('finds escaped quotes at the end of a 5000 line note', () => {
 const q = parseQuery(String.raw`"He said \"hello world\""`, Date.now());
 expect(search(q, [note], { allowPro: false }).hits).toHaveLength(1);
});
it('treats regular expression characters as literal text', () => {
 expect(search(parseQuery('/a+b/', Date.now()), [note], { allowPro: false }).hits).toHaveLength(1);
 expect(search(parseQuery('/a.*b/', Date.now()), [note], { allowPro: false }).hits).toHaveLength(0);
});
it('does not drop an invalid date clause and return broader results', () => {
 const result = search(parseQuery('padding created:invalid', Date.now()), [note], { allowPro: false });
 expect(result.errors).toHaveLength(1);
 expect(result.hits).toHaveLength(0);
});
