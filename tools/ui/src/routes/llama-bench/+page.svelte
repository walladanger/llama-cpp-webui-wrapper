<script lang="ts">
	import { engineManager } from '$lib/services/engine-manager.service';
	import { onMount } from 'svelte';

	const invoke = engineManager();
	let available = $state(false);
	let installed = $state(false);
	let models = $state<string[]>([]);
	let model = $state('');
	let device = $state('');
	let output = $state('Checking llama-bench...');
	let busy = $state(false);

	async function refresh() {
		if (!invoke) return;

		try {
			models = await invoke<string[]>('list_models');
		} catch (error) {
			output = String(error);
		}
		try {
			await invoke('manager_call', { action: 'installed', engine: 'bench' });
			installed = true;

			if (output === 'Checking llama-bench...')
				output = 'Ready. Choose a GGUF model to run a benchmark.';
		} catch (error) {
			installed = false;
			output = String(error);
		}
	}

	async function call(action: 'run' | 'install') {
		if (!invoke) return;

		busy = true;
		output = action === 'run' ? 'Benchmarking...' : 'Installing llama-bench...';
		try {
			output = await invoke<string>('manager_call', {
				action,
				device: device || null,
				engine: 'bench',
				model: model || null
			});

			if (action === 'install') installed = true;
		} catch (error) {
			output = String(error);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		available = Boolean(invoke);
		void refresh();
	});
</script>

<svelte:head><title>llama-bench · llama.cpp</title></svelte:head>

<main class="mx-auto max-w-4xl px-5 py-8 md:py-12 text-foreground">
	<div class="mb-7 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">llama-bench</h1>

			<p class="mt-1 text-sm text-muted-foreground">
				Measure prompt and generation speed of a local GGUF model.
			</p>
		</div>

		<span class="rounded-full bg-muted px-3 py-1 text-xs"
			>{installed ? 'Installed' : 'Missing'}</span
		>
	</div>

	{#if !available}<p class="mb-5 rounded-xl border border-border bg-muted/50 p-4 text-sm">
			Benchmark controls are available in the Windows llama.cpp app.
		</p>{/if}

	<section class="rounded-2xl border border-border bg-card p-5 md:p-7">
		<p class="mb-5 text-sm text-muted-foreground">
			Results are saved to <code>portable-data/logs/llama-bench.md</code>.
		</p>

		<div class="grid gap-4 sm:grid-cols-2">
			<label class="grid gap-1 text-sm text-muted-foreground"
				>GGUF model
				<select
					bind:value={model}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground"
					data-help-key="bench-model"
				>
					<option value="">Choose a model</option>

					{#each models as name (name)}<option value={name}>{name}</option>{/each}
				</select>
			</label>

			<label class="grid gap-1 text-sm text-muted-foreground"
				>Device (optional)
				<input
					bind:value={device}
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground"
					data-help-key="device"
					placeholder="CUDA2"
				/>
			</label>
		</div>

		<div class="mt-6 flex flex-wrap gap-2">
			<button
				class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
				disabled={!available || busy || !installed || !model}
				onclick={() => call('run')}>Run benchmark</button
			>

			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy || installed}
				onclick={() => call('install')}>Download llama-bench</button
			>

			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!available || busy}
				onclick={refresh}>Refresh models</button
			>
		</div>

		<pre
			aria-live="polite"
			class="mt-5 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-all">{output}</pre>
	</section>
</main>
