// The Pro features of this plugin, one line each. The "What Pro adds" window, the README Pro section and notemods.com
// use these lines word for word. Each gate is a text of the Pro check in src; tests/what-pro.test.ts checks it.
// No imports with code: tools and tests read this file as plain data.
import type { WhatProFeature } from './license/github-obsidian';

export const PRO_FEATURES: WhatProFeature[] = [
	{
		id: 'or',
		line: 'Put OR between two groups of terms to find the notes that match either group.',
		gate: { file: 'src/query.ts', text: "q.pro.push('OR')" },
	},
	{
		id: 'not',
		line: 'Put a minus sign before a word or an operator to leave out the notes that match it.',
		gate: { file: 'src/query.ts', text: "q.pro.push('NOT')" },
	},
	{
		id: 'property',
		line: 'Property operators find notes by a property value, for example [status:done] or [priority:>5].',
		gate: { file: 'src/query.ts', text: "q.pro.push('property operators')" },
	},
	{
		id: 'list',
		line: 'Ctrl or Cmd + Shift + Enter writes the results into the open note as a Markdown list of links.',
		gate: { file: 'src/modal.ts', text: "needsPro('Results as a Markdown list is')" },
	},
	{
		id: 'saved',
		line: 'Ctrl or Cmd + S saves the search, and the command "Run a saved search" runs it again.',
		gate: { file: 'src/main.ts', text: "needsPro('Saved searches are')" },
	},
];
