import { createApp } from './app';

/** Emanet Saha at emanet-saha.2earl.com (emanet-core docs/DESIGN.md §6). */

const now = () => Math.floor(Date.now() / 1000);
const app = createApp(now);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
