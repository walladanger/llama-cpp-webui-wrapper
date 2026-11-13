import type { ApiModelDataEntry, ApiModelsSseEvent } from '$lib/types/api';

export type LoadPhase =
	| 'starting'
	| 'loading'
	| 'loaded'
	| 'sleeping'
	| 'cancelling'
	| 'unloading'
	| 'cancelled'
	| 'unloaded'
	| 'failed';
export type LoadProgress = {
	stage: string;
	fraction: number;
	stageIndex: number;
	stageCount: number;
};
export type ModelLoadCard = {
	id: string;
	phase: LoadPhase;
	startedAt: number;
	updatedAt: number;
	progress: LoadProgress | null;
	error: string | null;
	engineStatus?: string;
	intent?: 'cancel' | 'unload';
	stopAcknowledged?: boolean;
	operation: number;
	eventRevision: number;
};
export type LoadTrackerState = { cards: ModelLoadCard[]; live: boolean; error: string | null };
type Backend = {
	list: (reload?: boolean) => Promise<ApiModelDataEntry[]>;
	load: (id: string) => Promise<unknown>;
	unload: (id: string) => Promise<unknown>;
	watch: (
		signal: AbortSignal,
		event: (event: ApiModelsSseEvent) => void,
		connection: (live: boolean) => void
	) => Promise<void>;
	now?: () => number;
};
const phases: Record<string, LoadPhase> = {
	loaded: 'loaded',
	loading: 'loading',
	sleeping: 'sleeping',
	unloaded: 'unloaded',
	failed: 'failed'
};
const stageLabels: Record<string, string> = {
	text_model: 'Loading weights',
	spec_model: 'Loading draft model',
	mmproj_model: 'Loading vision projector'
};
export const isLoading = (phase: LoadPhase) =>
	['starting', 'loading', 'cancelling', 'unloading'].includes(phase);

/** A stage percentage is reported as a stage percentage, never an invented overall estimate. */
export function loadProgress(value: unknown): LoadProgress | null {
	if (!value || typeof value !== 'object') return null;
	const data = value as Record<string, unknown>;
	if (
		typeof data.value !== 'number' ||
		!Number.isFinite(data.value) ||
		data.value < 0 ||
		data.value > 1
	)
		return null;
	if (typeof data.current !== 'string' || !stageLabels[data.current] || !Array.isArray(data.stages))
		return null;
	if (data.stages.some((stage) => typeof stage !== 'string' || !stageLabels[stage])) return null;
	const stages = data.stages as string[];
	const index = stages.indexOf(data.current);
	if (index < 0 || stages.length !== new Set(stages).size) return null;
	return {
		stage: stageLabels[data.current],
		fraction: data.value,
		stageIndex: index + 1,
		stageCount: stages.length
	};
}

