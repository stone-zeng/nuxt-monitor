/** A bounded decoder: chunks need not end on a line boundary. */
export class JsonLines {
  private pending = "";
  constructor(
    private readonly consume: (value: unknown) => void,
    private readonly invalid: () => void,
  ) {}
  push(chunk: string) {
    this.pending += chunk;
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (!line.trim()) continue;
      if (line.length > 65536) {
        this.invalid();
        continue;
      }
      try {
        this.consume(JSON.parse(line));
      } catch {
        this.invalid();
      }
    }
    if (this.pending.length > 65536) {
      this.pending = "";
      this.invalid();
    }
  }
}
