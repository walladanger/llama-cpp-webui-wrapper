import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ModelLoadTracker,
	loadProgress,
	type LoadTrackerState
} from '../../src/lib/services/model-load-tracker';
import type { ApiModelDataEntry, ApiModelsSseEvent } from '../../src/lib/types/api';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
function model(id = 'a', status = 'unloaded'): ApiModelDataEntry {
	return { id, status: { value: status } } as ApiModelDataEntry;
}
function event(id: string, status: string, progress?: unknown): ApiModelsSseEvent {
	return { event: 'status_update', model: id, data: { status, progress } } as ApiModelsSseEvent;
}
const progress = { stages: ['text_model', 'spec_model'], current: 'text_model', value: 0.8741 };
const trackers: ModelLoadTracker[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const tracker of trackers.splice(0)) tracker.stop();
	vi.useRealTimers();
});
async function setup(initial = [model()]) {
	let rows = initial;
	let state: LoadTrackerState = { cards: [], live: false, error: null };
	let emit!: (event: ApiModelsSseEvent) => void;
	let connection!: (live: boolean) => void;
	let signal!: AbortSignal;
	const backend = {
		list: vi.fn(async () => rows),
		load: vi.fn(async (_id: string) => {}),
		unload: vi.fn(async (_id: string) => {}),
		watch: vi.fn(
			(
				abort: AbortSignal,
				receive: (event: ApiModelsSseEvent) => void,
				connected: (live: boolean) => void
			) => {
				signal = abort;
				emit = receive;
				connection = connected;
				return new Promise<void>((resolve) =>
					abort.addEventListener('abort', () => resolve(), { once: true })
				);
			}
		)
	};
	const changed = vi.fn((value: LoadTrackerState) => (state = value));
	const tracker = new ModelLoadTracker(backend, changed, () => {});
	trackers.push(tracker);
	tracker.start();
	await tracker.refresh();
	return {
		tracker,
		backend,
		changed,
		emit,
		connection,
		get state() {
			return state;
		},
		get signal() {
			return signal;
		},
		setRows(value: ApiModelDataEntry[]) {
			rows = value;
		}
	};
}

