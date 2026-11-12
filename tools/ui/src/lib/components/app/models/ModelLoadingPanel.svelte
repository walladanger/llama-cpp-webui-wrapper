<script lang="ts">
	import { isLoading, type ModelLoadCard } from '$lib/services/model-load-tracker';
	import { sizeLabel } from '$lib/services/huggingface-browser';
	import { ModelsService } from '$lib/services/models.service';
	import type { ApiModelDataEntry } from '$lib/types/api';

	export type ModelDetail = {
		id: string;
		file_name: string;
		path: string;
		quantization: string | null;
		bytes: number | null;
	};
	let {
		cards,
		models,
		details,
		live,
		connectionError,
		now,
		oncancel,
		onunload,
		onretry,
		ondismiss,
		onloadmodel,
		onrefresh
	}: {
		cards: ModelLoadCard[];
		models: ApiModelDataEntry[];
		details: Record<string, ModelDetail>;
		live: boolean;
		connectionError: string | null;
		now: number;
		oncancel: (id: string) => void;
		onunload: (id: string) => void;
		onretry: (id: string) => void;
		ondismiss: (id: string) => void;
		onloadmodel: () => void;
		onrefresh: () => void;
	} = $props();
	let selectedId = $state('');
	let copyMessage = $state('');
	let selected = $derived(cards.find((card) => card.id === selectedId) ?? cards[0]);
	let selectedModel = $derived(models.find((model) => model.id === selected?.id));
	let selectedDetail = $derived(selected ? details[selected.id] : undefined);
	let readyCount = $derived(
		cards.filter((card) => card.phase === 'loaded' || card.phase === 'sleeping').length
	);
	const labels = {
		starting: 'Starting',
		loading: 'Loading',
		loaded: 'Ready',
		sleeping: 'Sleeping',
		cancelling: 'Cancelling',
		unloading: 'Unloading',
		cancelled: 'Cancelled',
		unloaded: 'Unloaded',
		failed: 'Failed'
	};
	function title(id: string) {
		const file = details[id]?.file_name;
		if (!file) return ModelsService.parseModelId(id).modelName || id;
		const stem = file.replace(/\.gguf$/i, '');
		return ['model', 'mtp'].includes(stem.toLowerCase())
			? details[id].path.split(/[\\/]/).at(-2) || stem
			: stem;
	}
	function quant(id: string) {
		return (
			details[id]?.quantization ?? ModelsService.parseModelId(id).quantization ?? 'Not reported'
		);
	}
	function parameter(model: ApiModelDataEntry | undefined, names: string[]) {
		const args = model?.status.args ?? [];
		for (let index = args.length - 1; index >= 0; index--) {
			for (const name of names) {
				const value =
					args[index] === name
						? args[index + 1]
						: args[index].startsWith(`${name}=`)
							? args[index].slice(name.length + 1)
							: null;
				if (value && /^\d+$/.test(value)) return value;
			}
		}
		return null;
	}
	function elapsed(card: ModelLoadCard) {
		const seconds = Math.max(
			0,
			Math.floor(((isLoading(card.phase) ? now : card.updatedAt) - card.startedAt) / 1000)
		);
		return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}
	function stage(card: ModelLoadCard) {
		if (card.phase === 'cancelling') return 'Waiting for the engine to stop loading…';
		if (card.phase === 'unloading') return 'Releasing the model…';
		if (card.phase === 'starting') return 'Sending the load request…';
		if (card.phase === 'loading')
			return card.progress
				? `${card.progress.stage}${card.progress.stageCount > 1 ? ` · Stage ${card.progress.stageIndex} of ${card.progress.stageCount}` : ''}`
				: 'Waiting for engine progress…';
		if (card.phase === 'loaded') return 'Model loaded and ready for requests';
		if (card.phase === 'sleeping') return 'Engine reports this model is sleeping';
		if (card.phase === 'cancelled') return 'Loading was cancelled';
		if (card.phase === 'unloaded') return 'Model unloaded';
		return 'The model could not be loaded';
	}
	async function copyId() {
		if (!selected) return;
		try {
			await navigator.clipboard.writeText(selected.id);
			copyMessage = 'Model ID copied';
		} catch {
			copyMessage = 'Could not copy. Select the model ID below to copy it manually.';
		}
	}
</script>

