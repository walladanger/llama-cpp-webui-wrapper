<script lang="ts">
	import { onMount } from 'svelte';
	import { engineManager } from '$lib/services/engine-manager.service';

	type AppPaths = { model_folders: string[]; cache_folder: string | null; logs_folder: string | null };
	type LogFile = { name: string; bytes: number };
	const invoke = engineManager();
	let paths = $state<AppPaths>({ model_folders: [], cache_folder: null, logs_folder: null });
	let files = $state<LogFile[]>([]);
	let selected = $state('');
	let contents = $state('');
	let message = $state('');
	let busy = $state(false);

	async function refresh() {
		if (!invoke) return;
		try { files = await invoke<LogFile[]>('list_log_files'); }
		catch (error) { message = String(error); }
	}

	async function chooseFolder() {
		if (!invoke) return;
		try { const selected = await invoke<string | null>('pick_folder'); if (selected) paths.logs_folder = selected; }
		catch (error) { message = String(error); }
	}

	async function save() {
		if (!invoke) return;
		busy = true;
		try {
			await invoke('save_app_paths', { paths: $state.snapshot(paths) });
			message = 'Log folder saved. Restart the app to redirect the llama.cpp server log.';
			selected = ''; contents = '';
			await refresh();
		} catch (error) { message = String(error); }
		finally { busy = false; }
	}

	async function show(name: string) {
		if (!invoke) return;
		selected = name;
		try { contents = await invoke<string>('read_log_file', { name }); }
		catch (error) { contents = String(error); }
	}

	async function showEngine(engine: 'vllm' | 'trtllm') {
		if (!invoke) return;
		selected = engine === 'vllm' ? 'vLLM service' : 'TensorRT-LLM service';
		try { contents = await invoke<string>('manager_call', { engine, action: 'logs' }); }
		catch (error) { contents = String(error); }
	}

	onMount(() => {
		if (!invoke) return;
		invoke<AppPaths>('get_app_paths').then((value) => paths = value).catch((error) => message = String(error));
		void refresh();
	});
</script>

<svelte:head><title>Logs · llama.cpp</title></svelte:head>

<main class="mx-auto max-w-5xl px-5 py-8 md:py-12 text-foreground">
	<h1 class="text-2xl font-semibold">Logs</h1>
	<p class="mt-1 text-sm text-muted-foreground">Browse local app logs and choose where the llama.cpp server writes future logs.</p>
	{#if !invoke}<p class="mt-5 rounded-xl bg-muted p-4 text-sm">Log files are available in the Windows app.</p>{/if}
	{#if message}<p class="mt-5 rounded-xl bg-muted p-3 text-sm" aria-live="polite">{message}</p>{/if}
	<section class="mt-7 rounded-2xl border border-border bg-card p-5">
		<h2 class="font-semibold">Log folder</h2>
		<p class="mt-2 break-all text-sm text-muted-foreground">{paths.logs_folder || 'portable-data/logs (default)'}</p>
		<div class="mt-4 flex flex-wrap gap-2">
			<button class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!invoke || busy} onclick={chooseFolder}>Choose folder…</button>
			{#if paths.logs_folder}<button class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!invoke || busy} onclick={() => paths.logs_folder = null}>Use default</button>{/if}
			<button class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!invoke || busy} onclick={save}>Save folder</button>
			<button class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={!invoke || busy} onclick={() => invoke?.('open_logs_folder')}>Open in File Explorer</button>
		</div>
	</section>
	<section class="mt-5 grid gap-5 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
		<div class="rounded-2xl border border-border bg-card p-5">
			<div class="flex items-center justify-between"><h2 class="font-semibold">Files</h2><button class="text-sm underline" disabled={!invoke} onclick={refresh}>Refresh</button></div>
			{#if files.length === 0}<p class="mt-4 text-sm text-muted-foreground">No files found.</p>{/if}
			<ul class="mt-4 space-y-1">{#each files as file (file.name)}<li><button class="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted {selected === file.name ? 'bg-muted' : ''}" onclick={() => show(file.name)}><span class="block break-all">{file.name}</span><span class="text-xs text-muted-foreground">{Math.round(file.bytes / 1024)} KB</span></button></li>{/each}</ul>
			{#if invoke}<div class="mt-5 border-t border-border pt-4"><h3 class="mb-2 text-sm font-semibold">WSL2 services</h3><button class="block rounded-lg px-3 py-2 text-sm hover:bg-muted" onclick={() => showEngine('vllm')}>vLLM logs</button><button class="block rounded-lg px-3 py-2 text-sm hover:bg-muted" onclick={() => showEngine('trtllm')}>TensorRT-LLM logs</button></div>{/if}
		</div>
		<div class="min-w-0 rounded-2xl border border-border bg-card p-5"><h2 class="font-semibold">{selected || 'Select a log file'}</h2><pre class="mt-4 max-h-[65vh] overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-all">{contents}</pre></div>
	</section>
</main>
