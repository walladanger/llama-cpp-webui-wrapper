<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		hubJson,
		hubSearchUrl,
		loadHubVariants,
		matchingVariants,
		nextHubPage,
		sizeLabel,
		sizeSummary,
		type HubModel,
		type HubSort
	} from '$lib/services/huggingface-browser';

	let { onselect, selected = '' }: { onselect: (repo: string) => void; selected?: string } =
		$props();
	let mode = $state<'search' | 'browse'>('search');
	let query = $state('');
	let author = $state('');
	let sort = $state<HubSort>('downloads');
	let openOnly = $state(false);
	let quant = $state('');
	let maxGiB = $state('');
	let results = $state<HubModel[]>([]);
	let searching = $state(false);
	let loadingDetails = $state(false);
	let searched = $state(false);
	let error = $state('');
	let nextPage = $state<string | null>(null);
	let controller: AbortController | undefined;
	const cache = new Map<string, NonNullable<HubModel['variants']>>();
	let quants = $derived(
		[
			...new Set(
				results.flatMap((model) =>
					(model.variants ?? []).flatMap((variant) => (variant.quant ? [variant.quant] : []))
				)
			)
		].sort()
	);
	let visible = $derived(
		results.filter(
			(model) => (!quant && !maxGiB) || matchingVariants(model, quant, maxGiB).length > 0
		)
	);
	let detailsFailed = $derived(results.filter((model) => model.detailError).length);

	function updateModel(id: string, changes: Partial<HubModel>) {
		results = results.map((model) => (model.id === id ? { ...model, ...changes } : model));
	}

	async function enrich(models: HubModel[], signal: AbortSignal) {
		let index = 0;
		await Promise.all(
			Array.from({ length: Math.min(4, models.length) }, async () => {
				while (index < models.length && !signal.aborted) {
					const model = models[index++];
					try {
						const variants = cache.get(model.id) ?? (await loadHubVariants(model.id, signal));
						if (signal.aborted) return;
						cache.set(model.id, variants);
						updateModel(model.id, { variants, detailError: undefined });
					} catch (cause) {
						if (!signal.aborted) updateModel(model.id, { detailError: String(cause) });
					}
				}
			})
		);
	}

	async function discover(more = false) {
		controller?.abort();
		const active = new AbortController();
		controller = active;
		searching = true;
		loadingDetails = false;
		error = '';
		if (!more) {
			results = [];
			nextPage = null;
			searched = false;
		}
		try {
			const url = more ? nextPage : hubSearchUrl(query, author, sort, openOnly);
			if (!url) return;
			const response = await hubJson(url, active.signal);
			const data: HubModel[] = await response.json();
			if (active.signal.aborted) return;
			if (!Array.isArray(data)) throw new Error('The Hub returned an invalid model list.');
			const existing = new Set(results.map((model) => model.id));
			const added = data.filter((model) => typeof model.id === 'string' && !existing.has(model.id));
			results = more ? [...results, ...added] : added;
			nextPage = nextHubPage(response.headers.get('Link'));
			searched = true;
			searching = false;
			loadingDetails = true;
			await enrich(added, active.signal);
		} catch (cause) {
			if (!active.signal.aborted) error = String(cause);
		} finally {
			if (!active.signal.aborted) {
				searching = false;
				loadingDetails = false;
			}
		}
	}

	async function retryDetails() {
		if (!controller || controller.signal.aborted) return;
		const active = controller;
		loadingDetails = true;
		await enrich(
			results.filter((model) => model.detailError),
			active.signal
		);
		if (!active.signal.aborted) loadingDetails = false;
	}

	function browse() {
		mode = 'browse';
		if (!searched && !searching) void discover();
	}

	function choose(id: string, quantization?: string | null) {
		onselect(quantization ? `${id}:${quantization}` : id);
	}

	function clearFilters() {
		author = '';
		sort = 'downloads';
		openOnly = false;
		quant = '';
		maxGiB = '';
		void discover();
	}

	function updated(value?: string) {
		if (!value || Number.isNaN(Date.parse(value))) return 'Update unknown';
		return `Updated ${new Date(value).toLocaleDateString()}`;
	}

	onDestroy(() => controller?.abort());
