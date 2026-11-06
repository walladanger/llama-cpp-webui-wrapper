<script lang="ts">
	import { engineManager } from '$lib/services/engine-manager.service';
	import { onMount } from 'svelte';

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
		description,
		engine,
		fields,
		title
	}: { engine: 'vllm' | 'trtllm'; title: string; description: string; fields: Field[] } = $props();
	let config = $state<Record<string, string | number | boolean>>({});
	let status = $state('Checking service...');
	let badge = $state('Checking');
	let busy = $state(false);
	let available = $state(false);
	const invoke = engineManager();
	let endpoint = $derived(`http://127.0.0.1:${config.port || '?'}/v1`);

	async function refresh() {
		if (!invoke) return;

		try {
			if (engine === 'trtllm') await invoke('manager_call', { action: 'installed', engine });

			status = await invoke<string>('manager_call', { action: 'status', engine });
			const ready = status.includes('ActiveState=active') && status.includes('HTTP health: ready');
			const served = status.match(/^Running model: (.+)$/m)?.[1];

			badge =
				ready && served && served !== config.model ? 'Model differs' : ready ? 'Ready' : 'Stopped';
		} catch (error) {
			badge =
				engine === 'trtllm' && String(error).includes('not installed') ? 'Missing' : 'Unavailable';
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
			await invoke('save_engine_config', { config: $state.snapshot(config), engine });
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
		status = name === 'start' ? 'Starting service...' : 'Running...';
		try {
			status = await invoke<string>('manager_call', { action: name, engine });

			if (name === 'start' || name === 'stop') await refresh();
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

<main class="mx-auto max-w-4xl px-5 py-8 md:py-12 text-foreground" data-engine={engine}>
	<div class="mb-7 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">{title}</h1>

			<p class="mt-1 text-sm text-muted-foreground">{description}</p>
		</div>

		<span class="rounded-full bg-muted px-3 py-1 text-xs">{badge}</span>
	</div>

	{#if !available}
		<p class="mb-5 rounded-xl border border-border bg-muted/50 p-4 text-sm">
			Engine controls are available in the Windows llama.cpp app.
		</p>
	{/if}

	<section class="rounded-2xl border border-border bg-card p-5 md:p-7" data-help-key={engine}>
		<div class="mb-5 text-sm text-muted-foreground">API endpoint: <code>{endpoint}</code></div>

		<div class="grid gap-4 sm:grid-cols-2">
			{#each fields as field (field.key)}
				{#if field.kind === 'checkbox'}
					<label
						class="flex items-center gap-2 text-sm sm:col-span-2"
						data-help-key={field.key}
						data-help-title={field.label}
						><input
							checked={Boolean(config[field.key])}
							onchange={(event) => (config[field.key] = event.currentTarget.checked)}
							type="checkbox"
						/>{field.label}</label
					>
				{:else}
					<label
						class="grid gap-1 text-sm text-muted-foreground"
						data-help-key={field.key}
						data-help-title={field.label}
						>{field.label}
						<input
							class="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground"
							max={field.max}
							min={field.min}
							oninput={(event) =>
								(config[field.key] =
									field.kind === 'number'
										? Number(event.currentTarget.value)
										: event.currentTarget.value)}
							placeholder={field.placeholder}
							step={field.step}
							type={field.kind === 'number' ? 'number' : 'text'}
							value={config[field.key] ?? ''}
						/>
					</label>
				{/if}
			{/each}
		</div>

		<div class="mt-6 flex flex-wrap gap-2">
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy}
				onclick={save}>Save settings</button
			>

			<button
				class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
				disabled={!available || busy}
				onclick={() => action('start')}>Start</button
			>

			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy}
				onclick={() => action('stop')}>Stop</button
			>

			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy}
				onclick={() => action('status')}>Status</button
			>

			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy}
				onclick={() => action('logs')}>Logs</button
			>

			{#if engine === 'trtllm'}<button
					class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
					disabled={!available}
					onclick={guide}>Install guide</button
				>{/if}
		</div>

		<pre
			aria-live="polite"
			class="mt-5 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-all">{status}</pre>
	</section>
</main>