describe('model loading progress', () => {
	it('keeps reported percentages specific to the current stage', () => {
		expect(loadProgress(progress)).toEqual({
			stage: 'Loading weights',
			fraction: 0.8741,
			stageIndex: 1,
			stageCount: 2
		});
		expect(loadProgress({ ...progress, current: 'spec_model', value: 0.2 })?.stageIndex).toBe(2);
	});
	it('rejects percentages, invalid fractions and unknown or ambiguous stages', () => {
		for (const value of [NaN, Infinity, -1, 87.41])
			expect(loadProgress({ ...progress, value })).toBeNull();
		expect(loadProgress({ ...progress, current: 'unknown' })).toBeNull();
		expect(loadProgress({ ...progress, stages: ['text_model', 'text_model'] })).toBeNull();
	});
	it('shows existing loaded and sleeping models without starting anything', async () => {
		const s = await setup([model('a', 'loaded'), model('b', 'sleeping'), model('c')]);
		expect(s.state.cards.map((row) => row.phase)).toEqual(['loaded', 'sleeping']);
		expect(s.backend.load).not.toHaveBeenCalled();
	});
	it('does not regress a ready SSE event when POST /load returns later', async () => {
		const s = await setup();
		const pending = deferred<void>();
		s.backend.load.mockReturnValue(pending.promise);
		const loading = s.tracker.load('a');
		expect(s.state.cards[0].phase).toBe('starting');
		s.emit(event('a', 'loading', progress));
		expect(s.state.cards[0].progress?.fraction).toBe(0.8741);
		s.emit(event('a', 'loaded'));
		s.setRows([model('a', 'loaded')]);
		pending.resolve();
		await loading;
		expect(s.state.cards[0].phase).toBe('loaded');
		expect(s.state.cards[0].progress).toBeNull();
	});
	it('queues a cancel until the start request is accepted and waits for stop acknowledgement', async () => {
		const s = await setup();
		const start = deferred<void>(),
			stop = deferred<void>();
		s.backend.load.mockReturnValue(start.promise);
		s.backend.unload.mockReturnValue(stop.promise);
		const loading = s.tracker.load('a');
		await s.tracker.cancel('a');
		expect(s.backend.unload).not.toHaveBeenCalled();
		expect(s.state.cards[0].phase).toBe('cancelling');
		s.emit(event('a', 'unloaded'));
		expect(s.state.cards[0].phase).toBe('cancelling');
		start.resolve();
		await Promise.resolve();
		expect(s.backend.unload).toHaveBeenCalledOnce();
		stop.resolve();
		await loading;
		expect(s.state.cards[0].phase).toBe('cancelled');
	});
	it('does not claim cancellation while the engine still reports loading', async () => {
		const s = await setup();
		await s.tracker.load('a');
		s.setRows([model('a', 'loading')]);
		s.emit(event('a', 'loading', progress));
		await s.tracker.cancel('a');
		expect(s.state.cards[0].phase).toBe('cancelling');
		s.emit(event('a', 'unloaded'));
		expect(s.state.cards[0].phase).toBe('cancelled');
	});
	it('keeps cancel available after a rejected stop instead of showing cancelled', async () => {
		const s = await setup();
		await s.tracker.load('a');
		s.emit(event('a', 'loading', progress));
		s.backend.unload.mockRejectedValueOnce(new Error('stop refused'));
		await s.tracker.cancel('a');
		expect(s.state.cards[0].phase).toBe('loading');
		expect(s.state.cards[0].error).toContain('stop refused');
	});
	it('tracks concurrent cards independently', async () => {
		const s = await setup([model('a'), model('b')]);
		await Promise.all([s.tracker.load('a'), s.tracker.load('b')]);
		s.emit(event('a', 'failed'));
		s.emit(event('b', 'loaded'));
		expect(s.state.cards.map((card) => card.phase)).toEqual(['failed', 'loaded']);
	});
	it('fences stale snapshots behind newer progress events', async () => {
		const s = await setup();
		await s.tracker.load('a');
		const snapshot = deferred<ApiModelDataEntry[]>();
		s.backend.list.mockReturnValueOnce(snapshot.promise);
		const refresh = s.tracker.refresh();
		s.emit(event('a', 'loading', progress));
		snapshot.resolve([model('a', 'unloaded')]);
		await refresh;
		expect(s.state.cards[0].phase).toBe('loading');
		expect(s.state.cards[0].progress?.fraction).toBe(0.8741);
	});
	it('clears stale percentages on disconnect and keeps polling status', async () => {
		const s = await setup();
		await s.tracker.load('a');
		s.emit(event('a', 'loading', progress));
		s.connection(false);
		expect(s.state.cards[0].progress).toBeNull();
		s.setRows([model('a', 'loaded')]);
		await vi.advanceTimersByTimeAsync(2500);
		expect(s.state.cards[0].phase).toBe('loaded');
	});
	it('aborts observation on page exit without unloading the model', async () => {
		const s = await setup([model('a', 'loaded')]);
		s.tracker.stop();
		expect(s.signal.aborted).toBe(true);
		expect(s.backend.unload).not.toHaveBeenCalled();
		const count = s.changed.mock.calls.length;
		s.emit(event('a', 'failed'));
		expect(s.changed.mock.calls.length).toBe(count);
	});
	it('does not recreate dismissed failures on the next snapshot', async () => {
		const s = await setup([model('a', 'failed')]);
		s.tracker.dismiss('a');
		await s.tracker.refresh();
		expect(s.state.cards).toEqual([]);
	});
	it('ignores an old load reply after retry and still queues cancellation on the new request', async () => {
		const s = await setup();
		const old = deferred<void>(),
			latest = deferred<void>();
		s.backend.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
		const first = s.tracker.load('a');
		s.emit(event('a', 'failed'));
		const second = s.tracker.load('a');
		old.resolve();
		await first;
		await s.tracker.cancel('a');
		expect(s.backend.unload).not.toHaveBeenCalled();
		latest.resolve();
		await second;
		expect(s.backend.unload).toHaveBeenCalledOnce();
	});
	it('preserves engine-confirmed ready state if the HTTP reply fails', async () => {
		const s = await setup();
		const pending = deferred<void>();
		s.backend.load.mockReturnValueOnce(pending.promise);
		const first = s.tracker.load('a');
		s.emit(event('a', 'loaded'));
		s.setRows([model('a', 'loaded')]);
		pending.reject(new Error('connection lost'));
		await first;
		expect(s.state.cards[0].phase).toBe('loaded');
		expect(s.state.cards[0].error).toContain('reply failed');
	});
});
