/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { append, fromPage, prependOlder, remove, replace, type Comment } from './list';

const c = (id: number, text = `#${id}`): Comment => ({
    id,
    notebook_id: 1,
    cell_id: 'a',
    author: { id: 1, login: 'u' },
    text,
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:00:00Z',
    can_edit: true,
    can_delete: true,
});
const ids = (list: Comment[]) => list.map((item) => item.id);

test('fromPage: новые от Go первыми — в ленте старые сверху', () => {
    expect(ids(fromPage([c(3), c(2), c(1)]))).toEqual([1, 2, 3]);
});

test('prependOlder без дублей', () => {
    expect(ids(prependOlder([c(4), c(5)], [c(5), c(3), c(2)]))).toEqual([2, 3, 4, 5]);
});

test('append добавляет в конец', () => {
    expect(ids(append([c(1)], c(2)))).toEqual([1, 2]);
});

test('replace меняет только сообщение с тем же id', () => {
    const list = replace([c(1), c(2)], c(2, 'новый'));
    expect(list.map((item) => item.text)).toEqual(['#1', 'новый']);
});

test('remove убирает по id', () => {
    expect(ids(remove([c(1), c(2), c(3)], 2))).toEqual([1, 3]);
});
