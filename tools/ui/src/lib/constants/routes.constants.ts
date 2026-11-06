/** Query params the chat routes read from the URL. */
export const URL_PARAMS = {
	/** Load the selected model instead of waiting for the first message. */
	LOAD: 'load',
	/** Model to select. */
	MODEL: 'model',
	/** Prompt to send on arrival. */
	QUERY: 'q'
} as const;

export const ROUTES = {
	BENCH: '#/llama-bench',
	/** Chat base — for dynamic chat URLs use RouterService. */
	CHAT: '#/chat',
	LOGS: '#/logs',
	/** MCP servers. */
	MCP_SERVERS: '#/mcp-servers',
	MODELS: '#/models',
	/** Search — mobile-only full-page conversation search. */
	SEARCH: '#/search',
	/** Root — start of the app. */
	START: '#/',
	TRTLLM: '#/tensorrt-llm',
	VLLM: '#/vllm'
} as const;
