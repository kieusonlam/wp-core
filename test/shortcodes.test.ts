import { describe, expect, it } from 'vitest';
import { ShortcodeRegistry, parseAttributes } from '../src/shortcodes/parser.js';

describe('parseAttributes', () => {
  it('parses double-quoted attrs', () => {
    expect(parseAttributes('title="Hello World"')).toEqual({ title: 'Hello World' });
  });
  it('parses single-quoted attrs', () => {
    expect(parseAttributes("name='foo'")).toEqual({ name: 'foo' });
  });
  it('parses unquoted attrs', () => {
    expect(parseAttributes('size=large')).toEqual({ size: 'large' });
  });
  it('parses multiple attrs', () => {
    expect(parseAttributes('a="1" b=2 c=\'three\'')).toEqual({ a: '1', b: '2', c: 'three' });
  });
  it('lowercases attr names', () => {
    expect(parseAttributes('Title="X"')).toEqual({ title: 'X' });
  });
  it('handles positional values', () => {
    expect(parseAttributes('"first" second')).toEqual({ '0': 'first', '1': 'second' });
  });
});

describe('ShortcodeRegistry', () => {
  it('renders a self-closing shortcode', () => {
    const r = new ShortcodeRegistry();
    r.add('greet', (attrs) => `Hello, ${attrs.name ?? 'world'}!`);
    expect(r.do('Say [greet name="Kieu"] please.')).toBe('Say Hello, Kieu! please.');
  });

  it('renders a wrapping shortcode with inner content', () => {
    const r = new ShortcodeRegistry();
    r.add('caps', (_attrs, inner) => (inner ?? '').toUpperCase());
    expect(r.do('Be [caps]quiet[/caps].')).toBe('Be QUIET.');
  });

  it('leaves unregistered shortcodes intact', () => {
    const r = new ShortcodeRegistry();
    r.add('foo', () => 'X');
    expect(r.do('[bar attr="x"]')).toBe('[bar attr="x"]');
  });

  it('processes nested shortcodes one level deep', () => {
    const r = new ShortcodeRegistry();
    r.add('outer', (_a, inner) => `<o>${inner}</o>`);
    r.add('inner', (a) => `(${a.x})`);
    expect(r.do('[outer][inner x="1"][/outer]')).toBe('<o>(1)</o>');
  });

  it('respects escaped [[shortcode]] form', () => {
    const r = new ShortcodeRegistry();
    r.add('foo', () => 'X');
    expect(r.do('[[foo]]')).toBe('[foo]');
  });

  it('returns content unchanged when no brackets are present', () => {
    const r = new ShortcodeRegistry();
    r.add('foo', () => 'X');
    expect(r.do('Hello world')).toBe('Hello world');
  });
});
