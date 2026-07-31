import { parseRunnerDataset } from './runner-dataset';

describe('runner dataset parser', () => {
  it('parses a JSON array and preserves value types', () => {
    const result = parseRunnerDataset('[{"id":1,"enabled":true},{"id":2,"enabled":false}]', 'data.json');
    expect(result.rows).toEqual([{ id: 1, enabled: true }, { id: 2, enabled: false }]);
    expect(result.columns).toEqual(['id', 'enabled']);
  });

  it('accepts a JSON data wrapper', () => {
    expect(parseRunnerDataset('{"data":[{"name":"Ada"}]}', 'data.json').rows).toEqual([{ name: 'Ada' }]);
  });

  it('parses quoted CSV values, escaped quotes, and newlines', () => {
    const result = parseRunnerDataset('name,note\n"Ada, L.","said ""hello"""\nBob,"line 1\nline 2"', 'data.csv');
    expect(result.rows).toEqual([
      { name: 'Ada, L.', note: 'said "hello"' },
      { name: 'Bob', note: 'line 1\nline 2' }
    ]);
  });

  it('rejects invalid rows and unsafe variable names', () => {
    expect(() => parseRunnerDataset('[1]', 'data.json')).toThrow('row 1 must be an object');
    expect(() => parseRunnerDataset('__proto__,name\nx,Ada', 'data.csv')).toThrow('not allowed');
  });

  it('rejects empty and unsupported datasets', () => {
    expect(() => parseRunnerDataset('[]', 'data.json')).toThrow('at least one data row');
    expect(() => parseRunnerDataset('id\n', 'data.csv')).toThrow('header and at least one data row');
    expect(() => parseRunnerDataset('id=1', 'data.txt')).toThrow('.json or .csv');
  });
});
