import { describe, expect, it } from 'vitest';
import {
  isSerialized,
  maybeSerialize,
  maybeUnserialize,
} from '../src/meta/serialization.js';

describe('isSerialized', () => {
  it('detects assoc array', () => {
    expect(isSerialized('a:1:{s:3:"foo";s:3:"bar";}')).toBe(true);
  });
  it('detects null token', () => {
    expect(isSerialized('N;')).toBe(true);
  });
  it('rejects plain strings', () => {
    expect(isSerialized('hello world')).toBe(false);
  });
  it('rejects numbers', () => {
    expect(isSerialized(42)).toBe(false);
  });
});

describe('maybeUnserialize', () => {
  it('passes through scalars', () => {
    expect(maybeUnserialize('hello')).toBe('hello');
    expect(maybeUnserialize(42)).toBe(42);
  });

  it('decodes PHP arrays into JS arrays when keys are sequential', () => {
    // a:3:{i:0;s:1:"a";i:1;s:1:"b";i:2;s:1:"c";}
    const input = 'a:3:{i:0;s:1:"a";i:1;s:1:"b";i:2;s:1:"c";}';
    expect(maybeUnserialize(input)).toEqual(['a', 'b', 'c']);
  });

  it('decodes PHP assoc arrays into JS objects', () => {
    const input = 'a:2:{s:3:"foo";s:3:"bar";s:1:"x";i:1;}';
    expect(maybeUnserialize(input)).toEqual({ foo: 'bar', x: 1 });
  });
});

describe('maybeSerialize', () => {
  it('passes strings through', () => {
    expect(maybeSerialize('hello')).toBe('hello');
  });
  it('serializes objects', () => {
    const out = maybeSerialize({ foo: 'bar' });
    expect(out).toContain('a:1:');
    expect(out).toContain('"foo"');
    expect(out).toContain('"bar"');
  });
  it('round-trips assoc arrays', () => {
    const obj = { name: 'Tekcom', area: 12000, lights: 180 };
    const serialized = maybeSerialize(obj);
    expect(maybeUnserialize(serialized)).toEqual(obj);
  });
  it('round-trips nested structures with UTF-8', () => {
    const obj = {
      title: 'Đèn LED nhà xưởng',
      specs: { power: '100W', ip: 'IP65' },
      bullets: ['Tản nhiệt', 'CRI ≥ 80'],
    };
    expect(maybeUnserialize(maybeSerialize(obj))).toEqual(obj);
  });
});
