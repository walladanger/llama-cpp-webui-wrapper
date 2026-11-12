<script lang="ts">
	import { onMount } from 'svelte';
	import { engineManager } from '$lib/services/engine-manager.service';
	type Config = Record<string, string | number | boolean>;
	type Check = { key: string; state: 'pass' | 'blocked' | 'warning'; detail: string };
	type Checks = {
		ready: boolean;
		checks: Check[];
		distributions?: { name: string; version: number | null }[];
	};
	type Job = { state: string; step: number; message: string; log: string; kind: string };
	let {
		config,
		installed,
		oninstalled,
		onbusy
	}: {
		config: Config;
		installed: boolean;
		oninstalled: () => Promise<void>;
		onbusy: (value: boolean) => void;
	} = $props();
	const invoke = engineManager();
	let checks = $state<Checks | null>(null);
	let job = $state<Job>({ state: 'idle', step: 0, message: '', log: '', kind: 'runtime' });
	let pending = $state(false);
	let error = $state('');
	let details = $state(false);
	let disposed = false;
	let working = $derived(pending || job.state === 'running');
	let missingWsl = $derived(checks?.checks.some((c) => c.key === 'wsl_install') ?? false);
	let existing = $derived(
		checks?.distributions?.filter((d) => !d.name.startsWith('docker-desktop')) ?? []
	);
	let needsUbuntu = $derived(
		missingWsl || checks?.checks.some((c) => c.key === 'linux' && c.state === 'blocked')
	);
	let canOpenUbuntu = $derived(
		existing.some((d) => d.name === config.distro) ||
			checks?.checks.some((c) => c.key === 'wsl_start')
	);
	let lastCheck = $state('');
	let configurationChanged = $derived(lastCheck !== JSON.stringify(config));
	const stages = [
		'Linux prerequisites',
		'NVIDIA container support',
		'Download runtime',
		'Verify CUDA and runtime',
		'Configure launcher',
		'Ready to start'
	];

	$effect(() => {
		onbusy(working);
	});

	async function save() {
		await invoke?.('save_engine_config', { engine: 'trtllm', config: $state.snapshot(config) });
	}
	async function check() {
		if (!invoke || working) return;
		pending = true;
		error = '';
		try {
			await save();
			checks = JSON.parse(
				await invoke<string>('manager_call', { engine: 'trtllm', action: 'setup-check' })
			);
			lastCheck = JSON.stringify(config);
		} catch (e) {
			error = String(e);
			checks = null;
		} finally {
			pending = false;
		}
	}
	async function chooseDistro(name: string) {
		if (!name || working) return;
		config.distro = name;
		await check();
		await oninstalled();
	}
	async function poll() {
		if (!invoke) return;
		const next: Job = JSON.parse(
			await invoke<string>('manager_call', { engine: 'trtllm', action: 'install-status' })
		);
		const finished = job.state !== 'complete' && next.state === 'complete';
		job = next;
		if (finished && next.kind === 'runtime') await oninstalled();
	}
	async function install(action: 'install' | 'install-wsl') {
		if (!invoke || working) return;
		pending = true;
		error = '';
		try {
			if (action === 'install-wsl') config.distro = 'Ubuntu-24.04';
			await save();
			job = JSON.parse(await invoke<string>('manager_call', { engine: 'trtllm', action }));
			if (job.state === 'complete' && job.kind === 'runtime') await oninstalled();
		} catch (e) {
			error = String(e);
		} finally {
			pending = false;
		}
	}
	async function cancel() {
		if (!invoke) return;
		pending = true;
		try {
			job = JSON.parse(
				await invoke<string>('manager_call', { engine: 'trtllm', action: 'install-cancel' })
			);
		} catch (e) {
			error = String(e);
		} finally {
			pending = false;
		}
	}
	async function openUbuntu() {
		try {
			await invoke?.('manager_call', { engine: 'trtllm', action: 'open-ubuntu' });
		} catch (e) {
			error = String(e);
		}
	}
	async function copyLog() {
		try {
			await navigator.clipboard.writeText(
				[job.message, job.log, error].filter(Boolean).join('\n\n')
			);
		} catch {
			error = 'Copy is unavailable. Expand Installation details to select the log text.';
			details = true;
		}
	}
	onMount(() => {
		let timer: ReturnType<typeof setTimeout>;
		async function tick() {
			try {
				await poll();
			} catch (e) {
				error = String(e);
			}
			if (!disposed) timer = setTimeout(tick, 1500);
		}
		void (async () => {
			await poll().catch((e) => {
				error = String(e);
			});
			if (job.state !== 'running' && !installed) await check();
			if (!disposed) timer = setTimeout(tick, 1500);
		})();
		return () => {
			disposed = true;
			clearTimeout(timer);
			onbusy(false);
		};
	});
</script>

