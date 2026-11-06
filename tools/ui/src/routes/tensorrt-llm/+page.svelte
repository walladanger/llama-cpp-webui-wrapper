<script lang="ts">
	import EnginePage from '$lib/components/app/engine/EnginePage.svelte';
	const fields = [
		{ key: 'distro', label: 'WSL distro' },
		{ key: 'executable', label: 'Executable in WSL' },
		{ key: 'model', label: 'Model' },
		{ key: 'port', kind: 'number' as const, label: 'Port', max: 65535, min: 1 },
		{ key: 'cuda_visible_devices', label: 'GPU IDs (optional)', placeholder: '0' }
	];
</script>

<EnginePage
	description="Manage the optional WSL2 TensorRT-LLM service. Check GPU and model support before installation."
	engine="trtllm"
	{fields}
	title="TensorRT-LLM"
/>
