import { describe, expect, it, vi } from 'vitest';
import { DraftAcceptance } from './draftAcceptance';

describe('composer draft acceptance', () => {
  it('clears an unchanged draft accepted by its originating transaction', () => {
    const draft = new DraftAcceptance();
    draft.adopt('document-a', 'conversation-a');
    draft.change();
    const clear = vi.fn();
    const accepted = draft.capture(clear);
    draft.adopt('document-a', 'conversation-a');
    accepted();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer question, suggestion or external draft in the same conversation', () => {
    const draft = new DraftAcceptance();
    draft.adopt('document-a', 'conversation-a');
    const clear = vi.fn();
    const accepted = draft.capture(clear);
    draft.change();
    accepted();
    expect(clear).not.toHaveBeenCalled();
  });

  it('preserves a newer draft even when its text equals the submitted question', () => {
    const draft = new DraftAcceptance();
    draft.adopt('document-a', 'conversation-a');
    const submitted = 'Explain the governing equations';
    let question = submitted;
    const accepted = draft.capture(() => {
      draft.change();
      question = '';
    });
    // A later suggestion or external action can supply the same words again.
    draft.change();
    question = submitted;
    accepted();
    expect(question).toBe(submitted);
  });

  it('preserves another document draft even when both documents open the same conversation', () => {
    const draft = new DraftAcceptance();
    draft.adopt('document-a', 'shared-conversation');
    const clear = vi.fn();
    const accepted = draft.capture(clear);
    draft.adopt('document-b', 'shared-conversation');
    accepted();
    expect(clear).not.toHaveBeenCalled();
  });

  it('invalidates acceptance when a new conversation replaces the visible draft', () => {
    const draft = new DraftAcceptance();
    draft.adopt(null, 'conversation-a');
    const clear = vi.fn();
    const accepted = draft.capture(clear);
    draft.adopt(null, 'conversation-b');
    accepted();
    expect(clear).not.toHaveBeenCalled();
  });

  it('cannot clear a later draft after returning to the originating document', () => {
    const draft = new DraftAcceptance();
    draft.adopt('document-a', 'conversation-a');
    const clear = vi.fn();
    const accepted = draft.capture(clear);
    draft.adopt('document-b', 'conversation-b');
    draft.change();
    draft.adopt('document-a', 'conversation-a');
    accepted();
    expect(clear).not.toHaveBeenCalled();
  });
});
