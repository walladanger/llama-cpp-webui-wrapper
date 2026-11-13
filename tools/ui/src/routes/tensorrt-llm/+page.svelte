<script lang="ts">
	import EnginePage from '$lib/components/app/engine/EnginePage.svelte';
	const fields = [
		{ key: 'distro', label: 'WSL distro' },
		{ key: 'executable', label: 'Executable in WSL' },
		{ key: 'model', label: 'Model' },
		{ key: 'port', label: 'Port', kind: 'number' as const, min: 1, max: 65535 },
		{ key: 'cuda_visible_devices', label: 'GPU IDs (optional)', placeholder: '0' }
	];
</script>

<EnginePage
	engine="trtllm"
	title="TensorRT-LLM"
	description="Install, configure, and run NVIDIA’s optional inference service with guided setup."
	{fields}
/>
