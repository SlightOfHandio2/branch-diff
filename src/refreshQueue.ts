// Coalesce requests arriving during a refresh into one subsequent pass.
export class RefreshQueue {
  private running: Promise<void> | undefined;
  private pending = false;
  private showErrors = false;

  constructor(private readonly refresh: (showErrors: boolean) => Promise<void>) {}

  request(showErrors = false): Promise<void> {
    this.pending = true;
    this.showErrors ||= showErrors;
    if (!this.running) {
      // Start on the next microtask so running is assigned before the callback.
      this.running = Promise.resolve().then(async () => {
        try {
          while (this.pending) {
            const errors = this.showErrors;
            this.pending = false;
            this.showErrors = false;
            await this.refresh(errors);
          }
        } finally {
          this.running = undefined;
        }
      });
    }
    return this.running;
  }
}
