<script lang="ts">
	import { engineManager } from '$lib/services/engine-manager.service';
	import { onMount } from 'svelte';
	type Profile = {
		schemaVersion: number;
		id: string;
		name: string;
		revision: number;
		settings: Record<string, unknown>;
	};
	type Card = { uuid: string; name: string; total: number | null; free: number | null };
	const invoke = engineManager();
	let busy = $state(false),
		cards = $state<Card[]>([]),
		inventoryStatus = $state(''),
		profile = $state<Profile | null>(null),
		status = $state('');
	const numbers = [
		{ key: 'ctx_size', label: 'Context tokens (0 = model default)', min: 0 },
		{ key: 'parallel', label: 'Parallel sequences (0 = runtime default)', min: 0 },
		{ key: 'n_gpu_layers', label: 'GPU layers (-1 = automatic)', min: -1 },
		{ key: 'batch_size', label: 'Batch tokens (0 = runtime default)', min: 0 },
		{ key: 'ubatch_size', label: 'Microbatch tokens (0 = runtime default)', min: 0 }
	];
	async function load() {
		if (!invoke) return;

		try {
			profile = await invoke<Profile>('read_engine_config', { engine: 'llamacpp' });
		} catch (e) {
			status = String(e);
		}
	}
	async function inventory() {
		if (!invoke) return;

		try {
			cards = JSON.parse(
				await invoke<string>('manager_call', { action: 'inventory', engine: 'llamacpp' })
			);
			inventoryStatus = cards.length ? '' : 'No physical GPU UUIDs reported.';
		} catch (e) {
			inventoryStatus = String(e);
		}
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();

		if (!invoke || !profile) return;

		busy = true;
		try {
			await invoke('save_engine_config', { config: $state.snapshot(profile), engine: 'llamacpp' });
			await load();
			status = 'Profile saved. Restart the app to apply launch changes to the server.';
		} catch (e) {
			status = String(e);
		} finally {
			busy = false;
		}
	}
	async function capabilities() {
		if (!invoke) return;

		busy = true;
		try {
			status = await invoke<string>('manager_call', { action: 'capabilities', engine: 'llamacpp' });
		} catch (e) {
			status = String(e);
		} finally {
			busy = false;
		}
	}
	async function preview() {
		if (!invoke) return;

		busy = true;
		try {
			status = await invoke<string>('manager_call', { action: 'plan', engine: 'llamacpp' });
		} catch (e) {
			status = String(e);
		} finally {
			busy = false;
		}
	}
	function selected(): string[] {
		return Array.isArray(profile?.settings.selected_gpu_uuids)
			? (profile.settings.selected_gpu_uuids as string[])
			: [];
	}
	function toggle(uuid: string, checked: boolean) {
		if (profile)
			profile.settings.selected_gpu_uuids = checked
				? [...selected(), uuid]
				: selected().filter((id) => id !== uuid);
	}
	onMount(() => {
		void load();
	});
</script>