<section
	class="mb-5 rounded-2xl border border-border bg-card p-5 md:p-7"
	data-help-key="trt-setup"
	aria-label="Automatic TensorRT-LLM setup"
	aria-busy={working}
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-lg font-semibold">
				{installed ? 'TensorRT-LLM is installed' : 'Set up TensorRT-LLM'}
			</h2>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				{installed
					? 'Choose a model below, then Start. The first launch downloads the model and may take several minutes.'
					: 'We’ll check your PC, install the runtime, and connect it to Router. No terminal commands to copy.'}
			</p>
		</div>
		{#if installed}<span class="rounded-full bg-muted px-3 py-1 text-xs">Installed</span>{/if}
	</div>
	{#if !installed || job.state !== 'idle'}
		<p class="mt-4 text-sm text-muted-foreground">
			Uses Ubuntu in WSL 2 and NVIDIA’s TensorRT-LLM 1.2.0 container. Allow at least 40 GB free plus
			model storage; the download can take a while. Setup reuses Docker Desktop when available.
			Otherwise it installs native Docker and NVIDIA container tools on Ubuntu 22.04/24.04,
			including Docker group access for your Linux account.
		</p>
	{/if}
	{#if existing.length > 0}
		<label class="mt-4 grid max-w-lg gap-1 text-sm text-muted-foreground">
			Existing Linux installation
			<select
				class="rounded-lg border border-input bg-background px-3 py-2 text-foreground disabled:opacity-50"
				disabled={working}
				value={existing.some((d) => d.name === config.distro) ? String(config.distro) : ''}
				onchange={(event) => void chooseDistro(event.currentTarget.value)}
			>
				<option value="" disabled>Choose an existing installation</option>
				{#each existing as distro (distro.name)}
					<option value={distro.name}
						>{distro.name} · {distro.version
							? 'WSL ' + distro.version
							: 'version not reported'}</option
					>
				{/each}
			</select>
			<span class="text-xs"
				>Uses the installation you choose. Your Windows default and other Linux installations are
				unchanged.</span
			>
		</label>
	{/if}
	{#if checks && !working}
		<ul class="mt-4 grid gap-2" aria-label="Prerequisite checks">
			{#each checks.checks as item (item.key)}
				<li class="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
					<span class="mt-0.5 shrink-0 text-xs font-semibold"
						>{item.state === 'pass'
							? 'Ready'
							: item.state === 'warning'
								? 'Note'
								: 'Action needed'}</span
					>
					<span class="min-w-0 break-words text-muted-foreground">{item.detail}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if job.state !== 'idle'}
		<div class="mt-4 rounded-xl bg-muted/50 p-4" role="status" aria-live="polite">
			<p class="text-sm font-medium">{job.message}</p>
			{#if job.kind === 'runtime' && job.state === 'running'}
				<progress
					class="mt-3 h-2 w-full accent-current"
					value={Math.max(0, job.step - 1)}
					max="6"
					aria-label="Installation steps completed"
				></progress>
				<p class="mt-2 text-xs text-muted-foreground">
					Step {Math.max(1, job.step)} of 6 · {stages[Math.max(0, job.step - 1)]}. You can use other
					pages while setup runs. Keep Router open.
				</p>
			{/if}
		</div>
	{/if}
	{#if error}<p role="alert" class="mt-4 rounded-lg border border-destructive/40 p-3 text-sm">
			{error}
		</p>{/if}
	<div class="mt-5 flex flex-wrap gap-2">
		{#if installed}
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={!invoke || working || !checks?.ready || configurationChanged}
				onclick={() => install('install')}>Verify and repair</button
			>
		{/if}
		{#if !installed && !missingWsl}
			<button
				class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				disabled={!invoke || working || !checks?.ready || configurationChanged}
				onclick={() => install('install')}
				>{job.state === 'error' || job.state === 'cancelled'
					? 'Retry installation'
					: 'Install automatically'}</button
			>
		{/if}
		{#if needsUbuntu}
			<button
				class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				disabled={working}
				onclick={() => install('install-wsl')}
				>{missingWsl ? 'Install WSL + Ubuntu' : 'Add Ubuntu 24.04'}</button
			>
		{/if}
		<button
			class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
			disabled={!invoke || working}
			onclick={check}>{pending ? 'Checking…' : 'Check again'}</button
		>
		{#if canOpenUbuntu || (job.kind === 'wsl' && job.state === 'complete')}
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={working}
				onclick={openUbuntu}>Open Ubuntu to finish setup</button
			>
		{/if}
		{#if job.state === 'running' && job.kind === 'runtime'}
			<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
				disabled={pending}
				onclick={cancel}>Cancel installation</button
			>
		{/if}
		{#if job.log}<button
				class="rounded-lg border border-input px-4 py-2 text-sm hover:bg-muted"
				onclick={copyLog}>Copy setup log</button
			>{/if}
	</div>
	{#if configurationChanged && checks && !working}<p class="mt-3 text-xs text-muted-foreground">
			Settings changed. Choose Check again before installing.
		</p>{/if}
	{#if job.log}
		<details class="mt-4" bind:open={details}>
			<summary class="cursor-pointer text-sm text-muted-foreground">Installation details</summary>
			<pre
				class="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">{job.log}</pre>
		</details>
	{/if}
</section>
