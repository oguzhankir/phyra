/** Only the transaction that captured the current composer draft may clear it. */
export class DraftAcceptance {
  private owner: string | null = null;
  private generation = 0;

  adopt(documentId: string | null, conversationId: string) {
    const owner = JSON.stringify([documentId, conversationId]);
    if (this.owner !== owner) {
      this.owner = owner;
      this.change();
    }
  }

  change() {
    this.generation++;
  }

  capture(clear: () => void) {
    const generation = this.generation;
    return () => {
      if (generation === this.generation) clear();
    };
  }
}
