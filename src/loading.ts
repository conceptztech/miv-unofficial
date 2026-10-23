const pageKey = (value: string) => value.split('#')[0];

// Each navigation owns its completion token, including the final animation.
export class LoadingState {
  revision = 0;
  url = '';
  loading = true;
  progress = 0.04;
  private completing = false;

  begin(url: string, force = false) {
    if (force || !this.loading || this.completing || pageKey(url) !== pageKey(this.url)) {
      this.revision += 1;
      this.progress = 0.04;
    }
    this.url = url;
    this.loading = true;
    this.completing = false;
    return this.revision;
  }

  advance(url: string, progress: number) {
    if (this.loading && !this.completing && pageKey(url) === pageKey(this.url) && Number.isFinite(progress)) {
      this.progress = Math.max(this.progress, Math.min(progress, 0.95));
    }
    return this.progress;
  }

  complete(url: string): number | null {
    if (!this.loading || pageKey(url) !== pageKey(this.url)) return null;
    this.completing = true;
    this.progress = 1;
    return this.revision;
  }

  hide(revision: number) {
    if (revision !== this.revision || !this.completing) return false;
    this.loading = false;
    this.completing = false;
    return true;
  }
}
