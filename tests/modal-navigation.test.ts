import { expect, it, vi } from 'vitest';
import { Keymap } from 'obsidian';
import { OperatorSearchModal } from '../src/modal';
import type { Hit } from '../src/query';
it('uses the platform modifier to open a clicked result in a tab', () => {
 const openPath = vi.fn();
 const receiver = { plugin: { openPath } } as unknown as OperatorSearchModal;
 const hit = { path: 'Note.md' } as Hit;
 const modifier = vi.spyOn(Keymap, 'isModEvent');
 modifier.mockReturnValue(true);
 OperatorSearchModal.prototype.onChooseSuggestion.call(receiver, hit, new MouseEvent('click', { metaKey: true }));
 expect(openPath).toHaveBeenLastCalledWith('Note.md', true);
 modifier.mockReturnValue(false);
 OperatorSearchModal.prototype.onChooseSuggestion.call(receiver, hit, new MouseEvent('click'));
 expect(openPath).toHaveBeenLastCalledWith('Note.md', false);
 modifier.mockRestore();
});
