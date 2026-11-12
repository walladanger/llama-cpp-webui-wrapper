<script lang="ts">
	import { onMount } from 'svelte';
	import { engineManager } from '$lib/services/engine-manager.service';
	import TensorRTSetup from './TensorRTSetup.svelte';

	type Field = {
		key: string;
		label: string;
		kind?: 'number' | 'checkbox';
		min?: number;
		max?: number;
		step?: number;
		placeholder?: string;
	};
	let {
		engine,
		title,
		description,
		fields
	}: { engine: 'vllm' | 'trtllm'; title: string; description: string; fields: Field[] } = $props();
	let config = $state<Record<string, string | number | boolean>>({});
	let status = $state('Checking service...');
	let badge = $state('Checking');
	let busy = $state(false);
	let setupBusy = $state(false);
	let installed = $state(false);
	let available = $state(false);
	const invoke = engineManager();
	let endpoint = $derived(`http://127.0.0.1:${config.port || '?'}/v1`);
	let blocked = $derived(!available || busy || setupBusy);
	let basicFields = $derived(
		engine === 'trtllm' ? fields.filter((f) => f.key === 'model') : fields
	);

	async function refresh() {
		if (!invoke) return;
		try {
			if (engine === 'trtllm') {
				installed = false;
				await invoke('manager_call', { engine, action: 'installed' });
				installed = true;
			}
			status = await invoke<string>('manager_call', { engine, action: 'status' });
			const ready = status.includes('ActiveState=active') && status.includes('HTTP health: ready');
			const served = status.match(/^Running model: (.+)$/m)?.[1];
			badge =
				ready && served && served !== config.model ? 'Model differs' : ready ? 'Ready' : 'Stopped';
		} catch (error) {
			badge =
				engine === 'trtllm' && String(error).includes('not installed')
					? 'Setup needed'
					: 'Unavailable';
			status = String(error);
		}
	}
	async function load() {
		if (!invoke) return;
		try {
			config = await invoke<Record<string, string | number | boolean>>('read_engine_config', {
				engine
			});
			await refresh();
		} catch (error) {
			status = String(error);
			badge = 'Unavailable';
		}
	}
	async function save() {
		if (!invoke) return;
		busy = true;
		try {
			await invoke('save_engine_config', { engine, config: $state.snapshot(config) });
			status = 'Settings saved. Restart a running service to apply them.';
		} catch (error) {
			status = String(error);
		} finally {
			busy = false;
		}
	}
	async function action(name: 'start' | 'stop' | 'status' | 'logs') {
		if (!invoke) return;
		busy = true;
		status =
			name === 'start'
				? 'Loading the model. The first launch may download model weights and take several minutes…'
				: 'Running...';
		try {
			if (name === 'start')
				await invoke('save_engine_config', { engine, config: $state.snapshot(config) });
			status = await invoke<string>('manager_call', { engine, action: name });
			if (name === 'start' || name === 'stop' || name === 'status') await refresh();
		} catch (error) {
			status = String(error);
			badge = 'Error';
		} finally {
			busy = false;
		}
	}
	async function guide() {
		try {
			await invoke?.('open_trt_guide');
		} catch (error) {
			status = String(error);
		}
	}
	onMount(() => {
		available = Boolean(invoke);
		void load();
	});
</script>

<svelte:head><title>{title} · llama.cpp</title></svelte:head>

{#snippet inputField(field: Field)}
	{#if field.kind === 'checkbox'}
		<label
			data-help-key={field.key}
			data-help-title={field.label}
			class="flex items-center gap-2 text-sm sm:col-span-2"
			><input
				type="checkbox"
				disabled={blocked}
				checked={Boolean(config[field.key])}
				onchange={(event) => (config[field.key] = event.currentTarget.checked)}
			/>{field.label}</label
		>
	{:else}
		<label
			data-help-key={field.key}
			data-help-title={field.label}
			class="grid gap-1 text-sm text-muted-foreground"
			>{field.label}
			<input
				class="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground disabled:opacity-50"
				disabled={blocked}
				type={field.kind === 'number' ? 'number' : 'text'}
				min={field.min}
				max={field.max}
				step={field.step}
				placeholder={field.placeholder}
				value={config[field.key] ?? ''}
				oninput={(event) =>
					(config[field.key] =
						field.kind === 'number'
							? Number(event.currentTarget.value)
							: event.currentTarget.value)}
			/>
		</label>
	{/if}
{/snippet}

<main data-engine={engine} class="mx-auto max-w-4xl px-5 py-8 md:py-12 text-foreground">
	<div class="mb-7 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">{title}</h1>
			<p class="mt-1 text-sm text-muted-foreground">{description}</p>
		</div>
		<span class="rounded-full bg-muted px-3 py-1 text-xs" aria-live="polite">{badge}</span>
	</div>
	{#if !available}
		<p class="mb-5 rounded-xl border border-border bg-muted/50 p-4 text-sm">
			Engine controls are available in the Windows llama.cpp app.
		</p>
	{/if}
	{#if engine === 'trtllm' && available && config.distro}
		<TensorRTSetup
			{config}
			{installed}
			oninstalled={load}
			onbusy={(value) => (setupBusy = value)}
		/>
	{/if}
	<section data-help-key={engine} class="rounded-2xl border border-border bg-card p-5 md:p-7">
		{#if engine === 'trtllm'}<h2 class="mb-4 text-lg font-semibold">Run a model</h2>{/if}
		<div class="mb-5 break-all text-sm text-muted-foreground">
			API endpoint: <code>{endpoint}</code>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each basicFields as field (field.key)}{@render inputField(field)}{/each}
		</div>
		{#if engine === 'trtllm'}
			<p class="mt-2 text-xs text-muted-foreground">
				Use a supported Hugging Face model ID. Start saves your settings automatically. The managed
				installer caches model downloads in Linux; it does not use GGUF files.
			</p>
			<details class="mt-5 rounded-xl border border-border p-4">
				<summary class="cursor-pointer text-sm font-medium">Advanced settings</summary>
				<p class="mt-2 mb-4 text-xs text-muted-foreground">
					Automatic setup fills in the executable path. Change the distribution only if you already
					use another Ubuntu installation. Leave GPU IDs blank to expose all NVIDIA GPUs; model
					parallelism is runtime dependent.
				</p>
				<div class="grid gap-4 sm:grid-cols-2">
					{#each fields.filter((f) => f.key !== 'model') as field (field.key)}{@render inputField(
							field
						)}{/each}
				</div>
			</details>
		{/if}
		<div class="mt-6 flex flex-wrap gap-2">
			<button
				class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
				disabled={blocked || (engine === 'trtllm' && !installed)}
				onclick={() => action('start')}>Start</button
			>
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={blocked || (engine === 'trtllm' && !installed)}
				onclick={() => action('stop')}>Stop</button
			>
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={blocked}
				onclick={save}>Save settings</button
			>
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={blocked}
				onclick={() => action('status')}>Refresh status</button
			>
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={blocked}
				onclick={() => action('logs')}>Service logs</button
			>
			{#if engine === 'trtllm'}<button
					class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
					disabled={!available}
					onclick={guide}>NVIDIA documentation</button
				>{/if}
		</div>
		<pre
			class="mt-5 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-all"
			aria-live="polite">{status}</pre>
	</section>
</main>
