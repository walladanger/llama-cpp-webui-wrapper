<script lang="ts">
	import { Minus, Square, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { engineManager } from '$lib/services/engine-manager.service';

	const invoke = engineManager();
	let visible = $state(false);
	onMount(() => { visible = Boolean(invoke); });
	function action(name: string) { void invoke?.('window_action', { action: name }); }
	function drag(event: PointerEvent) {
		if (event.button === 0 && !(event.target as HTMLElement).closest('button')) action('drag');
	}
</script>

{#if visible}
	<header class="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-border bg-card text-foreground select-none" role="toolbar" tabindex="0" aria-label="Window controls" onpointerdown={drag} ondblclick={() => action('maximize')}>
		<span class="pl-4 text-sm font-semibold pointer-events-none">llama.cpp</span>
		<div class="flex h-full">
			<button class="flex w-11 items-center justify-center hover:bg-muted" aria-label="Minimize window" onclick={() => action('minimize')}><Minus size={16} /></button>
			<button class="flex w-11 items-center justify-center hover:bg-muted" aria-label="Maximize window" onclick={() => action('maximize')}><Square size={14} /></button>
			<button class="flex w-11 items-center justify-center hover:bg-destructive hover:text-white" aria-label="Close window" onclick={() => action('close')}><X size={16} /></button>
		</div>
	</header>
{/if}
