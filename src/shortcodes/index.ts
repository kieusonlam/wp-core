export { ShortcodeRegistry, parseAttributes, doShortcode } from './parser.js';
export type { ShortcodeHandler, ShortcodeAttrs } from './parser.js';

import { ShortcodeRegistry } from './parser.js';

/** Process-wide singleton registry — matches WP's `$shortcode_tags` global. */
export const shortcodes = new ShortcodeRegistry();
