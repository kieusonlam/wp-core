/**
 * WordPress-compatible shortcode parser.
 *
 * Mirrors WP's `do_shortcode()`. Handles:
 *   - Self-closing:        `[gallery ids="1,2,3"]`
 *   - Wrapping:            `[box title="Note"]Inner[/box]`
 *   - Attribute parsing:   quoted, unquoted, positional, with special chars
 *   - Escaping:            `[[shortcode]]` keeps literal brackets
 *   - Nested:              one level of `[outer][inner][/outer]` deep
 *
 * The regex below is the *exact* port of WP's `get_shortcode_regex` from
 * `wp-includes/shortcodes.php`, generalized to match any tag.
 */

/** A registered shortcode handler. */
export type ShortcodeHandler = (
  attrs: ShortcodeAttrs,
  content: string | null,
  tag: string,
) => string;

/** Parsed shortcode attributes — numeric keys for positional, string for named. */
export type ShortcodeAttrs = Record<string, string>;

/**
 * Registry that tracks tag → handler bindings. Matches WP's global
 * `$shortcode_tags` table.
 */
export class ShortcodeRegistry {
  private readonly handlers = new Map<string, ShortcodeHandler>();

  add(tag: string, handler: ShortcodeHandler): void {
    this.handlers.set(tag, handler);
  }

  remove(tag: string): void {
    this.handlers.delete(tag);
  }

  has(tag: string): boolean {
    return this.handlers.has(tag);
  }

  clear(): void {
    this.handlers.clear();
  }

  /** Get all registered tag names. */
  tags(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** Replace every registered shortcode in `content` with the handler output. */
  do(content: string): string {
    if (!content || this.handlers.size === 0) return content;
    if (!content.includes('[')) return content;
    const tagsPattern = Array.from(this.handlers.keys())
      .map(escapeRegex)
      .join('|');
    const regex = buildShortcodeRegex(tagsPattern);
    return content.replace(
      regex,
      (
        match: string,
        l1: string,
        tag: string,
        attrStr: string,
        _l2: string,
        inner: string | undefined,
        l3: string,
      ) => {
        // Escaped shortcode [[tag]] → output literal [tag] (matches WP)
        if (l1 === '[' && l3 === ']') {
          return match.slice(1, -1);
        }
        const handler = this.handlers.get(tag);
        if (!handler) return match;
        const attrs = parseAttributes(attrStr);
        const out = handler(attrs, inner !== undefined ? this.do(inner) : null, tag);
        return (l1 ?? '') + out + (l3 ?? '');
      },
    );
  }
}

/** Lift WP's `get_shortcode_regex` from PHP. */
function buildShortcodeRegex(tagsPattern: string): RegExp {
  // Capture groups (same ordering as WP):
  //   1: opening `[` literal (single = normal, double = escaped)
  //   2: tag name
  //   3: attributes string
  //   4: `/` if self-closing
  //   5: enclosed content (if wrapping)
  //   6: closing tag `[/foo]`
  //   7: closing `]` literal
  return new RegExp(
    '\\[' + // opening bracket
      '(\\[?)' + // (1) maybe escape `[`
      '(' + tagsPattern + ')' + // (2) tag name
      '(?![\\w-])' + // boundary
      '(' + // (3) attributes
      '[^\\]\\/]*' + // not `]` or `/`
      '(?:' +
      '\\/(?!\\])' + // `/` not followed by `]`
      '[^\\]\\/]*' +
      ')*?' +
      ')' +
      '(?:' +
      '(\\/)' + // (4) self-close `/`
      '\\]' +
      '|' +
      '\\]' +
      '(?:' +
      '(' + // (5) inner content
      '[^\\[]*' +
      '(?:' +
      '\\[(?!\\/\\2\\])' +
      '[^\\[]*' +
      ')*' +
      ')' +
      '\\[\\/\\2\\]' + // closing tag
      ')?' +
      ')' +
      '(\\]?)', // (7) trailing `]` for escapes
    'g',
  );
}

/** Escape a string for use inside a RegExp character pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a shortcode attribute string into a `{ name: value }` map.
 *
 * Matches WP's `shortcode_parse_atts`. Supports:
 *   key="value"   (double-quoted)
 *   key='value'   (single-quoted)
 *   key=value     (unquoted, no spaces)
 *   "positional"  (numeric-key, value-only quoted)
 *   positional    (numeric-key, value-only unquoted)
 */
export function parseAttributes(input: string): ShortcodeAttrs {
  const attrs: ShortcodeAttrs = {};
  if (!input) return attrs;
  const trimmed = input.replace(/[ ​]/g, ' ').trim();
  const pattern =
    /([\w-]+)\s*=\s*"([^"]*)"(?:\s|$)|([\w-]+)\s*=\s*'([^']*)'(?:\s|$)|([\w-]+)\s*=\s*([^\s'"]+)(?:\s|$)|"([^"]*)"(?:\s|$)|'([^']*)'(?:\s|$)|(\S+)(?:\s|$)/g;
  let match: RegExpExecArray | null;
  let positional = 0;
  while ((match = pattern.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      attrs[match[1].toLowerCase()] = decode(match[2] ?? '');
    } else if (match[3] !== undefined) {
      attrs[match[3].toLowerCase()] = decode(match[4] ?? '');
    } else if (match[5] !== undefined) {
      attrs[match[5].toLowerCase()] = decode(match[6] ?? '');
    } else if (match[7] !== undefined) {
      attrs[String(positional++)] = decode(match[7]);
    } else if (match[8] !== undefined) {
      attrs[String(positional++)] = decode(match[8]);
    } else if (match[9] !== undefined) {
      attrs[String(positional++)] = decode(match[9]);
    }
  }
  return attrs;
}

function decode(s: string): string {
  // WP html-decodes ampersand-encoded ASCII; we keep it simple.
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Convenience: parse + render in one call. */
export function doShortcode(content: string, registry: ShortcodeRegistry): string {
  return registry.do(content);
}