</script>

<div class="mt-4" data-help-key="hf-browser">
	<div
		class="inline-flex gap-1 rounded-lg border border-border bg-muted p-1"
		aria-label="Model discovery mode"
	>
		<button
			type="button"
			class="rounded-md px-4 py-1.5 text-sm aria-pressed:bg-background aria-pressed:font-semibold"
			aria-pressed={mode === 'search'}
			onclick={() => (mode = 'search')}>Search</button
		>
		<button
			type="button"
			class="rounded-md px-4 py-1.5 text-sm aria-pressed:bg-background aria-pressed:font-semibold"
			aria-pressed={mode === 'browse'}
			onclick={browse}>Browse models</button
		>
	</div>
	<form
		class="mt-3 flex flex-wrap gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			void discover();
		}}
	>
		<input
			class="min-w-0 basis-56 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
			bind:value={query}
			placeholder={mode === 'browse'
				? 'All GGUF models, or narrow by name…'
				: 'Search Hugging Face GGUF models'}
			aria-label="Search Hugging Face"
		/>
		<button
			class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
			disabled={searching || (mode === 'search' && !query.trim())}
			>{searching ? 'Searching…' : mode === 'browse' ? 'Browse Hub' : 'Search Hub'}</button
		>
	</form>
	{#if mode === 'browse' || searched}
		<div
			class="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4"
		>
			<label class="space-y-1 text-xs font-medium"
				>Publisher
				<input
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
					aria-label="Publisher"
					bind:value={author}
					placeholder="e.g. unsloth or ggml-org"
					onkeydown={(event) => {
						if (event.key === 'Enter') void discover();
					}}
				/>
			</label>
			<label class="space-y-1 text-xs font-medium"
				>Sort repositories
				<select
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
					aria-label="Sort repositories"
					bind:value={sort}
					onchange={(event) => {
						sort = event.currentTarget.value as HubSort;
						void discover();
					}}
					><option value="downloads">Most downloaded</option><option value="likes"
						>Most liked</option
					><option value="lastModified">Recently updated</option></select
				>
			</label>
			<label class="space-y-1 text-xs font-medium"
				>Quantization
				<select
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
					aria-label="Quantization"
					bind:value={quant}
					><option value="">All quants</option>{#if quant && !quants.includes(quant)}<option
							value={quant}>{quant}</option
						>{/if}{#each quants as value}<option {value}>{value}</option>{/each}</select
				>
			</label>
			<label class="space-y-1 text-xs font-medium"
				>Maximum download size
				<select
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
					aria-label="Maximum download size"
					bind:value={maxGiB}
					><option value="">Any size</option
					>{#each [2, 4, 8, 12, 16, 24, 32, 48, 64] as size}<option value={String(size)}
							>Up to {size} GiB</option
						>{/each}</select
				>
			</label>
			<div class="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
				<label class="flex items-center gap-2 text-sm"
					><input
						type="checkbox"
						bind:checked={openOnly}
						onchange={(event) => {
							openOnly = event.currentTarget.checked;
							void discover();
						}}
					/> Hide gated models</label
				>
				<div class="flex gap-3">
					<button class="text-sm underline" onclick={clearFilters}>Reset filters</button><button
						class="rounded-lg border border-input px-3 py-1.5 text-sm disabled:opacity-50"
						disabled={searching}
						onclick={() => discover()}>Apply filters</button
					>
				</div>
			</div>
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			Quant and size filters apply to loaded results; load more to explore further. Split GGUF sizes
			include all parts. Download size is disk space, not required VRAM.
		</p>
	{/if}
	<div class="mt-3 text-xs text-muted-foreground" role="status">
		{#if searching}Finding GGUF repositories…{:else if searched}{visible.length} of {results.length} loaded
			repositories{#if loadingDetails}
				· Reading quantizations and file sizes…{/if}{:else}Search by model name or browse the Hub
			without a search term.{/if}
	</div>
	{#if error}<p class="mt-3 rounded-lg border border-border p-3 text-sm" role="alert">
			{error} <button class="underline" onclick={() => discover()}>Retry search</button>
		</p>{/if}
	{#if detailsFailed && !loadingDetails}<p class="mt-2 text-xs text-muted-foreground">
			File details unavailable for {detailsFailed} repositories.
			<button class="underline" onclick={retryDetails}>Retry file details</button>
		</p>{/if}
	{#if searched && !searching && !loadingDetails && visible.length === 0}
		<p class="mt-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
			{results.length
				? 'No loaded files match these filters. Try another quant, raise the size limit, or load more repositories.'
				: 'No GGUF repositories found. Try a different name or publisher.'}
		</p>
	{/if}
	<ul class="mt-3 space-y-3" aria-label="Hugging Face model results">
		{#each visible as result (result.id)}
			{@const variants = matchingVariants(result, quant, maxGiB)}
			{@const availableQuants = [...new Set(variants.map((variant) => variant.quant ?? 'Unknown'))]}
			<li class="min-w-0 rounded-xl border border-border p-4">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<h3 class="min-w-0 flex-1 break-all text-sm font-semibold">{result.id}</h3>
					{#if result.gated}<span class="rounded-md bg-muted px-2 py-0.5 text-xs">Gated</span>{/if}
				</div>
				<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span
						>{result.downloads == null
							? 'Downloads unknown'
							: `${result.downloads.toLocaleString()} downloads`}</span
					><span
						>{result.likes == null
							? 'Likes unknown'
							: `${result.likes.toLocaleString()} likes`}</span
					><span>{updated(result.lastModified)}</span>
				</div>
				<div class="mt-3 grid gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2">
					<div>
						<span class="block text-xs text-muted-foreground">Quantization</span><span
							class="break-words font-medium"
							>{result.variants === undefined
								? result.detailError
									? 'Unavailable'
									: 'Loading…'
								: availableQuants.join(' · ') || 'No model GGUF files'}</span
						>
					</div>
					<div>
						<span class="block text-xs text-muted-foreground">File size / variant</span><span
							class="font-medium"
							>{result.variants === undefined && !result.detailError
								? 'Loading…'
								: sizeSummary(variants)}</span
						>
					</div>
				</div>
				{#if variants.length}
					<details class="mt-3">
						<summary class="cursor-pointer text-sm font-medium"
							>View {variants.length} file variants &amp; choose quant</summary
						>
						<ul
							class="mt-2 max-h-72 divide-y divide-border overflow-y-auto"
							aria-label={`File variants for ${result.id}`}
						>
							{#each variants as variant (variant.name)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-3">
									<div class="min-w-0 flex-1">
										<p class="break-all text-xs text-muted-foreground">{variant.name}</p>
										<p class="mt-1 text-sm">
											<span class="font-semibold">{variant.quant ?? 'Quant unknown'}</span> · {sizeLabel(
												variant.bytes
											)}{#if variant.parts > 1}
												· {variant.parts} parts{/if}{#if !variant.complete}
												· Incomplete split{/if}
										</p>
									</div>
									<button
										class="rounded-lg border border-input px-3 py-1.5 text-xs disabled:opacity-50"
										disabled={!variant.quant || !variant.complete}
										onclick={() => choose(result.id, variant.quant)}
										aria-label={`Use ${variant.quant ?? 'unknown quant'} from ${result.id}`}
										>{selected === `${result.id}:${variant.quant}`
											? 'Selected'
											: `Use ${variant.quant ?? 'quant unknown'}`}</button
									>
								</li>
							{/each}
						</ul>
					</details>
				{:else if result.detailError}
					<p class="mt-2 text-xs text-muted-foreground">
						Sizes and quants could not be retrieved. Retry file details or enter a repository below.
					</p>
				{/if}
			</li>
		{/each}
	</ul>
	{#if nextPage}<button
			class="mt-3 w-full rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50"
			disabled={searching || loadingDetails}
			onclick={() => discover(true)}>Load more repositories</button
		>{/if}
	{#if selected}<p class="mt-3 break-all rounded-lg bg-muted p-3 text-sm" role="status">
			Selected: <strong>{selected}</strong>. Use Download and import below to start. The runtime
			chooses the matching GGUF for this quant.
		</p>{/if}
</div>
