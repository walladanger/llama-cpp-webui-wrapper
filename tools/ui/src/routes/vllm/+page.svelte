<script lang="ts">
	import EnginePage from '$lib/components/app/engine/EnginePage.svelte';
	const fields = [
		{ key: 'distro', label: 'WSL distro' }, { key: 'executable', label: 'Executable in WSL' },
		{ key: 'model', label: 'Model' }, { key: 'port', label: 'Port', kind: 'number' as const, min: 1, max: 65535 },
		{ key: 'cuda_visible_devices', label: 'GPU IDs (optional)', placeholder: '0,1' },
		{ key: 'max_model_len', label: 'Max context length', kind: 'number' as const, min: 1 },
		{ key: 'gpu_memory_utilization', label: 'GPU memory fraction', kind: 'number' as const, min: 0.01, max: 1, step: 0.01 },
		{ key: 'cuda_home', label: 'CUDA_HOME in WSL', placeholder: '/usr/local/cuda' },
		{ key: 'flashinfer_sampler', label: 'Use FlashInfer sampler', kind: 'checkbox' as const }
	];
</script>

<EnginePage engine="vllm" title="vLLM" description="Manage the WSL2 vLLM service for external API clients." {fields} />
