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
	MODELS: '#/models',
	LOGS: '#/logs',
	BENCH: '#/llama-bench',
	TRTLLM: '#/tensorrt-llm',
	VLLM: '#/vllm',
	/** Chat base — for dynamic chat URLs use RouterService. */
	CHAT: '#/chat',
	/** MCP servers. */
	MCP_SERVERS: '#/mcp-servers',
	/** Search — mobile-only full-page conversation search. */
	SEARCH: '#/search',
	/** Root — start of the app. */
	START: '#/'
} as const;