/** Page-scoped observer. Leaving the page stops observation, not the user's engine. */
export class ModelLoadTracker {
	private rows = new Map<string, ModelLoadCard>();
	private dismissed = new Set<string>();
	private pendingLoads = new Map<string, number>();
	private pendingStops = new Set<string>();
	private controller: AbortController | null = null;
	private interval: ReturnType<typeof setInterval> | null = null;
	private refreshTask: Promise<void> | null = null;
	private revision = 0;
	private operationSequence = 0;
	private active = false;
	private live = false;
	private error: string | null = null;
	constructor(
		private backend: Backend,
		private changed: (state: LoadTrackerState) => void,
		private models: (models: ApiModelDataEntry[]) => void
	) {}
	private now() {
		return this.backend.now?.() ?? Date.now();
	}
	private publish() {
		if (this.active)
			this.changed({
				cards: [...this.rows.values()].map((row) => ({ ...row })),
				live: this.live,
				error: this.error
			});
	}
	private put(id: string, patch: Partial<ModelLoadCard>) {
		const row = this.rows.get(id);
		if (row) this.rows.set(id, { ...row, ...patch, updatedAt: this.now() });
		this.publish();
	}
	start() {
		if (this.active) return;
		this.active = true;
		this.controller = new AbortController();
		const signal = this.controller.signal;
		void this.backend
			.watch(
				signal,
				(event) => {
					if (!signal.aborted) this.event(event);
				},
				(live) => {
					if (signal.aborted) return;
					this.live = live;
					// A disconnected stream's percentage must not look current.
					if (!live) for (const row of this.rows.values()) row.progress = null;
					this.publish();
					if (live) void this.refresh();
				}
			)
			.catch(() => {
				if (!signal.aborted) {
					this.live = false;
					this.publish();
				}
			});
		void this.refresh();
		this.interval = setInterval(() => void this.refresh(), 2500);
	}
	stop() {
		this.active = false;
		this.controller?.abort();
		if (this.interval) clearInterval(this.interval);
		this.interval = null;
	}
	async refresh(reload = false): Promise<void> {
		if (this.refreshTask) {
			await this.refreshTask;
			if (reload) return this.refresh(true);
			return;
		}
		const revision = this.revision;
		this.refreshTask = (async () => {
			try {
				const models = await this.backend.list(reload);
				if (!this.active) return;
				this.models(models);
				this.error = null;
				for (const model of models) {
					if ((this.rows.get(model.id)?.eventRevision ?? 0) > revision) continue;
					this.status(model.id, model.status.value);
				}
				const ids = new Set(models.map((model) => model.id));
				for (const row of this.rows.values())
					if (!ids.has(row.id) && isLoading(row.phase) && row.eventRevision <= revision) {
						this.put(row.id, {
							phase: 'failed',
							progress: null,
							error: 'Model is no longer in the catalog.'
						});
					}
				this.publish();
			} catch (error) {
				if (this.active) {
					this.error = `Status updates unavailable: ${String(error)}`;
					this.publish();
				}
			}
		})();
		try {
			await this.refreshTask;
		} finally {
			this.refreshTask = null;
		}
	}
	private status(id: string, status: string, progress?: unknown, exitCode?: number, event = false) {
		if (!phases[status]) return;
		let row = this.rows.get(id);
		if (!row) {
			if (status === 'unloaded' || (this.dismissed.has(id) && status === 'failed')) return;
			row = {
				id,
				phase: phases[status],
				startedAt: this.now(),
				updatedAt: this.now(),
				progress: null,
				error: null,
				operation: 0,
				eventRevision: 0
			};
			this.rows.set(id, row);
		}
		const eventRevision = event ? this.revision : row.eventRevision;
		const previousStatus = row.engineStatus;
		const patch: Partial<ModelLoadCard> = { engineStatus: status, eventRevision };
		if (row.intent) {
			if (status === 'unloaded' && row.stopAcknowledged)
				Object.assign(patch, {
					phase: row.intent === 'cancel' ? 'cancelled' : 'unloaded',
					progress: null,
					error: null,
					intent: undefined
				});
			else if (status === 'loading' && progress) patch.progress = loadProgress(progress);
		} else if (
			status === 'unloaded' &&
			(row.phase === 'starting' || row.phase === 'loading') &&
			previousStatus !== 'loading'
		) {
			// Initial unloaded snapshots are not evidence that an asynchronous start failed.
		} else if (status === 'unloaded' && ['cancelled', 'failed', 'unloaded'].includes(row.phase)) {
			// Retain the outcome until dismissed or retried.
		} else {
			patch.phase =
				status === 'unloaded' && previousStatus === 'loading' ? 'failed' : phases[status];
			if (status !== 'loading') patch.progress = null;
			else if (progress !== undefined) patch.progress = loadProgress(progress);
			if (patch.phase === 'failed' || (status === 'unloaded' && exitCode && exitCode !== 0))
				Object.assign(patch, {
					phase: 'failed',
					progress: null,
					error: `Model stopped before it was ready${exitCode ? ` (exit ${exitCode})` : ''}. Open Logs for details.`
				});
			if (status === 'loaded' || status === 'sleeping') {
				if (row.phase !== phases[status]) patch.error = null;
				this.dismissed.delete(id);
			}
			if (status === 'loading' && !isLoading(row.phase)) {
				patch.startedAt = this.now();
				patch.error = null;
				patch.progress = loadProgress(progress);
			}
		}
		this.put(id, patch);
	}
	event(event: ApiModelsSseEvent) {
		if (!this.active || !event || typeof event.model !== 'string') return;
		if (['status_change', 'status_update', 'model_status'].includes(event.event)) {
			this.revision++;
			this.status(
				event.model,
				event.data?.status,
				event.data?.progress,
				event.data?.exit_code,
				true
			);
		} else if (event.event === 'models_reload') void this.refresh();
		else if (event.event === 'model_remove' && this.rows.has(event.model))
			this.put(event.model, {
				phase: 'failed',
				progress: null,
				intent: undefined,
				eventRevision: ++this.revision,
				error: 'Model was removed from the catalog.'
			});
	}
	async load(id: string) {
		const previous = this.rows.get(id);
		if (
			previous &&
			(isLoading(previous.phase) || previous.phase === 'loaded' || previous.phase === 'sleeping')
		)
			return;
		const operation = ++this.operationSequence;
		this.dismissed.delete(id);
		this.rows.set(id, {
			id,
			phase: 'starting',
			startedAt: this.now(),
			updatedAt: this.now(),
			progress: null,
			error: null,
			operation,
			eventRevision: this.revision
		});
		this.pendingLoads.set(id, operation);
		this.publish();
		try {
			await this.backend.load(id);
			if (this.rows.get(id)?.operation !== operation) return;
			if (this.pendingLoads.get(id) === operation) this.pendingLoads.delete(id);
			if (this.rows.get(id)?.intent === 'cancel') await this.sendStop(id, operation);
			else if (this.rows.get(id)?.phase === 'starting') this.put(id, { phase: 'loading' });
		} catch (error) {
			const row = this.rows.get(id);
			if (row?.operation === operation) {
				if (row.engineStatus === 'loaded' || row.engineStatus === 'sleeping')
					this.put(id, {
						error: `The engine reports ${row.engineStatus}, but the load request reply failed: ${String(error)}`
					});
				else
					this.put(id, {
						phase: 'failed',
						intent: undefined,
						progress: null,
						error: `Could not start model: ${String(error)}`
					});
			}
		} finally {
			if (this.pendingLoads.get(id) === operation) this.pendingLoads.delete(id);
			if (this.active) void this.refresh();
		}
	}
	async cancel(id: string) {
		const row = this.rows.get(id);
		if (!row || !['starting', 'loading'].includes(row.phase)) return;
		this.put(id, { phase: 'cancelling', intent: 'cancel', stopAcknowledged: false, error: null });
		// Cancel queued during POST /load must run after the start request is accepted.
		if (!this.pendingLoads.has(id)) await this.sendStop(id, row.operation);
	}
	async unload(id: string) {
		const row = this.rows.get(id);
		if (!row || !['loaded', 'sleeping'].includes(row.phase)) return;
		this.put(id, { phase: 'unloading', intent: 'unload', stopAcknowledged: false, error: null });
		await this.sendStop(id, row.operation);
	}
	private async sendStop(id: string, operation: number) {
		if (this.pendingStops.has(id)) return;
		this.pendingStops.add(id);
		try {
			await this.backend.unload(id);
			if (this.rows.get(id)?.operation !== operation) return;
			this.put(id, { stopAcknowledged: true });
			if (this.active) await this.refresh();
		} catch (error) {
			const row = this.rows.get(id);
			if (row?.operation === operation)
				this.put(id, {
					phase:
						row.intent === 'cancel' && row.engineStatus === 'unloaded'
							? 'loading'
							: (phases[row.engineStatus ?? ''] ?? 'loading'),
					intent: undefined,
					error: `Could not ${row.intent === 'cancel' ? 'cancel loading' : 'unload'}: ${String(error)}`
				});
		} finally {
			this.pendingStops.delete(id);
		}
	}
	dismiss(id: string) {
		const row = this.rows.get(id);
		if (row && !isLoading(row.phase) && !['loaded', 'sleeping'].includes(row.phase)) {
			this.rows.delete(id);
			this.dismissed.add(id);
			this.publish();
		}
	}
}
