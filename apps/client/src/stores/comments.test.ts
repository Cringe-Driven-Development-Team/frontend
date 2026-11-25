/// <reference types="bun" />
import { beforeEach, expect, test } from 'bun:test';
import { changeCount, initComments, openThread, toggleThread, useCommentsStore } from './comments';

beforeEach(() => initComments({}));

test('changeCount считает вверх и убирает ключ на нуле', () => {
    changeCount('a', 1);
    changeCount('a', 1);
    expect(useCommentsStore.getState().counts).toEqual({ a: 2 });
    changeCount('a', -1);
    changeCount('a', -1);
    expect(useCommentsStore.getState().counts).toEqual({});
});

test('init сбрасывает открытую ячейку', () => {
    openThread('a');
    initComments({ b: 1 });
    expect(useCommentsStore.getState()).toMatchObject({ openCellId: null, counts: { b: 1 } });
});

test('toggleThread дважды закрывает тред', () => {
    toggleThread('a');
    expect(useCommentsStore.getState().openCellId).toBe('a');
    toggleThread('a');
    expect(useCommentsStore.getState().openCellId).toBeNull();
});