{#if invoke}
	<section class="mt-5 rounded-2xl border border-border bg-card p-5" data-help-key="settings">
		<details>
			<summary class="cursor-pointer font-semibold">llama.cpp GPU and launch profile</summary>

			<p class="mt-2 text-sm text-muted-foreground">
				These settings configure the whole llama.cpp server. Save a profile, inspect its resolved
				launch, then restart the app to apply it.
			</p>

			{#if profile}
				<form class="mt-4" onsubmit={save}>
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="grid gap-1 text-sm"
							>Profile name<input
								bind:value={profile.name}
								class="rounded-lg border border-input bg-background px-3 py-2"
								required
							/></label
						>

						<label class="grid gap-1 text-sm" data-help-key="gpu_placement"
							>GPU placement<select
								bind:value={profile.settings.gpu_placement}
								class="rounded-lg border border-input bg-background px-3 py-2"
								><option value="manual">Use selected/manual devices</option><option value="single"
									>One card with most free memory</option
								><option value="spread">Spread across visible cards</option></select
							></label
						>

						{#each numbers as field (field.key)}<label
								class="grid gap-1 text-sm"
								data-help-key={field.key}
								data-help-title={field.label}
								>{field.label}<input
									class="rounded-lg border border-input bg-background px-3 py-2"
									max="2147483647"
									min={field.min}
									oninput={(e) => {
										if (profile) profile.settings[field.key] = Number(e.currentTarget.value);
									}}
									required
									step="1"
									type="number"
									value={profile.settings[field.key] as number}
								/></label
							>{/each}

						<label class="grid gap-1 text-sm" data-help-key="split_mode"
							>Split mode<select
								bind:value={profile.settings.split_mode}
								class="rounded-lg border border-input bg-background px-3 py-2"
								><option value="none">Single card</option><option value="layer"
									>Layers across cards</option
								><option value="tensor">Tensor (experimental)</option><option value="row"
									>Row (legacy)</option
								></select
							></label
						>

						<label class="grid gap-1 text-sm" data-help-key="tensor_split"
							>Allocation weights<input
								bind:value={profile.settings.tensor_split}
								class="rounded-lg border border-input bg-background px-3 py-2"
								placeholder="1,1 for equal dual-card allocation"
							/></label
						>

						<label class="grid gap-1 text-sm" data-help-key="flash_attn"
							>Flash Attention<select
								bind:value={profile.settings.flash_attn}
								class="rounded-lg border border-input bg-background px-3 py-2"
								><option value="auto">Automatic</option><option value="on">On</option><option
									value="off">Off</option
								></select
							></label
						>

						{#each ['cache_type_k', 'cache_type_v'] as key (key)}<label
								class="grid gap-1 text-sm"
								data-help-key={key}
								>{key === 'cache_type_k' ? 'K cache' : 'V cache'}<select
									bind:value={profile.settings[key]}
									class="rounded-lg border border-input bg-background px-3 py-2"
									>{#each ['f32', 'f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'] as choice (choice)}<option
											value={choice}>{choice}</option
										>{/each}</select
								></label
							>{/each}

						<label class="flex items-center gap-2 text-sm" data-help-key="fit"
							><input
								checked={profile.settings.fit === true}
								onchange={(e) => {
									if (profile) profile.settings.fit = e.currentTarget.checked;
								}}
								type="checkbox"
							/> Fit memory automatically</label
						>
					</div>

					<div class="mt-5 border-t border-border pt-4" data-help-key="selected_gpu_uuids">
						<h3 class="text-sm font-semibold">Physical GPU selection</h3>

						<p class="mt-1 text-sm text-muted-foreground">
							Cards are saved by UUID in the order you select them. Leaving the selection empty uses
							the runtime device settings below.
						</p>

						<button
							class="mt-3 rounded-lg border border-input px-3 py-2 text-sm"
							disabled={busy}
							onclick={inventory}
							type="button">Detect GPU identities</button
						>

						{#if inventoryStatus}<p class="mt-2 text-sm" role="status">{inventoryStatus}</p>{/if}

						{#each cards as card (card.uuid)}<label class="mt-2 flex items-start gap-2 text-sm"
								><input
									checked={selected().includes(card.uuid)}
									onchange={(e) => toggle(card.uuid, e.currentTarget.checked)}
									type="checkbox"
								/><span
									>{card.name} · {card.free ?? '?'} / {card.total ?? '?'} MiB free<small
										class="block break-all text-muted-foreground">{card.uuid}</small
									></span
								></label
							>{/each}

						{#if selected().length}<p class="mt-2 break-all text-xs">
								Saved order: {selected().join(', ')}
							</p>

							<button
								class="mt-2 underline text-sm"
								onclick={() => {
									if (profile) profile.settings.selected_gpu_uuids = [];
								}}
								type="button">Clear GPU selection</button
							>{/if}
					</div>

					<details class="mt-5">
						<summary class="cursor-pointer text-sm">Advanced launch options</summary>

						<div class="mt-3 grid gap-4 sm:grid-cols-2">
							{#each [{ key: 'device', label: 'Runtime devices (when no UUIDs selected)' }, { key: 'fit_target', label: 'Fit headroom MiB' }, { key: 'fit_ctx', label: 'Minimum fitted context' }, { key: 'llamacpp_env', label: 'Custom child environment (KEY=value;KEY=value)' }, { key: 'extra_args', label: 'Additional runtime arguments' }] as field (field.key)}<label
									class="grid gap-1 text-sm"
									data-help-key={field.key}
									data-help-title={field.label}
									>{field.label}<input
										class="rounded-lg border border-input bg-background px-3 py-2"
										oninput={(e) => {
											if (profile) profile.settings[field.key] = e.currentTarget.value;
										}}
										value={String(profile.settings[field.key] ?? '')}
									/></label
								>{/each}
						</div>
					</details>

					<div class="mt-5 flex flex-wrap gap-2">
						<button
							class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
							disabled={busy}>Save launch profile</button
						><button
							class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50"
							disabled={busy}
							onclick={preview}
							type="button">Preview saved launch</button
						><button
							class="rounded-lg border border-input px-4 py-2 text-sm"
							disabled={busy}
							onclick={load}
							type="button">Reload saved profile</button
						><button
							class="rounded-lg border border-input px-4 py-2 text-sm"
							disabled={busy}
							onclick={capabilities}
							type="button">Inspect runtime package</button
						>
					</div>
				</form>
			{/if}

			{#if status}<pre
					aria-live="polite"
					class="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{status}</pre>{/if}
		</details>
	</section>
{/if}
