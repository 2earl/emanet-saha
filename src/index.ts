import { createApp } from './app';

/** Emanet Saha at saha.emanet.dev (emanet-core docs/DESIGN.md §6). */

const now = () => Math.floor(Date.now() / 1000);
const app = createApp(now);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
