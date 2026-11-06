/* Context help: authored guidance, never applied automatically. */
window.RouterHelpCatalog = {
	aliases: {
		'Add folders…': 'model-folders',
		Agentic: 'mcp',
		'Available models': 'models',
		'Browse cache folder…': 'cache-folder',
		'Choose folder…': 'log-folder',
		Close: 'close',
		'Close window': 'close',
		'CUDA_HOME in WSL': 'cuda_home',
		Developer: 'settings',
		'Device (optional)': 'device',
		Display: 'settings',
		Download: 'bench-install',
		'Download and import': 'hf-download',
		'Download from Hugging Face': 'hf-download',
		'Download llama-bench': 'bench-install',
		'Executable in WSL': 'executable',
		Files: 'logs',
		General: 'settings',
		'GGUF model': 'bench-model',
		'GPU IDs (optional)': 'cuda_visible_devices',
		'GPU memory fraction': 'gpu_memory_utilization',
		'Hugging Face download cache': 'cache-folder',
		'Import/Export': 'export',
		'Install guide': 'install-guide',
		'llama-bench': 'bench',
		Load: 'model-load',
		'Log folder': 'log-folder',
		Logs: 'logs',
		'Max context length': 'max_model_len',
		Maximize: 'maximize',
		'Maximize window': 'maximize',
		Minimize: 'minimize',
		'Minimize window': 'minimize',
		Model: 'model',
		'Model folders': 'model-folders',
		Models: 'models',
		'New chat': 'new-chat',
		'Open in File Explorer': 'open-folder',
		'Open install guide': 'install-guide',
		'Open llama.cpp chat': 'chat-open',
		'Open llama.cpp chat test': 'chat-open',
		Port: 'port',
		Refresh: 'refresh',
		'Refresh models': 'refresh',
		'Refresh status': 'refresh',
		'Reset to default': 'reset',
		'Run benchmark': 'bench-run',
		'Sampling & Penalties': 'settings',
		'Save and rescan': 'model-rescan',
		'Save folder': 'log-save',
		'Save settings': 'engine-save',
		'Search available models': 'search',
		'Search Hub': 'search',
		'Search Hugging Face': 'search',
		Select: 'hf-select',
		'Send message': 'chat-send',
		Settings: 'settings',
		Start: 'engine-start',
		Status: 'status',
		Stop: 'engine-stop',
		'Stop generation': 'chat-stop',
		'TensorRT-LLM': 'trtllm',
		Unload: 'model-unload',
		'Use default': 'default-folder',
		'Use FlashInfer sampler': 'flashinfer_sampler',
		vLLM: 'vllm',
		'WSL distro': 'distro'
	},
	topics: {
		agenticMaxTurns: {
			details:
				'More turns permit longer tool workflows but can increase latency and resource use. A low limit makes a new tool setup easier to inspect.',
			steps: [],
			summary: 'Maximum number of model/tool iterations allowed for one agentic interaction.',
			title: 'Agentic turns',
			troubleshooting: '',
			values: [
				['3', 'Short, easy-to-review tool test.'],
				['10', 'A moderate workflow experiment.'],
				['20', 'Longer workflows after checking tool behavior.']
			]
		},
		apiKey: {
			details:
				'Use the exact key configured on your server. This help system never reads or displays your credential.',
			steps: [],
			summary: 'Credential required by a server configured to enforce API authentication.',
			title: 'API key',
			troubleshooting: '',
			values: [
				['Leave blank', 'Appropriate only when the server does not require a key.'],
				['Your configured server key', 'Required when authentication is enabled.']
			]
		},
		attach: {
			details:
				'The selected model must support the attachment type. Large files can consume context or require preprocessing. Attach a small representative file for the first test.',
			steps: [],
			summary: 'Adds supporting files to a conversation.',
			title: 'Attach files',
			troubleshooting: '',
			values: []
		},
		bench: {
			details:
				'Measure prompt processing separately from token generation. Keep the file, quantization, device, and competing workloads consistent. Benchmark throughput is different from client time to first token.',
			steps: [],
			summary: 'Compares local GGUF inference performance.',
			title: 'llama-bench',
			troubleshooting: '',
			values: []
		},
		'bench-install': {
			details:
				'This installs the benchmark tool. It does not download a model or install the WSL engines. The first download requires an internet connection.',
			steps: [
				'Download the tool if it is missing.',
				'Refresh models.',
				'Select a local GGUF and run a short baseline.'
			],
			summary: 'Downloads the benchmark binary matching the app’s pinned llama.cpp release.',
			title: 'Download llama-bench',
			troubleshooting: '',
			values: []
		},
		'bench-model': {
			details:
				'Use the same model file and quantization when comparing devices. Model size, context, and active workloads all affect throughput.',
			steps: [],
			summary: 'The local GGUF file measured by llama-bench.',
			title: 'Benchmark GGUF model',
			troubleshooting: '',
			values: [
				['Small GGUF', 'Fast installation and device smoke test.'],
				['Your regular GGUF', 'A representative performance comparison once the test works.']
			]
		},
		'bench-run': {
			details:
				'The manager uses 512 prompt tokens and 128 generated tokens, with three repetitions. Results measure this local benchmark, not vLLM, TensorRT-LLM, or every client’s end-to-end latency.',
			steps: [
				'Select the same GGUF and device for repeatable comparisons.',
				'Close competing GPU workloads.',
				'Run the benchmark and compare the separate prompt and generation results.',
				'Find the saved Markdown result in the configured logs.'
			],
			summary: 'Measures llama.cpp prompt processing and token generation on a GGUF model.',
			title: 'Run benchmark',
			troubleshooting: '',
			values: []
		},
		'cache-folder': {
			details:
				'Selecting a folder stages the new location. Save and rescan saves it; restart the app to use it. This choice does not move existing downloaded files.',
			steps: [
				'Choose a folder with sufficient free disk space.',
				'Save and rescan.',
				'Restart the app before the next download.'
			],
			summary: 'Chooses the folder used for future model downloads.',
			title: 'Download cache folder',
			troubleshooting: '',
			values: []
		},
		'chat-input': {
			details:
				'Include the goal, relevant context, expected format, and constraints. Attached files must fit the model’s supported modalities and available context.',
			steps: [],
			summary: 'Write the prompt sent to the selected model.',
			title: 'Message input',
			troubleshooting: '',
			values: [
				['Short test prompt', 'Verify the model responds before sending a long task.'],
				[
					'Specific task with context',
					'Provide the code, document excerpt, or facts needed for the answer.'
				]
			]
		},
		'chat-open': {
			details:
				'The chat exercises the bundled llama.cpp server. It does not redirect chat to a separately running vLLM or TensorRT-LLM service.',
			steps: [],
			summary: 'Opens the llama.cpp test chat window.',
			title: 'Open llama.cpp chat',
			troubleshooting: '',
			values: []
		},
		'chat-regenerate': {
			details:
				'Sampling can produce a different answer on the next run. Regeneration uses inference resources again. Check the active model and settings when comparing results.',
			steps: [],
			summary: 'Requests another answer using the conversation context.',
			title: 'Regenerate answer',
			troubleshooting: '',
			values: []
		},
		'chat-send': {
			details:
				'The request uses the current sampling and tool settings. Large histories and attachments can increase prompt processing time. Watch generation statistics to distinguish startup time from token generation.',
			steps: [],
			summary: 'Submits the prompt and current conversation to the selected model.',
			title: 'Send message',
			troubleshooting: '',
			values: []
		},
		'chat-stop': {
			details:
				'Already generated text remains visible. Cancellation affects the current request; an independent engine can remain running.',
			steps: [],
			summary: 'Requests cancellation of the current answer.',
			title: 'Stop generation',
			troubleshooting: '',
			values: []
		},
		close: {
			details:
				'The app manages llama.cpp as its child process, while independent WSL inference services can continue running. Stop an engine explicitly on its page when you want that service stopped.',
			steps: [],
			summary: 'Closes this desktop window.',
			title: 'Close window',
			troubleshooting: '',
			values: []
		},
		copy: {
			details:
				'Check which item or message is selected. Copying does not save a separate file; paste into the destination to retain it.',
			steps: [],
			summary: 'Copies the selected content to the clipboard.',
			title: 'Copy',
			troubleshooting: '',
			values: []
		},
		cuda_home: {
			details:
				'This is the toolkit directory, not a Windows driver folder. Keep it blank unless the engine needs a specific installed toolkit.',
			steps: [],
			summary: 'Optional Linux CUDA toolkit location for engine compilation needs.',
			title: 'CUDA_HOME in WSL',
			troubleshooting: '',
			values: [
				['Leave blank', 'Let the engine use its existing environment.'],
				['/usr/local/cuda', 'Use only if that toolkit location exists in the selected WSL distro.']
			]
		},
		cuda_visible_devices: {
			details:
				'IDs refer to the devices visible inside the engine environment. Visibility is not tensor parallelism: listing two devices does not by itself configure the model to split across both. Verify the launch configuration and logs.',
			steps: [
				'Check GPU enumeration in WSL or engine logs.',
				'Select the intended IDs.',
				'Save and restart the engine; verify which devices allocate memory.'
			],
			summary: 'Restricts which GPUs this engine process can see.',
			title: 'GPU IDs',
			troubleshooting: '',
			values: [
				['Leave blank', 'Use the environment’s existing visibility.'],
				['0', 'Limit visibility to the first enumerated GPU.'],
				['0,1', 'Expose two enumerated GPUs; confirm the engine’s parallelism separately.']
			]
		},
		customCss: {
			details:
				'CSS can hide controls or make text hard to read. Save a copy of a working stylesheet before making broad changes.',
			steps: [],
			summary: 'Styles applied to the interface.',
			title: 'Custom CSS',
			troubleshooting: '',
			values: [
				['Leave blank', 'Use the app’s standard appearance.'],
				['Small scoped rule', 'Change one specific selector and verify both light and dark themes.']
			]
		},
		customJson: {
			details:
				'Use valid JSON matching the runtime’s supported request schema. Parameters can override or conflict with visible controls.',
			steps: [],
			summary: 'Extra request parameters sent to the inference API.',
			title: 'Custom JSON',
			troubleshooting: '',
			values: [
				['Leave blank', 'Use the visible settings for a clean baseline.'],
				['{}', 'An empty object adds no extra parameters.']
			]
		},
		'default-folder': {
			details:
				'Save the folder settings on this page to commit the choice. Restart the app when changing a cache or server log writer. Existing files are not moved.',
			steps: [],
			summary: 'Stages a return to the app’s default folder.',
			title: 'Use default folder',
			troubleshooting: '',
			values: []
		},
		delete: {
			details:
				'Check the item and surrounding context before proceeding. Deleting a conversation, removing a scan folder, and unloading a model have different effects. Read the confirmation when present.',
			steps: [],
			summary: 'Removes the selected item after any confirmation supplied by the app.',
			title: 'Delete',
			troubleshooting: '',
			values: []
		},
		device: {
			details:
				'Use the exact identifier reported by this build’s device enumeration. Device numbers are not necessarily the same as WSL CUDA visibility IDs.',
			steps: [
				'Keep the model and benchmark options identical across comparisons.',
				'Close other GPU workloads when measuring repeatability.',
				'Compare prompt processing and generation separately.'
			],
			summary: 'Optional llama.cpp device identifier for this benchmark.',
			title: 'Benchmark device',
			troubleshooting: '',
			values: [
				['Leave blank', 'Use the benchmark’s default device selection.'],
				[
					'Enumerated CUDA device',
					'Copy an identifier actually reported by llama.cpp; do not assume CUDA2 exists.'
				]
			]
		},
		distro: {
			details:
				'Use the exact registered WSL distribution name, not a Windows folder. Each engine may use a different Linux environment.',
			steps: [],
			summary: 'The installed Linux distribution where this engine runs.',
			title: 'WSL distro',
			troubleshooting: '',
			values: [
				['Installed distro name', 'Use the name shown by wsl --list --quiet.'],
				[
					'Separate engine distro',
					'Useful when engines require different CUDA or Python dependencies.'
				]
			]
		},
		dry_allowed_length: {
			details:
				'A larger allowance tolerates common short phrases. A smaller allowance can penalize legitimate code or formatting.',
			steps: [],
			summary: 'Allows short repeated token sequences before applying DRY.',
			title: 'DRY allowed length',
			troubleshooting: '',
			values: [
				['2', 'A short allowance to compare.'],
				['4', 'Tolerate more short repeated phrases.']
			]
		},
		dry_base: {
			details:
				'The base affects longer repeated sequences and works with the multiplier and allowed length. Keep the multiplier fixed when comparing.',
			steps: [],
			summary: 'Controls how fast the sequence penalty grows.',
			title: 'DRY base',
			troubleshooting: '',
			values: [
				['1.75', 'A starting point for comparison.'],
				['2', 'Faster growth; check that legitimate repetition survives.']
			]
		},
		dry_multiplier: {
			details:
				'DRY targets repeated sequences. Establish a baseline without DRY, then increase only if repeated passages remain a problem.',
			steps: [],
			summary: 'Controls the strength of sequence repetition suppression.',
			title: 'DRY multiplier',
			troubleshooting: '',
			values: [
				['0', 'Disabled baseline.'],
				['0.5', 'A mild sequence suppression experiment.'],
				['0.8', 'A stronger experiment; verify required repeated text.']
			]
		},
		dry_penalty_last_n: {
			details:
				'Longer windows consider more of the conversation. A full-context window may suppress material the user intentionally asks to repeat.',
			steps: [],
			summary: 'Sets how far back DRY looks for repeated sequences.',
			title: 'DRY penalty last N',
			troubleshooting: '',
			values: [
				['256', 'A short recent window.'],
				['1024', 'A wider comparison for longer answers.']
			]
		},
		dynatemp_exponent: {
			details: 'This setting matters only when dynamic temperature has a nonzero range.',
			steps: [],
			summary: 'Changes the curve used to map uncertainty to temperature.',
			title: 'Dynamic temperature exponent',
			troubleshooting: '',
			values: [
				['1', 'Neutral starting curve.'],
				['0.5', 'Compare a gentler exponent.'],
				['2', 'Compare a steeper exponent.']
			]
		},
		dynatemp_range: {
			details:
				'A zero range keeps temperature fixed. Tune a fixed temperature first so you have a useful baseline.',
			steps: [],
			summary: 'Allows temperature to vary with uncertainty.',
			title: 'Dynamic temperature range',
			troubleshooting: '',
			values: [
				['0', 'Keep temperature fixed.'],
				['0.1', 'Try a narrow dynamic range.'],
				['0.2', 'Compare a wider range after the baseline works.']
			]
		},
		'engine-save': {
			details:
				'Saving does not reconfigure a running service. The displayed configured endpoint can differ from the running service until restart.',
			steps: [
				'Review the fields.',
				'Save settings.',
				'Stop and restart the service to apply changes.',
				'Verify the served model and endpoint in Status.'
			],
			summary: 'Saves the configuration for this engine.',
			title: 'Save engine settings',
			troubleshooting: '',
			values: []
		},
		'engine-start': {
			details:
				'Start uses saved settings. The manager checks service state and API health; a running process alone does not prove the intended model is ready.',
			steps: [
				'Save changed settings.',
				'Start the service and wait for Ready.',
				'Verify the model name and make a short API request.'
			],
			summary: 'Launches the configured inference service.',
			title: 'Start engine',
			troubleshooting:
				'Read the engine logs if startup fails. Confirm the executable, WSL distro, port, model compatibility, and available memory.',
			values: []
		},
		'engine-stop': {
			details:
				'Active requests using this service can be interrupted. Stopping one engine does not stop separate inference services.',
			steps: [
				'Let important requests finish.',
				'Stop the service.',
				'Check Status before starting with changed settings.'
			],
			summary: 'Stops this engine’s service.',
			title: 'Stop engine',
			troubleshooting: '',
			values: []
		},
		executable: {
			details:
				'This is a Linux executable path inside the selected WSL distro. A Windows EXE path will not select the engine’s Linux virtual environment.',
			steps: [],
			summary: 'The Linux command or absolute path used to launch this engine.',
			title: 'Executable in WSL',
			troubleshooting: '',
			values: [
				['vllm', 'Use when the command is available to the service environment.'],
				[
					'/home/you/venv/bin/vllm',
					'Use an absolute virtual-environment path for predictable vLLM launches.'
				],
				[
					'/home/you/venv/bin/trtllm-serve',
					'Use the TensorRT-LLM environment’s serve executable on that engine’s page.'
				]
			]
		},
		export: {
			details:
				'Choose a format supported by the destination. Exported conversation data can contain prompts, answers, and attachments; inspect the chosen scope before sharing.',
			steps: [],
			summary: 'Saves selected data in the offered output format.',
			title: 'Export',
			troubleshooting: '',
			values: []
		},
		flashinfer_sampler: {
			details:
				'FlashInfer may compile components and need matching CUDA compiler tools and headers. The native sampler is a simpler first-run baseline.',
			steps: [],
			summary: 'Enables the optional FlashInfer sampling path.',
			title: 'FlashInfer sampler',
			troubleshooting: '',
			values: [
				['Off', 'Start here to verify engine installation.'],
				['On', 'Compare only after the matching dependencies are installed.']
			]
		},
		frequency_penalty: {
			details:
				'Positive values discourage reuse. These settings interact with other repetition controls. Strong penalties can make required vocabulary or code less reliable.',
			steps: [],
			summary: 'Penalizes a token more as it appears more often.',
			title: 'Frequency penalty',
			troubleshooting: '',
			values: [
				['0', 'Disabled baseline.'],
				['0.1', 'A mild positive experiment.'],
				['0.3', 'A stronger experiment if repetition persists.']
			]
		},
		gpu_memory_utilization: {
			details:
				'This is a memory budget, not a GPU speed or power limit. vLLM may reserve cache memory even when idle. Other apps and engines need their own headroom.',
			steps: [
				'Stop competing workloads before establishing the first baseline.',
				'Start the engine and inspect its reported memory allocation.',
				'Test the actual context and concurrency you need.'
			],
			summary: 'Budget for the vLLM instance’s GPU memory use, expressed as a fraction.',
			title: 'GPU memory fraction',
			troubleshooting:
				'If model weights cannot fit the selected budget, use a smaller model or a different device. Lowering the budget alone cannot make an oversized model fit.',
			values: [
				['0.5', 'A conservative experiment when sharing a GPU; the model must still fit.'],
				['0.7', 'A middle ground to test on a shared desktop.'],
				['0.9', 'A larger budget for a mostly dedicated GPU.']
			]
		},
		'hf-download': {
			details:
				'This action uses your network and disk space. The repository must offer a compatible GGUF. The optional quantization tag chooses a smaller or larger variant only when it exists in that repository.',
			steps: [
				'Search for a GGUF repository or enter its ID.',
				'Select the desired available quantization if needed.',
				'Start the download.',
				'Refresh Available models to inspect progress.'
			],
			summary: 'Starts downloading the selected Hugging Face GGUF repository.',
			title: 'Download and import',
			troubleshooting: '',
			values: []
		},
		'hf-repo': {
			details:
				'Enter owner/repository or owner/repository:quantization. Selecting a search result fills this field; Download and import starts the transfer. Ensure disk space and check whether access is gated.',
			steps: [],
			summary: 'Repository and optional quantization tag to download as GGUF.',
			title: 'Hugging Face repository',
			troubleshooting: '',
			values: [
				['owner/repository', 'Use the exact GGUF repository identifier.'],
				[
					'owner/repository:Q4_K_M',
					'A smaller quantization example if that repository provides it.'
				],
				[
					'owner/repository:Q8_0',
					'A larger quantization example if available; consumes more disk and memory.'
				]
			]
		},
		'hf-select': {
			details:
				'Selection prepares the repository name for review. Download and import is the separate action that starts a transfer.',
			steps: [],
			summary: 'Copies this search result into the download field.',
			title: 'Select repository',
			troubleshooting: '',
			values: []
		},
		import: {
			details:
				'Inspect the selected file type and scope. Importing settings can change future request behavior; preserve a working export before replacing a configuration.',
			steps: [],
			summary: 'Reads supported saved data into the app.',
			title: 'Import',
			troubleshooting: '',
			values: []
		},
		'install-guide': {
			details:
				'TensorRT-LLM requires a compatible model, GPU, CUDA stack, and Python environment. A saved configuration does not install those dependencies or prove compatibility.',
			steps: [
				'Follow the official installation guide in a separate environment.',
				'Enter the installed executable and a small supported model.',
				'Start the engine and verify a real request.'
			],
			summary: 'Opens the engine’s installation documentation.',
			title: 'TensorRT-LLM installation guide',
			troubleshooting: '',
			values: []
		},
		'log-folder': {
			details:
				'Changing the folder does not move existing logs. Save the folder choice and restart the app to redirect the running llama.cpp server’s future output.',
			steps: [
				'Choose the desired folder.',
				'Save folder.',
				'Restart the app and verify new output.'
			],
			summary: 'Chooses where the app writes future local server logs.',
			title: 'Log folder',
			troubleshooting: '',
			values: []
		},
		'log-save': {
			details:
				'The log viewer refreshes its file list after saving. The running server changes output location after an app restart.',
			steps: [
				'Choose a folder or Use default.',
				'Save folder.',
				'Restart the app to apply the writer’s location.'
			],
			summary: 'Saves the selected output folder.',
			title: 'Save log folder',
			troubleshooting: '',
			values: []
		},
		logs: {
			details:
				'Logs help explain failed startup, model loading, missing files, and memory errors. Local files and WSL service journals are separate sources. Refresh after reproducing an issue.',
			steps: [
				'Reproduce the problem once.',
				'Open the relevant engine journal or local server log.',
				'Read the first error around that time.',
				'Adjust the named setting and retry.'
			],
			summary: 'Displays diagnostic output from the selected file or engine.',
			title: 'Logs',
			troubleshooting: '',
			values: []
		},
		max_model_len: {
			details:
				'Longer contexts require more KV-cache memory. The model itself also has a supported context limit. Raising this value does not increase model intelligence or guarantee all concurrent requests fit.',
			steps: [
				'Start with a small model and context.',
				'Send an actual request, then check memory use.',
				'Increase context gradually while keeping space for other workloads.'
			],
			summary: 'Maximum combined prompt and output tokens the engine can handle per request.',
			title: 'Max context length',
			troubleshooting:
				'If startup or requests run out of memory, reduce context, concurrency, or model size.',
			values: [
				['4096', 'A small startup and API test.'],
				['8192', 'A moderate context test after startup works.'],
				['16384', 'Longer inputs if the model supports it and memory permits.']
			]
		},
		max_tokens: {
			details:
				'Tokens are pieces of text, not characters or words. Prompt and generated answer still share the model’s available context. A large cap permits longer output but does not force it.',
			steps: [
				'Choose a short cap for your first test.',
				'Increase it if useful answers are being cut off.'
			],
			summary: 'Caps the length of each generated answer, measured in tokens.',
			title: 'Max tokens',
			troubleshooting:
				'Reasoning tokens may consume the output budget before the visible answer appears. Increase the budget when a reasoning model stops too early.',
			values: [
				['512', 'Short answers and fast smoke tests.'],
				['2048', 'A starting point for normal explanations.'],
				['8192', 'Longer code or reasoning outputs when the model and context can support them.']
			]
		},
		maxImageMPixels: {
			details:
				'More pixels can preserve fine detail but require more processing and model resources. The model’s image preprocessing also affects the result.',
			steps: [],
			summary: 'Image size budget in megapixels before processing.',
			title: 'Maximum image resolution',
			troubleshooting: '',
			values: [
				['1', 'A lower-resource image test.'],
				['2', 'Compare moderate detail.'],
				['4', 'Compare small text and detailed screenshots if the model supports them.']
			]
		},
		maximize: {
			details:
				'Use this to give chat and settings more screen space without changing inference configuration.',
			steps: [],
			summary: 'Toggles between a maximized and restored desktop window.',
			title: 'Maximize window',
			troubleshooting: '',
			values: []
		},
		mcp: {
			details:
				'Tool support depends on the selected model and connected server. Check individual tool descriptions and test a short workflow before increasing the turn limit.',
			steps: [],
			summary: 'Connects model requests to configured external tools.',
			title: 'Tools and MCP',
			troubleshooting: '',
			values: []
		},
		mcpRequestTimeoutSeconds: {
			details: 'Longer limits help slow tools but make failed requests take longer to return.',
			steps: [],
			summary: 'How long a tool request may wait before timing out.',
			title: 'MCP request timeout',
			troubleshooting: '',
			values: [
				['30', 'Quick local tools.'],
				['60', 'A general starting comparison.'],
				['120', 'Slower tools after confirming they are working.']
			]
		},
		mentionSearchMaxDepth: {
			details:
				'Deeper searches can find nested project files but take longer and return more matches.',
			steps: [],
			summary: 'Maximum folder depth searched for file mentions.',
			title: 'Mention search depth',
			troubleshooting: '',
			values: [
				['2', 'Small projects and quick browsing.'],
				['4', 'Moderately nested source trees.'],
				['6', 'Deeper repositories when shallower results are insufficient.']
			]
		},
		min_p: {
			details:
				'Increasing Min P removes more low-probability tokens. Its effect depends on how confident the model is at each step.',
			steps: [],
			summary: 'Drops tokens that are too unlikely relative to the most likely token.',
			title: 'Min P',
			troubleshooting: '',
			values: [
				['0', 'Disable Min P for a baseline.'],
				['0.05', 'A modest filtering experiment.'],
				['0.1', 'Stronger filtering; inspect whether useful variety is lost.']
			]
		},
		minimize: {
			details: 'Minimizing does not stop inference services. Restore the window from the taskbar.',
			steps: [],
			summary: 'Hides the desktop window on the taskbar.',
			title: 'Minimize window',
			troubleshooting: '',
			values: []
		},
		model: {
			details:
				'The model format must be supported by the chosen runtime. A llama.cpp GGUF selection is not automatically suitable for vLLM or TensorRT-LLM. Check the model and engine compatibility first.',
			steps: [],
			summary: 'Model repository identifier or Linux model path for this engine.',
			title: 'Engine model',
			troubleshooting: '',
			values: [
				[
					'Small supported model',
					'Verify installation and a real API response before loading a large model.'
				],
				[
					'Existing Linux model directory',
					'Use an absolute WSL path containing the expected model files.'
				]
			]
		},
		'model-folders': {
			details:
				'The app scans the built-in folder and selected external folders recursively. Files stay in their existing locations. Removing a folder from the list does not delete its contents.',
			steps: [
				'Choose Add folders.',
				'Select the existing folders that contain GGUF files.',
				'Save and rescan.',
				'Use the model search to find a file.'
			],
			summary: 'Adds existing GGUF folders to the model scan.',
			title: 'Model folders',
			troubleshooting: '',
			values: []
		},
		'model-load': {
			details:
				'Loading consumes memory and may take time. A listed file is not necessarily already loaded. Wait for the loaded status before sending a request.',
			steps: [
				'Check the model’s status.',
				'Load one model for the first test.',
				'Wait for completion and check Logs if it returns to unloaded.',
				'Select the loaded model in chat.'
			],
			summary: 'Loads this GGUF into the llama.cpp router.',
			title: 'Load model',
			troubleshooting: '',
			values: []
		},
		'model-remove-folder': {
			details:
				'This does not delete files. Save and rescan commits the revised folder list; models may still appear if another configured folder also includes them.',
			steps: ['Remove the unwanted scan location.', 'Choose Save and rescan to apply the list.'],
			summary: 'Removes this folder from the pending external model folder list.',
			title: 'Remove model folder',
			troubleshooting: '',
			values: []
		},
		'model-rescan': {
			details:
				'The server reloads its model catalogue from the configured locations. A saved cache folder takes effect after restarting the app.',
			steps: [
				'Add or remove folders.',
				'Save and rescan.',
				'Check Available models and clear any search filter.'
			],
			summary: 'Saves folder choices and rebuilds the local model list.',
			title: 'Save and rescan',
			troubleshooting: '',
			values: []
		},
		'model-unload': {
			details:
				'Unloading can interrupt work using that model and releases its allocated resources. It does not delete the GGUF from disk.',
			steps: [
				'Finish requests using the model.',
				'Unload it.',
				'Verify its status before loading another large model.'
			],
			summary: 'Releases a model from the llama.cpp router.',
			title: 'Unload model',
			troubleshooting: '',
			values: []
		},
		models: {
			details:
				'The catalogue lists what the router can discover. Loading a model allocates memory; selecting a chat model routes future requests to it. WSL engines have their own model settings.',
			steps: [],
			summary: 'Manages local GGUF discovery, downloads, and load state.',
			title: 'Models',
			troubleshooting: '',
			values: []
		},
		'new-chat': {
			details:
				'A new conversation has its own history. It does not necessarily unload models or clear other conversations. Check the selected model and system instructions before sending.',
			steps: [],
			summary: 'Starts a new conversation with the selected model.',
			title: 'New chat',
			troubleshooting: '',
			values: []
		},
		'open-folder': {
			details:
				'Use File Explorer to inspect or copy log files. Opening the folder does not clear logs or change settings.',
			steps: [],
			summary: 'Opens the configured local log folder in Windows.',
			title: 'Open in File Explorer',
			troubleshooting: '',
			values: []
		},
		pasteLongTextToFileLen: {
			details:
				'A lower threshold keeps the composer compact. Conversion changes how a paste is represented in the conversation.',
			steps: [],
			summary: 'Character threshold for converting pasted text into an attachment.',
			title: 'Paste long text to file length',
			troubleshooting: '',
			values: [
				['0', 'Disable automatic conversion.'],
				['2500', 'The app’s normal starting threshold.'],
				['5000', 'Keep longer pastes inline before converting.']
			]
		},
		port: {
			details:
				'Each simultaneously running service needs a free port. Changing the saved port requires an engine restart and updated client endpoints.',
			steps: [],
			summary: 'The local TCP port clients use to reach this engine.',
			title: 'API port',
			troubleshooting: '',
			values: [
				['8000', 'The Router’s vLLM starting port.'],
				['8001', 'The Router’s TensorRT-LLM starting port.'],
				[
					'Another free port',
					'Choose a unique integer from 1–65535 if the starting port is occupied.'
				]
			]
		},
		presence_penalty: {
			details:
				'Positive values discourage reuse. These settings interact with other repetition controls. Strong penalties can make required vocabulary or code less reliable.',
			steps: [],
			summary: 'Penalizes a token once it has appeared.',
			title: 'Presence penalty',
			troubleshooting: '',
			values: [
				['0', 'Disabled baseline.'],
				['0.1', 'A mild positive experiment.'],
				['0.3', 'A stronger experiment if repetition persists.']
			]
		},
		refresh: {
			details:
				'Refresh reads current information without saving edited configuration. On model pages it refreshes the model catalogue; on logs it refreshes available files; on an engine page it checks status.',
			steps: [],
			summary: 'Reloads the current page’s list or service information.',
			title: 'Refresh',
			troubleshooting: '',
			values: []
		},
		repeat_last_n: {
			details:
				'A larger window notices repetition farther back. This setting works with the penalty strength rather than replacing it.',
			steps: [],
			summary: 'Sets how many recent tokens repetition penalties inspect.',
			title: 'Repeat last N',
			troubleshooting: '',
			values: [
				['64', 'Short local repetition window.'],
				['128', 'A broader local comparison.'],
				['256', 'Look farther back in longer prose.']
			]
		},
		repeat_penalty: {
			details:
				'Too much repetition penalty can damage code, names, and required repeated phrases. Use small changes and inspect a representative output.',
			steps: [],
			summary: 'Makes recently used tokens less attractive.',
			title: 'Repeat penalty',
			troubleshooting: '',
			values: [
				['1.0', 'Disabled; a clean baseline.'],
				['1.05', 'A mild experiment when prose repeats.'],
				['1.1', 'A stronger experiment; check code and proper names carefully.']
			]
		},
		reset: {
			details:
				'The setting returns to the selected model or server’s supplied default when available. Review the resulting value before comparing output.',
			steps: [],
			summary: 'Removes the custom override for this setting.',
			title: 'Reset to default',
			troubleshooting: '',
			values: []
		},
		samplers: {
			details:
				'These operations are not interchangeable: changing their order can change the output even with the same numeric settings.',
			steps: [],
			summary: 'Controls the order in which token filters and temperature are applied.',
			title: 'Sampler order',
			troubleshooting: '',
			values: [
				['Leave blank', 'Keep the model or server’s sampler order.'],
				[
					'Model author’s recipe',
					'Use an explicit order only when the model documentation supplies one.'
				]
			]
		},
		search: {
			details:
				'Use a distinctive model, repository, or conversation name. A local filter does not download files. Search Hub queries Hugging Face over the internet.',
			steps: [],
			summary: 'Filters a local list or searches the indicated catalogue.',
			title: 'Search',
			troubleshooting: '',
			values: [
				['Distinctive model name', 'Find a particular family or size.'],
				['Quantization tag', 'Narrow a GGUF list when the tag appears in its name.'],
				['Clear the search', 'Show the full local list again.']
			]
		},
		settings: {
			details:
				'Sampling settings affect future requests. A blank sampling override follows the selected model or server’s supplied default when the UI supports inheritance. Engine startup configuration is managed separately on its engine page.',
			steps: [
				'Use the model’s default sampling recipe first.',
				'Change one option at a time.',
				'Repeat the same prompt and compare the result.'
			],
			summary: 'Configures chat behavior, sampling, display, and tools.',
			title: 'Settings',
			troubleshooting: '',
			values: []
		},
		status: {
			details:
				'Ready requires both an active service and a successful HTTP health check. Model differs means the running model does not match the saved configuration. Status does not send a full inference request.',
			steps: [
				'Read the service state and health result.',
				'Compare the running model with the saved model field.',
				'Send a short request from the intended client.'
			],
			summary: 'Checks whether the service and HTTP API are ready.',
			title: 'Engine status',
			troubleshooting: '',
			values: []
		},
		systemMessage: {
			details:
				'Use concise behavior instructions. A system message guides the model but does not grant tools, load documents, or guarantee compliance.',
			steps: [],
			summary: 'Instructions that guide how the model should respond.',
			title: 'System message',
			troubleshooting: '',
			values: [
				['Leave blank', 'Use the existing model and conversation behavior.'],
				['Be concise and explain assumptions.', 'A simple example that is easy to evaluate.']
			]
		},
		temperature: {
			details:
				'Low values concentrate on likely tokens; higher values allow more variation. Temperature cannot guarantee factual accuracy. Reasoning models may need the sampling settings supplied by their model author.',
			steps: [
				'Start with the model’s supplied default.',
				'Change only temperature and repeat the same prompt.',
				'Compare correctness and variety before adjusting other samplers.'
			],
			summary: 'Controls how predictable or varied the next token can be.',
			title: 'Temperature',
			troubleshooting: 'If answers become erratic, lower temperature or restore the model default.',
			values: [
				['0.2', 'A focused starting point for extraction and straightforward code edits.'],
				['0.7', 'A balanced experiment for ordinary chat.'],
				['1.0', 'More variety for brainstorming; compare against the model author’s recipe.']
			]
		},
		theme: {
			details:
				'Choose a fixed theme or let the interface follow Windows. Help panels retain their black glass appearance in either theme.',
			steps: [],
			summary: 'Chooses how the app follows light and dark appearance.',
			title: 'Theme',
			troubleshooting: '',
			values: [
				['System', 'Match the device’s theme.'],
				['Dark', 'Use a dark interface consistently.'],
				['Light', 'Use a light interface consistently.']
			]
		},
		top_k: {
			details:
				'A smaller candidate pool reduces variety. This filter combines with Top P and Min P, so several restrictive filters can remove useful alternatives.',
			steps: [],
			summary: 'Limits selection to the K most likely next tokens.',
			title: 'Top K',
			troubleshooting: '',
			values: [
				['20', 'A narrower candidate pool for an initial comparison.'],
				['40', 'A broader comparison point.'],
				['0', 'Disable this filter and let other samplers choose.']
			]
		},
		top_p: {
			details:
				'Lower thresholds restrict choice more strongly. Apply the model author’s recipe first, then tune one sampler at a time.',
			steps: [],
			summary: 'Keeps a candidate set whose combined probability reaches this threshold.',
			title: 'Top P',
			troubleshooting: '',
			values: [
				['0.9', 'A relatively focused experiment.'],
				['0.95', 'A wider candidate pool.'],
				['1.0', 'Disable nucleus filtering.']
			]
		},
		trtllm: {
			details:
				'Its installation and hardware compatibility must be verified separately. Use its own port and environment. A Ready status should be followed by a real model request before relying on it.',
			steps: [],
			summary: 'Manages the optional TensorRT-LLM service in WSL2.',
			title: 'TensorRT-LLM service',
			troubleshooting: '',
			values: []
		},
		typ_p: {
			details:
				'Typical sampling is an additional filter. Start with it disabled when diagnosing the effects of Top P, Top K, or Min P.',
			steps: [],
			summary: 'Filters candidates according to how typical their information content is.',
			title: 'Typical P',
			troubleshooting: '',
			values: [
				['1', 'Disable this filter for a baseline.'],
				['0.95', 'A modest typical-sampling experiment.']
			]
		},
		vllm: {
			details:
				'This service exposes an API for external clients. Save settings, restart to apply changes, then verify readiness and a short real request. Closing the chat window does not stop this independent service.',
			steps: [],
			summary: 'Manages the independent vLLM service in WSL2.',
			title: 'vLLM service',
			troubleshooting: '',
			values: []
		},
		xtc_probability: {
			details:
				'XTC can increase variety by excluding some obvious tokens. Begin disabled for reliable comparisons, especially with structured outputs.',
			steps: [],
			summary: 'Sets how often XTC removes high-probability choices.',
			title: 'XTC probability',
			troubleshooting: '',
			values: [
				['0', 'Disabled baseline.'],
				['0.1', 'Apply XTC occasionally for a controlled experiment.']
			]
		},
		xtc_threshold: {
			details:
				'This threshold only matters when XTC probability is above zero. Use the model author’s recipe if supplied.',
			steps: [],
			summary: 'Sets the probability threshold used by XTC.',
			title: 'XTC threshold',
			troubleshooting: '',
			values: [
				['0.1', 'A starting comparison threshold.'],
				['0.2', 'Compare which candidates remain eligible for exclusion.']
			]
		}
	}
};

