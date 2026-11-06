type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function engineManager(): Invoke | null {
	if (typeof window === 'undefined') return null;

	return (
		(window as Window & { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke ??
		null
	);
}
