/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { commentTextValue } from './validate';

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
