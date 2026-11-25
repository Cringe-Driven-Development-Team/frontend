/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { commentTextValue, int, recordOf, validator } from './validate';

test('текст из одних пробелов не проходит', () => {
    expect(commentTextValue('  \n ').success).toBe(false);
});

test('длина считается в code points: 5000 эмодзи проходят, 5001 — нет', () => {
    expect(commentTextValue('😀'.repeat(5000)).success).toBe(true);
    expect(commentTextValue('😀'.repeat(5001)).success).toBe(false);
});

test('пробелы по краям проверке не мешают и не обрезаются', () => {
    const result = commentTextValue(' ok ');
    expect(result).toEqual({ success: true, data: ' ok ' });
});

test('recordOf: значения по ключам проходят общую проверку', () => {
    const counts = validator(recordOf(int({ min: 1 })));
    expect(counts({ a: 2 })).toEqual({ success: true, data: { a: 2 } });
    expect(counts({ a: 0 }).success).toBe(false);
    expect(counts({ a: '2' }).success).toBe(false);
    expect(counts([]).success).toBe(false);
    expect(counts(null).success).toBe(false);
});