// Launch-profile fields share the existing contextual documentation system.
Object.assign(window.RouterHelpCatalog.topics, {
  "batch_size": {
    "details": "A larger batch may improve prompt processing throughput while increasing peak memory. The microbatch must not exceed the logical batch. Set both values explicitly when choosing a small batch, because 0 preserves the runtime defaults used by validation.",
    "summary": "Limits the number of prompt tokens processed in one logical batch.",
    "title": "Logical batch size",
    "values": [
      [
        "0",
        "Use the runtime default, typically 2048 in the pinned build."
      ],
      [
        "512",
        "A smaller experiment with microbatch 512 or lower."
      ],
      [
        "2048",
        "Compare prompt throughput and peak memory against a smaller batch."
      ]
    ]
  },
  "cache_type_k": {
    "details": "Lower-precision caches can reduce VRAM use but may change quality and backend compatibility. Experimental tensor mode requires f32, f16, or bf16. Quantized V cache requires Flash Attention. The requested format is emitted or rejected rather than silently replaced.",
    "summary": "Chooses the stored numeric format for this part of the KV cache.",
    "title": "K cache type",
    "values": [
      [
        "f16",
        "A floating-point compatibility baseline."
      ],
      [
        "bf16",
        "Use only with a verified model/backend combination."
      ],
      [
        "q8_0",
        "Compare memory and quality with compatible attention/backend support."
      ]
    ]
  },
  "cache_type_v": {
    "details": "Lower-precision caches can reduce VRAM use but may change quality and backend compatibility. Experimental tensor mode requires f32, f16, or bf16. Quantized V cache requires Flash Attention. The requested format is emitted or rejected rather than silently replaced.",
    "summary": "Chooses the stored numeric format for this part of the KV cache.",
    "title": "V cache type",
    "values": [
      [
        "f16",
        "A floating-point compatibility baseline."
      ],
      [
        "bf16",
        "Use only with a verified model/backend combination."
      ],
      [
        "q8_0",
        "Compare memory and quality with compatible attention/backend support."
      ]
    ]
  },
  "ctx_size": {
    "details": "An explicit value is preserved even when automatic memory fitting is enabled. Larger contexts consume more KV cache memory. Parallel sequences may divide or multiply context requirements depending on the exact runtime build; compare the resolved arguments and runtime logs. A value of 0 leaves context selection to the model and runtime.",
    "summary": "Limits the context allocated by the llama.cpp server, including the prompt and generated answer.",
    "title": "Server context length",
    "troubleshooting": "If model loading fails, retain the saved profile and test a copy with a smaller context. Tensor splitting requires an explicit positive context, Flash Attention on, floating-point caches, and fitting off.",
    "values": [
      [
        "0",
        "Use the model/runtime default when you have not measured a suitable limit."
      ],
      [
        "4096",
        "A conservative first compatibility test for a small model."
      ],
      [
        "8192",
        "Try after the smaller context works and memory headroom is available."
      ]
    ]
  },
  "device": {
    "details": "CUDA numbering may change after hardware or visibility changes. Physical UUID selection takes priority and produces a fresh runtime list. Manual device names are useful for testing or non-CUDA backends, but they are less durable than physical identities. The word none explicitly selects CPU offload behavior.",
    "summary": "Selects devices by the names reported by the exact runtime under its launch environment.",
    "title": "Runtime device list",
    "values": [
      [
        "CUDA1,CUDA2",
        "An example ordered list only; first inspect this machine’s runtime inventory."
      ],
      [
        "none",
        "Explicitly disable GPU offloading."
      ],
      [
        "Empty",
        "Leave device selection to the runtime when no UUID selection exists."
      ]
    ]
  },
  "extra_args": {
    "details": "Quotes group values; no shell expansion occurs and Windows path separators remain literal. Managed settings and their known aliases cannot be overridden here. Additional options must be advertised by the installed runtime before actual startup. Credential values are redacted in launch diagnostics.",
    "summary": "Adds expert options after managed launch settings have been validated.",
    "title": "Additional runtime arguments",
    "values": [
      [
        "Empty",
        "The recommended starting point."
      ],
      [
        "--alias \"My model\"",
        "Give a compatible runtime/model an explicit served name."
      ]
    ]
  },
  "fit": {
    "details": "An explicit context remains part of your request. Fitting cannot create more VRAM or reserve memory against unrelated apps. Experimental tensor mode requires fitting off. Compare the requested profile with runtime logs and the effective launch preview.",
    "summary": "Lets llama.cpp adjust unspecified memory-related settings to fit the available hardware.",
    "title": "Automatic memory fitting",
    "values": [
      [
        "On",
        "A useful starting point for ordinary layer/single-card loading."
      ],
      [
        "Off",
        "Manual tuning and eligible experimental tensor validation."
      ]
    ]
  },
  "fit_ctx": {
    "details": "Use a positive integer. Increasing this floor can stop fitting from finding a configuration that fits. An explicit context is still preserved by the wrapper; check the installed runtime’s fitting semantics and log messages.",
    "summary": "Sets the context floor used during automatic fitting.",
    "title": "Minimum fitted context",
    "values": [
      [
        "4096",
        "The existing wrapper’s starting context floor."
      ],
      [
        "2048",
        "A smaller compatibility experiment for a memory-limited model."
      ]
    ]
  },
  "fit_target": {
    "details": "The value is a fitting target, not an atomic memory reservation. Use one nonnegative integer or a comma-separated list supported by your exact runtime. Display workloads and other GPU applications can need additional headroom. Lowering it may increase out-of-memory risk.",
    "summary": "Sets the fitting headroom target in MiB for supported runtime builds.",
    "title": "Fitting headroom",
    "values": [
      [
        "1024",
        "The existing wrapper default; not a measured recommendation for every workload."
      ],
      [
        "2048",
        "A more conservative experiment when display or background GPU work needs space."
      ]
    ]
  },
  "flash_attn": {
    "details": "Availability depends on the runtime package, backend, model, and cache types. Quantized V caches require Flash Attention. Experimental tensor mode requires an explicit on value. A setting accepted by the compiler is not proof of successful model inference.",
    "summary": "Chooses whether the runtime uses its Flash Attention implementation.",
    "title": "Flash Attention",
    "values": [
      [
        "auto",
        "Let the runtime select a compatible implementation."
      ],
      [
        "on",
        "Required by the validated tensor launch constraints."
      ],
      [
        "off",
        "A compatibility comparison with floating-point V cache only."
      ]
    ]
  },
  "gpu_placement": {
    "details": "Manual preserves your device and split controls. Single chooses the visible card with the most free memory at launch. Spread uses the visible cards with layer splitting. These are whole-server choices; they do not assign an independent model to each card. Select physical UUIDs to constrain the available cards and preserve their identity when numbering changes.",
    "summary": "Chooses how one llama.cpp server uses its selected or visible GPUs.",
    "title": "GPU placement policy",
    "values": [
      [
        "Manual",
        "Use an explicit device list or ordered physical GPU selection."
      ],
      [
        "Single",
        "A small model that fits on one card."
      ],
      [
        "Spread",
        "A model that benefits from capacity across selected cards."
      ]
    ]
  },
  "llamacpp_env": {
    "details": "Separate assignments with semicolons. The same resolved environment is used for discovery and launch. Managed LLAMA_ARG variables, LLAMA_CACHE, and GGML_CUDA_P2P cannot be overridden here; inherited managed argument variables and disabled P2P are removed. CUDA visibility overrides must agree with an explicit UUID selection. Values can contain credentials, so launch diagnostics redact this field.",
    "summary": "Adds environment assignments only to the runtime’s child process.",
    "title": "Child-process environment",
    "values": [
      [
        "Empty",
        "Use a clean managed environment without custom overrides."
      ],
      [
        "CUDA_VISIBLE_DEVICES=GPU-…",
        "Expert use only; prefer the physical GPU selector."
      ]
    ]
  },
  "n_gpu_layers": {
    "details": "The wrapper retains -1 as its legacy automatic/unspecified setting. A nonnegative integer is passed explicitly. A very large count can request all available layers but does not guarantee that weights, KV cache, and compute buffers fit. Inspect the actual offloaded layer count in runtime logs.",
    "summary": "Controls how many model layers are offered for GPU offloading.",
    "title": "GPU layer count",
    "values": [
      [
        "-1",
        "Preserve automatic runtime selection."
      ],
      [
        "0",
        "Keep model layers on the CPU."
      ],
      [
        "99",
        "An explicit all-layers request for models with fewer than 99 layers; verify fit."
      ]
    ]
  },
  "parallel": {
    "details": "More simultaneous sequences can increase KV cache use and queue pressure. Context allocation semantics depend on the exact runtime version. Whole-server parallelism does not create independent per-GPU model workers.",
    "summary": "Controls the number of inference sequences the server can process concurrently.",
    "title": "Parallel server sequences",
    "values": [
      [
        "0",
        "Use the runtime default."
      ],
      [
        "1",
        "Establish a repeatable single-request baseline."
      ],
      [
        "2",
        "Test modest concurrency after memory use is understood."
      ]
    ]
  },
  "selected_gpu_uuids": {
    "details": "The wrapper resolves the UUIDs under the child environment and checks that every selected card is present. Selection order controls the meaning of allocation weights. Missing cards remain in your saved profile and block launching. CUDA identity discovery can work when NVIDIA monitoring is unavailable; missing free-memory values then remain unknown.",
    "summary": "Saves an ordered list of physical GPU UUIDs rather than transient CUDA numbers.",
    "title": "Physical GPU identity",
    "values": [
      [
        "Both 3090 UUIDs",
        "A dual-card model, with weights ordered to match your selection."
      ],
      [
        "One GPU UUID",
        "Restrict the server to that physical card."
      ],
      [
        "Empty selection",
        "Use the manual runtime-device field or the placement policy."
      ]
    ]
  },
  "split_mode": {
    "details": "Layer mode distributes layers between cards. None uses a single device. Tensor mode is experimental and must be validated for the exact model and runtime package. Advertising tensor in --help does not prove that an arbitrary model supports it. Row is retained for legacy profiles.",
    "summary": "Controls how llama.cpp divides a model across selected devices.",
    "title": "GPU split mode",
    "values": [
      [
        "layer",
        "The starting mode for a model spread across two 3090s."
      ],
      [
        "none",
        "A model loaded on one card."
      ],
      [
        "tensor",
        "Experiment only with fit off, Flash Attention on, explicit context, and f32/f16/bf16 caches."
      ]
    ]
  },
  "tensor_split": {
    "details": "Weights are ratios, not hard memory limits or GiB quotas. Every selected device needs one finite nonnegative value and the total must be positive. Equal weights are a starting point; actual weight, KV, output, and compute allocations can still differ. Check allocation logs and free memory before increasing context.",
    "summary": "Sets relative allocation weights in the same order as the resolved device list.",
    "title": "GPU allocation weights",
    "values": [
      [
        "1,1",
        "Equal starting weights for two selected cards."
      ],
      [
        "2,1",
        "A two-to-one ratio when one selected card has less usable memory."
      ],
      [
        "Empty",
        "Allow the placement policy/runtime to choose; UUID-selected pairs start equally."
      ]
    ]
  },
  "ubatch_size": {
    "details": "A microbatch must be no larger than the logical batch. Reducing it can help peak compute-buffer memory at the cost of prompt-processing speed. A value of 0 keeps the runtime default.",
    "summary": "Limits the physical prompt-processing microbatch.",
    "title": "Physical microbatch size",
    "values": [
      [
        "0",
        "Use the runtime default, typically 512 in the pinned build."
      ],
      [
        "128",
        "A conservative comparison for constrained compute-buffer memory."
      ],
      [
        "512",
        "A larger microbatch when memory and the logical batch allow it."
      ]
    ]
  }
});
