<script lang="ts">
	import EnginePage from '$lib/components/app/engine/EnginePage.svelte';
	const fields = [
		{ key: 'distro', label: 'WSL distro' },
		{ key: 'executable', label: 'Executable in WSL' },
		{ key: 'model', label: 'Model' },
		{ key: 'port', kind: 'number' as const, label: 'Port', max: 65535, min: 1 },
		{ key: 'cuda_visible_devices', label: 'GPU IDs (optional)', placeholder: '0,1' },
		{ key: 'max_model_len', kind: 'number' as const, label: 'Max context length', min: 1 },
		{
			key: 'gpu_memory_utilization',
			kind: 'number' as const,
			label: 'GPU memory fraction',
			max: 1,
			min: 0.01,
			step: 0.01
		},
		{ key: 'cuda_home', label: 'CUDA_HOME in WSL', placeholder: '/usr/local/cuda' },
		{ key: 'flashinfer_sampler', kind: 'checkbox' as const, label: 'Use FlashInfer sampler' }
	];
</script>

<EnginePage
	description="Manage the WSL2 vLLM service for external API clients."
	engine="vllm"
	{fields}
	title="vLLM"
/>