<section class="model-workspace mt-6" aria-label="Model loading workspace">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold">
				Loaded models <span class="ml-2 text-sm font-normal text-muted-foreground"
					>{readyCount} ready</span
				>
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				Watch models load and inspect their file details.
			</p>
		</div>
		<button
			class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
			onclick={onloadmodel}>+ Load model</button
		>
	</div>
	{#if connectionError}<div
			class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
			role="status"
		>
			<span>{connectionError} Showing last known states.</span><button
				class="underline"
				onclick={onrefresh}>Retry status</button
			>
		</div>{/if}
	<div class="workspace-grid">
		<div class="min-w-0 space-y-3" aria-label="Model loading cards">
			{#each cards as card (card.id)}
				{@const model = models.find((item) => item.id === card.id)}
				{@const parallel = parameter(model, ['--parallel', '-np'])}
				{@const percent =
					card.phase === 'loading' && card.progress ? card.progress.fraction * 100 : null}
				<article
					class="load-card"
					class:selected={selected?.id === card.id}
					class:failed={card.phase === 'failed'}
					aria-label={`${title(card.id)} model card`}
				>
					<button
						class="card-heading"
						aria-label={`Show information for ${card.id}`}
						aria-pressed={selected?.id === card.id}
						onclick={() => {
							selectedId = card.id;
							copyMessage = '';
						}}
					>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="state-badge"
								class:ready={card.phase === 'loaded'}
								class:failure={card.phase === 'failed'}
								>{#if isLoading(card.phase)}<span class="spinner" aria-hidden="true"
									></span>{/if}{labels[card.phase]}{#if percent !== null}<span class="tabular-nums"
										>{percent.toFixed(2)}%</span
									>{/if}</span
							>{#if isLoading(card.phase)}<span class="text-xs tabular-nums text-muted-foreground"
									>{elapsed(card)}</span
								>{/if}
						</div>
						<div class="mt-3 flex items-center justify-between gap-3">
							<h3 class="min-w-0 break-all text-sm font-semibold text-blue-600 dark:text-blue-400">
								{title(card.id)}
							</h3>
							<span class="shrink-0 text-muted-foreground" aria-hidden="true">›</span>
						</div>
					</button>
					<p class="px-4 text-xs text-muted-foreground">{stage(card)}</p>
					<div class="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-3">
						<div class="flex min-w-0 flex-wrap gap-1.5">
							<span class="info-chip">Quant <strong>{quant(card.id)}</strong></span><span
								class="info-chip">File <strong>{sizeLabel(details[card.id]?.bytes)}</strong></span
							>{#if parallel}<span class="info-chip">Parallel <strong>{parallel}</strong></span
								>{/if}
						</div>
						<div class="flex shrink-0 gap-2">
							{#if card.phase === 'starting' || card.phase === 'loading'}<button
									class="card-action"
									onclick={() => oncancel(card.id)}
									aria-label={`Cancel loading ${card.id}`}>× Cancel</button
								>
							{:else if card.phase === 'loaded' || card.phase === 'sleeping'}<button
									class="card-action"
									onclick={() => onunload(card.id)}
									aria-label={`Unload ${card.id}`}>Unload</button
								>
							{:else if card.phase === 'cancelling' || card.phase === 'unloading'}<button
									class="card-action"
									disabled>{labels[card.phase]}…</button
								>
							{:else}<button
									class="card-action"
									disabled={!model}
									onclick={() => onretry(card.id)}
									aria-label={`Retry loading ${card.id}`}>Load again</button
								><button
									class="card-action"
									onclick={() => ondismiss(card.id)}
									aria-label={`Dismiss ${card.id}`}>Dismiss</button
								>{/if}
						</div>
					</div>
					{#if card.error}<div
							class="mx-4 mb-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300"
							role="alert"
						>
							{card.error} <a class="underline" href="#/logs">Open Logs</a>
						</div>{/if}
					{#if isLoading(card.phase)}<div
							class="load-track"
							role="progressbar"
							aria-label={`Loading progress for ${card.id}`}
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={percent ?? undefined}
							aria-valuetext={percent === null
								? stage(card)
								: `${card.progress?.stage}: ${percent.toFixed(2)} percent`}
						>
							<span
								class:indeterminate={percent === null}
								style:width={percent === null ? '35%' : `${percent}%`}
							></span>
						</div>{:else if card.phase === 'loaded'}<div
							class="ready-track"
							aria-hidden="true"
						></div>{/if}
				</article>
			{:else}
				<div class="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
					<div
						class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-xl"
						aria-hidden="true"
					>
						◇
					</div>
					<p class="text-sm font-medium">No models loaded</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Choose a model from your folders to start loading.
					</p>
					<button
						class="mt-4 rounded-lg border border-input px-4 py-2 text-sm"
						onclick={onloadmodel}>Choose a model</button
					>
				</div>
			{/each}
			<p class="text-xs text-muted-foreground" role="status">
				{live
					? 'Live engine progress'
					: 'Polling model status · live percentages may be unavailable'}. Percentages describe the
				current load stage.
			</p>
		</div>
		<aside class="info-panel" aria-label="Model information">
			<h3 class="border-b border-border px-4 py-3 text-sm font-semibold">Model information</h3>
			{#if selected}
				<div class="p-4">
					<div class="flex items-start justify-between gap-2">
						<p class="min-w-0 break-all font-mono text-xs text-blue-600 dark:text-blue-400">
							{selected.id}
						</p>
						<button class="shrink-0 text-xs underline" onclick={copyId}>Copy ID</button>
					</div>
					{#if copyMessage}<p class="mt-2 text-xs text-muted-foreground" role="status">
							{copyMessage}
						</p>{/if}
				</div>
				<dl class="info-rows">
					<div>
						<dt>Status</dt>
						<dd>{labels[selected.phase]}</dd>
					</div>
					<div>
						<dt>Model</dt>
						<dd>{title(selected.id)}</dd>
					</div>
					<div>
						<dt>File</dt>
						<dd>{selectedDetail?.file_name ?? 'Not reported'}</dd>
					</div>
					<div>
						<dt>Format</dt>
						<dd>
							{selectedDetail?.file_name.toLowerCase().endsWith('.gguf') ? 'GGUF' : 'Not reported'}
						</dd>
					</div>
					<div>
						<dt>Quantization</dt>
						<dd>{quant(selected.id)}</dd>
					</div>
					<div>
						<dt>Architecture</dt>
						<dd>
							{typeof selectedModel?.meta?.['general.architecture'] === 'string'
								? selectedModel.meta['general.architecture']
								: 'Not reported'}
						</dd>
					</div>
					<div>
						<dt>Capabilities</dt>
						<dd>{selectedModel?.architecture?.input_modalities?.join(', ') || 'Not reported'}</dd>
					</div>
					<div>
						<dt>Size on disk</dt>
						<dd>{sizeLabel(selectedDetail?.bytes)}</dd>
					</div>
					<div>
						<dt>Parallel slots</dt>
						<dd>{parameter(selectedModel, ['--parallel', '-np']) ?? 'Not reported'}</dd>
					</div>
					<div>
						<dt>Context</dt>
						<dd>{parameter(selectedModel, ['--ctx-size', '-c']) ?? 'Not reported'}</dd>
					</div>
				</dl>
				{#if selectedDetail?.path}<div class="border-t border-border p-4">
						<p class="text-xs text-muted-foreground">File location</p>
						<p class="mt-1 break-all font-mono text-xs">
							{selectedDetail.path.replace(/^\\\\\?\\/, '')}
						</p>
					</div>{/if}
			{:else}<p class="p-4 text-xs text-muted-foreground">
					Select a model card to inspect its file and runtime details.
				</p>{/if}
		</aside>
	</div>
</section>

<style>
	.workspace-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 16px;
		align-items: start;
	}
	.load-card {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
	}
	.load-card.selected {
		border-color: #3b82f6;
		box-shadow: 0 0 0 1px #3b82f61c;
	}
	.load-card.failed {
		border-color: #ef444480;
	}
	.card-heading {
		display: block;
		width: 100%;
		padding: 14px 16px 8px;
		text-align: left;
		cursor: pointer;
	}
	.card-heading:focus-visible,
	.card-action:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: -3px;
	}
	.state-badge {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border: 1px solid #3b82f640;
		background: #3b82f60c;
		border-radius: 5px;
		padding: 4px 7px;
		font:
			11px ui-monospace,
			monospace;
		text-transform: uppercase;
		color: #3b82f6;
	}
	.state-badge.ready {
		color: #16a34a;
		border-color: #16a34a50;
		background: #16a34a0c;
	}
	.state-badge.failure {
		color: #ef4444;
		border-color: #ef444450;
	}
	.info-chip {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		max-width: 100%;
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 4px 7px;
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.info-chip strong {
		font-weight: 500;
		color: var(--foreground);
	}
	.card-action {
		border: 1px solid var(--border);
		background: var(--muted);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.card-action:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.load-track,
	.ready-track {
		height: 4px;
		width: 100%;
		background: #3b82f612;
		overflow: hidden;
	}
	.load-track span {
		display: block;
		height: 100%;
		background: #3b82f6;
		transition: width 0.2s ease;
	}
	.ready-track {
		background: #3b82f6;
	}
	.indeterminate {
		animation: progress-slide 1.5s ease-in-out infinite;
	}
	.spinner {
		height: 11px;
		width: 11px;
		border: 1.5px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.info-panel {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
	}
	.info-rows > div {
		display: grid;
		grid-template-columns: 92px minmax(0, 1fr);
		gap: 10px;
		padding: 9px 16px;
		font-size: 11px;
	}
	.info-rows > div:nth-child(odd) {
		background: var(--muted);
	}
	.info-rows dt {
		color: var(--muted-foreground);
	}
	.info-rows dd {
		overflow-wrap: anywhere;
	}
	@keyframes progress-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(385%);
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 850px) {
		.workspace-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.indeterminate,
		.spinner {
			animation: none;
		}
		.load-track span {
			transition: none;
		}
	}
</style>
