<script lang="ts">
	import { Minus, Square, X } from '@lucide/svelte';
	import { engineManager } from '$lib/services/engine-manager.service';
	import { onMount } from 'svelte';

	const invoke = engineManager();
	let visible = $state(false);
	onMount(() => {
		visible = Boolean(invoke);
	});
	function action(name: string) {
		void invoke?.('window_action', { action: name });
	}
	function drag(event: PointerEvent) {
		if (event.button === 0 && !(event.target as HTMLElement).closest('button')) action('drag');
	}
</script>

{#if visible}
	<header
		aria-label="Window controls"
		class="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-border bg-card text-foreground select-none"
		ondblclick={() => action('maximize')}
		onpointerdown={drag}
		role="toolbar"
		tabindex="0"
	>
		<span class="pl-4 text-sm font-semibold pointer-events-none">llama.cpp</span>

		<div class="flex h-full">
			<button
				aria-label="Minimize window"
				class="flex w-11 items-center justify-center hover:bg-muted"
				onclick={() => action('minimize')}><Minus size={16} /></button
			>

			<button
				aria-label="Maximize window"
				class="flex w-11 items-center justify-center hover:bg-muted"
				onclick={() => action('maximize')}><Square size={14} /></button
			>

			<button
				aria-label="Close window"
				class="flex w-11 items-center justify-center hover:bg-destructive hover:text-white"
				onclick={() => action('close')}><X size={16} /></button
			>
		</div>
	</header>
{/if}
