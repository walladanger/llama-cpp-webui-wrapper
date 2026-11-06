<script lang="ts">
	import { onMount } from 'svelte';
	import LaunchProfile from '$lib/components/app/engine/LaunchProfile.svelte';
	import { engineManager } from '$lib/services/engine-manager.service';
	import { ModelsService } from '$lib/services/models.service';
	import type { ApiModelDataEntry } from '$lib/types/api';

	type AppPaths = { model_folders: string[]; cache_folder: string | null; logs_folder: string | null };
	type ModelDetail = { id: string; file_name: string; path: string; quantization: string | null; bytes: number | null };
	const invoke = engineManager();
	let desktop = $state(false);
	let paths = $state<AppPaths>({ model_folders: [], cache_folder: null, logs_folder: null });
	let models = $state<ApiModelDataEntry[]>([]);
	let details = $state<Record<string, ModelDetail>>({});
	let modelSearch = $state('');
	let folderFilter = $state('');
	let sortBy = $state<'name' | 'size' | 'quant'>('name');
	let hfRepo = $state('');
	let hfSearch = $state('');
	let hfResults = $state<{ id: string; downloads?: number; gated?: boolean | string }[]>([]);
	let searchingHub = $state(false);
	let message = $state('');
	let busy = $state(false);
	let folders = $derived([...new Set(Object.values(details).map((detail) => detail.path.replace(/[\\/][^\\/]+$/, '')))].sort());
	let visibleModels = $derived.by(() => {
		const query = modelSearch.trim().toLowerCase();
		const filtered = models.filter((model) => {
			const detail = details[model.id];
			if (folderFilter && !detail?.path.startsWith(`${folderFilter}\\`) && !detail?.path.startsWith(`${folderFilter}/`)) return false;
			return !query || [model.id, detail?.file_name, detail?.quantization, detail?.path].some((value) => value?.toLowerCase().includes(query));
		});
			return filtered.sort((a, b) => {
			const left = details[a.id];
			const right = details[b.id];
			if (sortBy === 'size') return (right?.bytes ?? -1) - (left?.bytes ?? -1);
			if (sortBy === 'quant') return (left?.quantization ?? '').localeCompare(right?.quantization ?? '');
			return modelTitle(left, a.id).localeCompare(modelTitle(right, b.id));
		});
	});

	function modelTitle(detail: ModelDetail | undefined, id: string) {
		if (!detail) return id;
		const stem = detail.file_name.replace(/\.gguf$/i, '');
		if (['model', 'mtp'].includes(stem.toLowerCase())) {
			return detail.path.split(/[\\/]/).at(-2) || stem;
		}
		return stem;
	}

	function displayPath(path: string) {
		return path.replace(/^\\\\\?\\/, '');
	}

	function fileSize(bytes: number | null | undefined) {
		if (bytes == null) return 'Size unknown';
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
	}

	async function refreshDetails() {
		if (!invoke) return;
		try {
			const values = await invoke<ModelDetail[]>('list_model_details');
			details = Object.fromEntries(values.map((value) => [value.id, value]));
		} catch (error) { message = `Model details: ${String(error)}`; }
	}

	async function refreshAll(rescan = true) {
		if (rescan && invoke) {
			try { await invoke('rescan_model_folders'); }
			catch (error) { message = `Could not rescan model folders: ${String(error)}`; }
		}
		await refresh(true);
		await refreshDetails();
	}

	async function refresh(reload = false) {
		try { models = (reload ? await ModelsService.reloadRouter() : await ModelsService.listRouter()).data; }
		catch (error) { message = String(error); }
	}

	async function addFolders() {
		if (!invoke) return;
		try {
			const selected = await invoke<string[]>('pick_folders');
			paths.model_folders = [...new Set([...paths.model_folders, ...selected])];
		} catch (error) { message = String(error); }
	}

	async function chooseCache() {
		if (!invoke) return;
		try { const selected = await invoke<string | null>('pick_folder'); if (selected) paths.cache_folder = selected; }
		catch (error) { message = String(error); }
	}

	async function saveFolders() {
		if (!invoke) return;
		busy = true;
		try {
			await invoke('save_app_paths', { paths: $state.snapshot(paths) });
			message = 'Model folders saved. The model list was refreshed. Restart the app to change the download cache.';
			await refreshAll(false);
		} catch (error) { message = String(error); }
		finally { busy = false; }
	}

	async function download() {
		const name = hfRepo.trim();
		if (!/^[\w.-]+\/[\w.-]+(?::[\w.-]+)?$/.test(name)) {
			message = 'Enter a Hugging Face GGUF repo such as ggml-org/Qwen3-0.6B-GGUF:Q8_0.';
			return;
		}
		busy = true;
		try {
			await ModelsService.downloadFromHuggingFace(name);
			message = `Download started for ${name}. Refresh the list to see progress.`;
			hfRepo = '';
			await refresh(true);
		} catch (error) { message = String(error); }
		finally { busy = false; }
	}

	async function searchHub() {
		const query = hfSearch.trim();
		if (!query) { hfResults = []; return; }
		searchingHub = true;
		message = '';
		try {
			const url = new URL('https://huggingface.co/api/models');
			url.searchParams.set('search', query);
			url.searchParams.set('filter', 'gguf');
			url.searchParams.set('sort', 'downloads');
			url.searchParams.set('limit', '20');
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Hugging Face search failed (${response.status}).`);
			hfResults = await response.json();
			if (hfResults.length === 0) message = 'No GGUF repositories matched that search.';
		} catch (error) { message = `Hugging Face search: ${String(error)}`; }
		finally { searchingHub = false; }
	}

	async function toggleModel(model: ApiModelDataEntry) {
		const shouldLoad = model.status.value !== 'loaded';
		busy = true;
		try {
			if (!shouldLoad) await ModelsService.unload(model.id);
			else await ModelsService.load(model.id);
			await refresh();
			void waitForModel(model.id, shouldLoad);
		} catch (error) { message = String(error); }
		finally { busy = false; }
	}

	async function waitForModel(id: string, shouldLoad: boolean) {
		for (let attempt = 0; attempt < 60; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			try {
				models = (await ModelsService.listRouter()).data;
				const status = models.find((item) => item.id === id)?.status.value;
				if (status === (shouldLoad ? 'loaded' : 'unloaded')) return;
				if (shouldLoad && attempt >= 5 && status === 'unloaded') {
					message = `Could not load ${id}. Check the Logs page for the server error.`;
					return;
				}
			} catch (error) { message = `Could not refresh model status: ${String(error)}`; return; }
		}
		message = `${id} is still ${shouldLoad ? 'loading' : 'unloading'}. Check the Logs page for details.`;
	}

	onMount(() => {
		desktop = Boolean(invoke);
		if (invoke) invoke<AppPaths>('get_app_paths').then((value) => paths = value).catch((error) => message = String(error));
		void refreshAll();
	});
</script>

<svelte:head><title>Models · llama.cpp</title></svelte:head>

<main class="mx-auto max-w-5xl px-5 py-8 md:py-12 text-foreground">
	<h1 class="text-2xl font-semibold">Models</h1>
	<p class="mt-1 text-sm text-muted-foreground">Load local GGUF models and download compatible models from Hugging Face.</p>
	{#if message}<p class="mt-5 rounded-xl bg-muted p-3 text-sm" aria-live="polite">{message}</p>{/if}

	<section class="mt-7 rounded-2xl border border-border bg-card p-5">
		<h2 class="font-semibold">Model folders</h2>
		<p class="mt-1 text-sm text-muted-foreground">The built-in <code>portable-data/models</code> folder and these additional folders are scanned recursively. Files stay where they are.</p>
		{#if !desktop}<p class="mt-3 text-sm text-muted-foreground">Choose folders in the Windows app.</p>{/if}
		<ul class="mt-4 space-y-2">
			{#each paths.model_folders as folder (folder)}
				<li class="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"><span class="min-w-0 break-all">{displayPath(folder)}</span><button class="shrink-0 underline" disabled={!desktop || busy} onclick={() => paths.model_folders = paths.model_folders.filter((item) => item !== folder)} data-help-key="model-remove-folder">Remove</button></li>
			{/each}
		</ul>
		<div class="mt-4 flex flex-wrap gap-2">
			<button class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!desktop || busy} onclick={addFolders}>Add folders…</button>
			<button class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!desktop || busy} onclick={saveFolders}>Save and rescan</button>
		</div>
		<div class="mt-6 border-t border-border pt-5">
			<h3 class="text-sm font-semibold">Hugging Face download cache</h3>
			<p class="mt-1 text-sm text-muted-foreground">{paths.cache_folder || 'portable-data/cache (default)'}</p>
			<button class="mt-3 rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!desktop || busy} onclick={chooseCache}>Browse cache folder…</button>
			{#if paths.cache_folder}<button class="ml-2 rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!desktop || busy} onclick={() => paths.cache_folder = null}>Use default</button>{/if}
		</div>
	</section>

	<section class="mt-5 rounded-2xl border border-border bg-card p-5">
		<h2 class="font-semibold">Download from Hugging Face</h2>
		<p class="mt-1 text-sm text-muted-foreground">Search GGUF repositories, then choose one to download. You can also enter a repository and optional quantization tag directly.</p>
		<div class="mt-4 flex flex-wrap gap-2"><input class="min-w-64 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" bind:value={hfSearch} onkeydown={(event) => { if (event.key === 'Enter') void searchHub(); }} placeholder="Search Hugging Face GGUF models" aria-label="Search Hugging Face" /><button class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={searchingHub || !hfSearch.trim()} onclick={searchHub}>{searchingHub ? 'Searching…' : 'Search Hub'}</button></div>
		{#if hfResults.length > 0}<ul class="mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">{#each hfResults as result (result.id)}<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span class="min-w-0 break-all">{result.id}{#if result.gated}<span class="ml-2 text-muted-foreground">(gated)</span>{/if}</span><button class="shrink-0 underline" onclick={() => hfRepo = result.id}>Select</button></li>{/each}</ul>{/if}
		<div class="mt-4 flex flex-wrap gap-2"><input class="min-w-64 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" bind:value={hfRepo} data-help-key="hf-repo" aria-label="Hugging Face repository" placeholder="ggml-org/Qwen3-0.6B-GGUF:Q8_0" /><button class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !hfRepo.trim()} onclick={download}>Download and import</button></div>
	</section>

	<section class="mt-5 rounded-2xl border border-border bg-card p-5">
		<div class="flex items-center justify-between gap-2"><h2 class="font-semibold">Available models</h2><button class="rounded-lg border border-input px-3 py-1.5 text-sm" disabled={busy} onclick={() => refreshAll()}>Refresh</button></div>
		<input class="mt-4 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" bind:value={modelSearch} placeholder="Search models in your folders" aria-label="Search available models" />
		<div class="mt-3 flex flex-wrap gap-2">
			<select class="min-w-48 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" bind:value={folderFilter} aria-label="Filter by model folder"><option value="">All folders</option>{#each folders as folder}<option value={folder}>{displayPath(folder)}</option>{/each}</select>
			<select class="rounded-lg border border-input bg-background px-3 py-2 text-sm" bind:value={sortBy} aria-label="Sort models"><option value="name">Sort by name</option><option value="size">Sort by size</option><option value="quant">Sort by quantization</option></select>
		</div>
		{#if models.length === 0}<p class="mt-4 text-sm text-muted-foreground">No models found yet.</p>{/if}
		{#if models.length > 0 && visibleModels.length === 0}<p class="mt-4 text-sm text-muted-foreground">No models match this search.</p>{/if}
		<ul class="mt-4 divide-y divide-border">
			{#each visibleModels as model (model.id)}
				{@const info = details[model.id]}
				<li class="flex flex-wrap items-center justify-between gap-3 py-3"><div class="min-w-0 flex-1"><div class="break-all text-sm font-medium">{modelTitle(info, model.id)}</div>{#if info}<div class="break-all text-xs text-muted-foreground">{displayPath(info.path)}</div>{/if}<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Quant: {info?.quantization ?? ModelsService.parseModelId(model.id).quantization ?? 'unknown'}</span><span>{fileSize(info?.bytes)}</span><span>{model.status.value}</span></div></div><button class="rounded-lg border border-input px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy || model.status.value === 'loading'} onclick={() => toggleModel(model)}>{model.status.value === 'loaded' ? 'Unload' : 'Load'}</button></li>
			{/each}
		</ul>
	</section>
	<LaunchProfile />
</main>
