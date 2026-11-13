<script lang="ts">
	import { onMount } from 'svelte';
	import { engineManager } from '$lib/services/engine-manager.service';
	import {
		parseOutput,
		primaryGeneration,
		speedTier,
		variation,
		personalComparison,
		placementComparison,
		validRows,
		type BenchRow,
		type BenchReport,
		type HardwareScan
	} from '$lib/services/benchmark-analysis';
	const invoke = engineManager();
	let installed = $state(false),
		scanning = $state(false),
		running = $state(false);
	let models = $state<string[]>([]),
		model = $state(''),
		device = $state(''),
		mode = $state('quick');
	let compare = $state(false),
		scan = $state<HardwareScan | null>(null);
	let history = $state<BenchReport[]>([]),
		report = $state<BenchReport | null>(null);
	let imported = $state<BenchRow[]>([]),
		paste = $state(''),
		message = $state(''),
		stage = $state('');
	let raw = $state(''),
		importError = $state('');
	let ownRun = false;
	const busy = $derived(scanning || running);
	const rows = $derived(
		imported.length ? imported : (report?.results.flatMap((r) => validRows(r.rows)) ?? [])
	);
	const generation = $derived(primaryGeneration(rows));
	const prompt = $derived(
		rows.find(
			(r) =>
				r.n_prompt === 512 &&
				(r.n_depth ?? 0) === 0 &&
				(!generation ||
					(r.model_type === generation.model_type &&
						r.backends === generation.backends &&
						r.devices === generation.devices))
		)
	);
	const tier = $derived(generation ? speedTier(generation.avg_ts) : null);
	const personal = $derived(
		personalComparison(imported.length ? null : report, generation, history)
	);
	const placement = $derived(placementComparison(imported.length ? null : report));
	const longGeneration = $derived(
		rows.find(
			(r) =>
				r.n_gen > 0 &&
				(r.n_depth ?? 0) === 4096 &&
				(!generation ||
					(r.model_type === generation.model_type && r.devices === generation.devices))
		)
	);
	const format = (n: number, digits = 1) =>
		n.toLocaleString(undefined, { maximumFractionDigits: digits });
	const seconds = (tokens: number, rate: number) => `${format(tokens / rate, 2)} s`;
	const basename = (name: string) => name.split(/[\\/]/).pop() ?? name;
	function selectReport(value: BenchReport) {
		report = value;
		imported = [];
		raw = JSON.stringify(value, null, 2);
		message = '';
	}
	async function loadHistory(selectLatest = false) {
		if (!invoke) return;
		history = await invoke<BenchReport[]>('benchmark_inspect', { action: 'history' });
		if (selectLatest && history[0]) selectReport(history[0]);
	}
	async function refresh() {
		if (!invoke || busy) return;
		scanning = true;
		message = '';
		try {
			models = await invoke<string[]>('list_models');
			try {
				await invoke('manager_call', { engine: 'bench', action: 'installed' });
				installed = true;
			} catch {
				installed = false;
			}
			scan = await invoke<HardwareScan>('benchmark_inspect', { action: 'scan' });
			if (!scan.devices.some((d) => d.id === device)) device = scan.devices[0]?.id ?? '';
			await loadHistory(!report && !imported.length);
		} catch (e) {
			message = `Scan unavailable: ${String(e)}. This feature requires the updated desktop app and UI together.`;
		} finally {
			scanning = false;
		}
	}
	async function run() {
		if (!invoke || busy) return;
		ownRun = true;
		running = true;
		stage = 'Starting benchmark';
		message = '';
		imported = [];
		try {
			const value = await invoke<BenchReport>('benchmark_run', {
				model,
				device,
				mode,
				compare: mode === 'deep' && compare
			});
			selectReport(value);
			await loadHistory();
			if (value.status !== 'complete') message = value.error ?? `Benchmark ${value.status}`;
		} catch (e) {
			message = String(e);
		} finally {
			ownRun = false;
			running = false;
			stage = '';
		}
	}
	async function cancel() {
		try {
			await invoke?.('benchmark_control', { action: 'cancel' });
			stage = 'Cancelling; completed tests will be retained';
		} catch (e) {
			message = String(e);
		}
	}
	async function install() {
		if (!invoke || busy) return;
		scanning = true;
		message = 'Downloading llama-bench…';
		try {
			await invoke('manager_call', { engine: 'bench', action: 'install' });
			installed = true;
			message = '';
		} catch (e) {
			message = String(e);
		} finally {
			scanning = false;
		}
		if (installed) await refresh();
	}
	function explain() {
		try {
			const parsed = parseOutput(paste);
			if (!parsed.length)
				throw new Error(
					'No valid pp or tg rows found. Paste the complete Markdown table or llama-bench JSON.'
				);
			imported = parsed;
			report = null;
			raw = paste;
			importError = '';
			message = '';
		} catch (e) {
			importError = String(e);
		}
	}
	function download() {
		const url = URL.createObjectURL(
			new Blob([raw], { type: report ? 'application/json' : 'text/plain' })
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = report ? `benchmark-${report.id}.json` : 'benchmark-explained.txt';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	onMount(() => {
		void refresh();
		let checking = false;
		const timer = setInterval(async () => {
			if (!invoke || checking) return;
			checking = true;
			try {
				const status = await invoke<{ running: boolean; stage: string }>('benchmark_control', {
					action: 'status'
				});
				if (status.running) {
					running = true;
					stage = status.stage;
				} else if (running && !ownRun) {
					running = false;
					stage = '';
					await loadHistory(true);
				}
			} catch {
				/* Scan reports missing native support once. */
			} finally {
				checking = false;
			}
		}, 1500);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Performance & advice · llama.cpp Router</title></svelte:head>
<main class="mx-auto max-w-6xl px-5 py-8 text-foreground md:py-12">
	<header class="mb-7 flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="caption mb-2 tracking-widest uppercase">Know your computer</p>
			<h1 class="text-3xl font-semibold tracking-tight">Performance & advice</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				Understand how a model feels to use, find what to test next, and compare your results.
			</p>
		</div>
		<button class="secondary" disabled={!invoke || busy} onclick={refresh}
			>{scanning ? 'Scanning…' : 'Scan hardware'}</button
		>
	</header>
	{#if !invoke}<p class="notice mb-5">
			You can paste results below. Hardware scans and new benchmarks require the Windows desktop
			app.
		</p>{/if}
	{#if message}<p class="notice mb-5" role="status">{message}</p>{/if}
	{#if generation && tier}
		<section
			class="mb-5 rounded-2xl border border-primary/30 bg-primary/5 p-6"
			aria-label="Your result explained"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-sm text-muted-foreground">Your computer with {generation.model_type}</p>
					<h2 class="mt-2 text-2xl font-semibold">{tier.title}</h2>
					<p class="mt-1 text-sm">{tier.detail}</p>
				</div>
				<span class="rounded-full border border-border bg-background px-3 py-1 text-xs"
					>{imported.length
						? 'Pasted result · limited metadata'
						: `Measured locally · ${report?.status}`}</span
				>
			</div>
			<div class="mt-6 grid gap-5 sm:grid-cols-3">
				<div>
					<p class="caption">Writing speed</p>
					<p class="metric">{format(generation.avg_ts)} <span>tokens/sec</span></p>
					<p class="caption mt-2">
						{generation.n_gen} output tokens ≈ {seconds(generation.n_gen, generation.avg_ts)}
					</p>
				</div>
				<div>
					<p class="caption">Reading speed</p>
					<p class="metric">{prompt ? format(prompt.avg_ts, 0) : '—'} <span>tokens/sec</span></p>
					<p class="caption mt-2">
						{prompt
							? `512 input tokens ≈ ${seconds(512, prompt.avg_ts)}`
							: 'Short-prompt test unavailable'}
					</p>
				</div>
				<div>
					<p class="caption">Example: 500 output tokens</p>
					<p class="metric">≈ {seconds(500, generation.avg_ts)}</p>
					<p class="caption mt-2">Projection at this rate; excludes time before output starts</p>
				</div>
			</div>
			<p class="caption mt-5">
				Tokens are pieces of text. Speed labels use app guidelines (40–99 tokens/sec = fluid; 100+ =
				very fast), not a global hardware ranking. This test does not score answer quality or
				measure time to first token.
			</p>
		</section>
	{/if}
	<div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
		<div class="grid min-w-0 gap-5">
			<section class="panel">
				<h2>Test your setup</h2>
				<p class="caption mt-1">
					Benchmarks run separately from chat. Pause other GPU work first; a resident model can
					compete for memory. Settings are not applied to your server.
				</p>
				<div class="mt-5 grid gap-4 sm:grid-cols-2">
					<label class="field sm:col-span-2"
						>Model<select data-help-key="bench-model" bind:value={model} disabled={busy}
							><option value="">Choose a GGUF model</option>{#each models as name}<option
									value={name}>{basename(name)}</option
								>{/each}</select
						></label
					>
					<label class="field"
						>Baseline device<select bind:value={device} disabled={busy}
							><option value="">Scan to detect devices</option
							>{#each scan?.devices ?? [] as d}<option value={d.id}>{d.id} · {d.description}</option
								>{/each}</select
						></label
					>
					<label class="field"
						>Test depth<select bind:value={mode} disabled={busy}
							><option value="quick">Quick · short input & output</option><option
								value="deep"
								disabled={!scan?.supportsDeep}>Deeper · 4K input & context</option
							></select
						></label
					>
				</div>
				{#if mode === 'deep'}<label class="mt-4 flex items-start gap-2 text-sm"
						><input
							class="mt-1"
							type="checkbox"
							bind:checked={compare}
							disabled={busy ||
								(scan?.devices.filter((d) => d.id.startsWith('CUDA')).length ?? 0) < 2 ||
								!device.startsWith('CUDA')}
						/><span
							>Compare the baseline GPU with all visible CUDA GPUs using layer splitting.<span
								class="caption mt-1 block"
								>Up to five tests, each repeated five times. Model hashing and longer contexts take
								extra time and memory. Each test has a 10-minute limit.</span
							></span
						></label
					>{/if}
				<div class="mt-5 flex flex-wrap gap-2">
					<button
						class="primary"
						disabled={!invoke || busy || !installed || !model || !device}
						onclick={run}>{running ? 'Testing…' : 'Run benchmark'}</button
					>{#if running}<button class="secondary" onclick={cancel}>Cancel benchmark</button
						>{/if}{#if !installed}<button
							class="secondary"
							disabled={!invoke || busy}
							onclick={install}>Download llama-bench</button
						>{/if}
				</div>
				{#if running}<p class="mt-4 text-sm" role="status" aria-live="polite">{stage}</p>{/if}
				<p class="caption mt-4">
					Fixed workloads, five repeats, model and runtime fingerprints. Completed and partial
					reports are retained in the configured logs folder under benchmarks.
				</p>
			</section>
			{#if rows.length}
				<section class="panel">
					<h2>What to try next</h2>
					<ul class="mt-4 grid list-disc gap-3 pl-5 text-sm">
						{#if placement}<li>
								{placement.inconclusive
									? 'The GPU placement difference is small relative to test variation. Repeat the comparison before choosing a winner.'
									: `Layer splitting was ${format(Math.abs(placement.change))}% ${placement.change > 0 ? 'faster' : 'slower'} for short-context generation in this run. ${placement.change > 0 ? 'Retest at your usual context before applying it.' : 'Try one GPU for this model; the other may be useful for a separate worker.'}`}
							</li>{:else}<li>
								Run the deeper GPU comparison to learn whether splitting this model helps. Detecting
								two GPUs does not prove both accelerated the test.
							</li>{/if}
						{#if generation && longGeneration}<li>
								After 4K prefilled tokens, output was {format(longGeneration.avg_ts)} tokens/sec. Choose
								context length around the documents and conversation you actually need.
							</li>{/if}
						{#if rows.some((r) => (variation(r) ?? 0) > 10)}<li>
								At least one test varied by over 10% relative standard deviation. Close competing
								workloads and repeat; this does not identify heat or power as the cause.
							</li>{/if}
						{#if rows.some((r) => r.n_gpu_layers === 0)}<li>
								This result requested zero GPU layers. Test GPU offload if a supported device has
								enough memory.
							</li>{/if}
						<li>
							Compare the same model, quantization, runtime and workload. A larger model can be
							slower without indicating a computer problem.
						</li>
						<li>
							For chat responsiveness, separately measure loading, time to first output and
							simultaneous requests. These are outside this synthetic test.
						</li>
					</ul>
				</section>
				<section class="panel">
					<h2>Measurements</h2>
					<div class="mt-4 overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead><tr><th>Workload</th><th>Tokens/sec</th><th>Variation</th></tr></thead><tbody
								>{#each rows as row}<tr
										><td
											>{row.n_prompt > 0
												? `Read ${row.n_prompt} tokens`
												: `Write ${row.n_gen} tokens`}<span class="caption block"
												>{row.model_type} · {row.n_depth ?? 0} prefilled tokens{row.devices
													? ` · ${row.devices}`
													: ''}</span
											></td
										><td>{format(row.avg_ts, 2)}</td><td
											>{variation(row) === null ? 'Unknown' : `${format(variation(row)!, 2)}%`}</td
										></tr
									>{/each}</tbody
							>
						</table>
					</div>
					<p class="caption mt-3">
						Variation = standard deviation ÷ average speed. It is not a confidence interval or an
						error rate.
					</p>
				</section>
			{/if}
			<section class="panel">
				<details>
					<summary class="cursor-pointer font-semibold">Explain an existing result</summary>
					<p class="caption mt-3">
						Paste a llama-bench Markdown table or JSON. Logs without full settings are explained but
						excluded from rankings.
					</p>
					<label class="field mt-3"
						>Benchmark output<textarea
							rows="7"
							bind:value={paste}
							placeholder="Paste your benchmark table here"
						></textarea></label
					><button class="secondary mt-3" onclick={explain}>Explain result</button
					>{#if importError}<p class="mt-3 text-sm" role="alert">{importError}</p>{/if}
				</details>
			</section>
		</div>
		<aside class="grid min-w-0 gap-5">
			<section class="panel">
				<h2>Your computer is like…</h2>
				{#if scan?.cards.length}<p class="mt-3 text-sm">
						A local AI setup with {scan.cards.length} detected NVIDIA {scan.cards.length === 1
							? 'GPU'
							: 'GPUs'}.
					</p>
					<ul class="mt-3 grid gap-3 text-sm">
						{#each scan.cards as card}<li>
								<span class="font-medium">{card.name}</span><span class="caption block"
									>{card.total === null
										? 'VRAM unavailable'
										: `${format(card.total / 1024)} GiB VRAM`} · {card.free === null
										? 'free VRAM unavailable'
										: `${format(card.free / 1024)} GiB free at scan`}</span
								>
							</li>{/each}
					</ul>
					<p class="caption mt-3">
						Separate GPU memories are not one shared pool. Model placement determines how their
						capacity is used.
					</p>{:else}<p class="caption mt-3">
						GPU inventory unavailable. Runtime devices appear in the baseline selector.
					</p>{/if}
				{#if scan?.system}<div class="mt-4 border-t border-border pt-4 text-sm">
						<p>{scan.system.cpu || 'CPU unknown'}</p>
						<p class="caption mt-1">
							{scan.system.ramBytes
								? `${format(scan.system.ramBytes / 1024 ** 3)} GiB system RAM`
								: 'RAM unavailable'}
						</p>
					</div>{/if}
				<details class="mt-4">
					<summary class="cursor-pointer text-sm">Sensor snapshots</summary>
					<p class="caption mt-2">
						Instantaneous readings, not peak load or proof of a bottleneck. PCIe links can downshift
						at idle.
					</p>
					{#if scan?.telemetry?.length}{#each scan.telemetry as sensor}<div class="mt-3 text-xs">
								<p class="font-medium">{sensor.name}</p>
								<p class="mt-1">
									GPU use: {sensor.utilization ?? 'unavailable'} · Temperature: {sensor.temperature ===
									null
										? 'unavailable'
										: `${sensor.temperature} °C`}
								</p>
								<p>
									Power: {sensor.powerW === null ? 'unavailable' : `${sensor.powerW} W`} · Limit: {sensor.powerLimitW ===
									null
										? 'unavailable'
										: `${sensor.powerLimitW} W`}
								</p>
								<p>PCIe: Gen {sensor.pcieGen ?? '?'} ×{sensor.pcieWidth ?? '?'}</p>
							</div>{/each}{:else}<p class="caption mt-2">
							Utilization, temperature, power and PCIe telemetry unavailable. Missing readings
							cannot diagnose a bottleneck.
						</p>{/if}
				</details>
				{#if scan?.issues.length}<p class="caption mt-3">{scan.issues.join('. ')}</p>{/if}
			</section>
			<section class="panel">
				<h2>How do you compare?</h2>
				<p class="mt-3 text-sm font-medium">
					{personal
						? `#${personal.rank} of ${personal.count} matching local runs`
						: 'Build your personal baseline'}
				</p>
				<p class="caption mt-2">
					{personal
						? `${format(Math.abs(personal.change))}% ${personal.change >= 0 ? 'above' : 'below'} your previous best. Small changes may be ordinary variation.`
						: 'Repeat a full benchmark with matching model and runtime fingerprints to compare changes on your computer.'}
				</p>
				<div class="mt-4 border-t border-border pt-4">
					<p class="text-sm font-medium">Global ranking: unavailable</p>
					<p class="caption mt-2">
						No verified community reference dataset is connected. A fair percentile needs matching
						workloads and a visible sample count. No results are uploaded.
					</p>
				</div>
			</section>
			{#if history.length}<section class="panel">
					<h2>Recent local runs</h2>
					<div class="mt-3 grid gap-2">
						{#each history as entry}<button
								class="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted {report?.id ===
								entry.id
									? 'border-primary'
									: 'border-border'}"
								onclick={() => selectReport(entry)}
								><span class="block truncate">{entry.model}</span><span class="caption"
									>{new Date(entry.createdAt * 1000).toLocaleString()} · {entry.mode} · {entry.status}</span
								></button
							>{/each}
					</div>
				</section>{/if}
		</aside>
	</div>
	{#if raw}<section class="panel mt-5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2>Raw evidence</h2>
				<button class="secondary" onclick={download}>Export report</button>
			</div>
			<details class="mt-3">
				<summary class="cursor-pointer text-sm">Show original measurements and settings</summary>
				<pre
					class="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-all">{raw}</pre>
			</details>
		</section>{/if}
	<p class="caption mt-6">
		Method: <a
			class="underline"
			href="https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/README.md"
			target="_blank"
			rel="noreferrer">llama-bench documentation</a
		>. Tests measure synthetic throughput, not safe power limits or UPS capacity.
	</p>
</main>

<style>
	.panel {
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
		padding: 1.3rem;
	}
	h2 {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.caption {
		font-size: 0.78rem;
		line-height: 1.55;
		color: var(--muted-foreground);
	}
	.metric {
		margin-top: 0.25rem;
		font-size: 1.8rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.metric span {
		font-size: 0.85rem;
		font-weight: 400;
	}
	.field {
		display: grid;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}
	select,
	textarea {
		width: 100%;
		min-width: 0;
		border: 1px solid var(--input);
		border-radius: 0.5rem;
		padding: 0.65rem;
		background: var(--background);
		color: var(--foreground);
	}
	.primary,
	.secondary {
		border-radius: 0.5rem;
		padding: 0.6rem 1rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.primary {
		background: var(--primary);
		color: var(--primary-foreground);
	}
	.secondary {
		border: 1px solid var(--input);
		background: var(--background);
	}
	.secondary:hover {
		background: var(--muted);
	}
	button:disabled,
	select:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.notice {
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		padding: 1rem;
		background: var(--muted);
		font-size: 0.85rem;
	}
	th,
	td {
		padding: 0.75rem 0.5rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
		font-variant-numeric: tabular-nums;
	}
	th {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 500;
	}
</style>
