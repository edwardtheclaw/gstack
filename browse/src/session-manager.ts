import { type Browser, type BrowserContext } from 'playwright';

export class SessionManager {
  private contexts: Map<string, BrowserContext> = new Map();

  constructor(private browser: Browser) {}

  async create(name: string): Promise<BrowserContext> {
    if (this.contexts.has(name)) {
      throw new Error(`Session '${name}' already exists`);
    }
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.contexts.set(name, context);
    return context;
  }

  get(name: string): BrowserContext {
    const context = this.contexts.get(name);
    if (!context) {
      throw new Error(`Session '${name}' not found`);
    }
    return context;
  }

  list(): string[] {
    return [...this.contexts.keys()];
  }

  async destroy(name: string): Promise<void> {
    const context = this.contexts.get(name);
    if (!context) {
      throw new Error(`Session '${name}' not found`);
    }
    await context.close();
    this.contexts.delete(name);
  }
}
