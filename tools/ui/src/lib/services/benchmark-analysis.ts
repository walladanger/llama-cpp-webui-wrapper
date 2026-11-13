export type BenchRow = {
	model_type: string;
	avg_ts: number;
	stddev_ts?: number;
	n_prompt: number;
	n_gen: number;
	n_depth?: number;
	backends?: string;
	n_gpu_layers?: number;
	model_size?: number;
	[key: string]: unknown;
};
export type BenchReport = {
	schemaVersion: number;
	id: string;
	createdAt: number;
	model: string;
	mode: string;
	status: string;
	error: string | null;
	modelFiles: unknown;
	runtimeFiles: unknown;
	repetitions?: number;
	environment: unknown;
	hardware?: HardwareScan;
	results: { label: string; rows: BenchRow[]; stderr?: string }[];
};
export type HardwareScan = {
	system: {
		cpu: string;
		ramBytes: number;
		freeRamKiB: number;
		logicalProcessors: number;
		os: string;
	} | null;
	cards: {
		uuid: string;
		name: string;
		total: number | null;
		free: number | null;
		source: string;
	}[];
	devices: { id: string; description: string }[];
	telemetry:
		| {
				uuid: string;
				name: string;
				totalMiB: number | null;
				freeMiB: number | null;
				utilization: number | null;
				temperature: number | null;
				powerW: number | null;
				powerLimitW: number | null;
				pcieGen: number | null;
				pcieWidth: number | null;
		  }[]
		| null;
	supportsDeep: boolean;
	issues: string[];
	capturedAt: number;
};

const finitePositive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value > 0;
export function validRows(value: unknown): BenchRow[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(r): r is BenchRow =>
			r &&
			typeof r.model_type === 'string' &&
			finitePositive(r.avg_ts) &&
			Number.isInteger(r.n_prompt) &&
			r.n_prompt >= 0 &&
			Number.isInteger(r.n_gen) &&
			r.n_gen >= 0 &&
			((r.n_prompt > 0 && r.n_gen === 0) || (r.n_gen > 0 && r.n_prompt === 0))
	);
}
export function parseOutput(text: string): BenchRow[] {
	if (text.length > 8 * 1024 * 1024) throw new Error('Use a benchmark report smaller than 8 MB.');
	try {
		const data = JSON.parse(text);
		return validRows(
			Array.isArray(data) ? data : data.results?.flatMap((r: { rows?: unknown[] }) => r.rows ?? [])
		);
	} catch (error) {
		if (text.trim().startsWith('{') || text.trim().startsWith('['))
			throw new Error('The JSON report is invalid.');
	}
	let headers: string[] = [];
	const rows: BenchRow[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line
			.trim()
			.replace(/^\||\|$/g, '')
			.split('|')
			.map((c) => c.trim());
		if (cells.includes('test') && cells.includes('t/s')) {
			headers = cells;
			continue;
		}
		const cell = (name: string) => cells[headers.indexOf(name)] ?? '';
		const test = /^(pp|tg)\s*(\d+)(?:\s*@\s*d(\d+))?$/.exec(cell('test'));
		const speed = /^(\d+(?:\.\d+)?)(?:\s*±\s*(\d+(?:\.\d+)?))?$/.exec(cell('t/s'));
		if (
			!test ||
			!speed ||
			!Number.isFinite(Number(speed[1])) ||
			Number(speed[1]) <= 0 ||
			Number(test[2]) <= 0
		)
			continue;
		rows.push({
			model_type: cell('model'),
			backends: cell('backend'),
			n_gpu_layers: Number(cell('ngl')),
			n_prompt: test[1] === 'pp' ? Number(test[2]) : 0,
			n_gen: test[1] === 'tg' ? Number(test[2]) : 0,
			n_depth: Number(test[3] ?? 0),
			avg_ts: Number(speed[1]),
			stddev_ts: speed[2] ? Number(speed[2]) : undefined
		});
	}
	return rows;
}
export function speedTier(rate: number) {
	if (rate >= 100)
		return { title: 'Very fast output', detail: 'Short replies stream quickly in this test.' };
	if (rate >= 40)
		return {
			title: 'Fluid output',
			detail: 'A comfortable pace for interactive chat in this test.'
		};
	if (rate >= 15)
		return {
			title: 'Steady output',
			detail: 'Usable for chat; longer replies take more patience.'
		};
	if (rate >= 5)
		return {
			title: 'Slow output',
			detail: 'Consider a smaller model for frequent short interactions.'
		};
	return {
		title: 'Very slow output',
		detail: 'Check GPU offload and memory pressure, then test a smaller model.'
	};
}
export function primaryGeneration(rows: BenchRow[]) {
	return rows.find((r) => r.n_gen > 0 && r.n_prompt === 0 && (r.n_depth ?? 0) === 0);
}
export function variation(row: BenchRow): number | null {
	return typeof row.stddev_ts === 'number' && Number.isFinite(row.stddev_ts) && row.stddev_ts >= 0
		? (100 * row.stddev_ts) / row.avg_ts
		: null;
}

// A result without a full workload identity is never eligible for a ranking.
const matchFields = [
	'build_commit',
	'build_number',
	'backends',
	'model_type',
	'model_size',
	'model_n_params',
	'n_batch',
	'n_ubatch',
	'n_threads',
	'type_k',
	'type_v',
	'n_gpu_layers',
	'split_mode',
	'main_gpu',
	'no_kv_offload',
	'flash_attn',
	'devices',
	'tensor_split',
	'n_prompt',
	'n_gen',
	'n_depth'
];
export function comparable(a: BenchReport, ar: BenchRow, b: BenchReport, br: BenchRow): boolean {
	const equal = (x: unknown, y: unknown) =>
		x !== undefined && y !== undefined && JSON.stringify(x) === JSON.stringify(y);
	return (
		a.schemaVersion === 1 &&
		b.schemaVersion === 1 &&
		a.status === 'complete' &&
		b.status === 'complete' &&
		Array.isArray(a.modelFiles) &&
		a.modelFiles.length > 0 &&
		Array.isArray(a.runtimeFiles) &&
		a.runtimeFiles.length > 0 &&
		Number.isInteger(a.repetitions) &&
		(a.repetitions ?? 0) >= 3 &&
		a.repetitions === b.repetitions &&
		equal(a.modelFiles, b.modelFiles) &&
		equal(a.runtimeFiles, b.runtimeFiles) &&
		equal(a.environment, b.environment) &&
		matchFields.every((f) => ar[f] !== null && br[f] !== null && equal(ar[f], br[f]))
	);
}
export function personalComparison(
	report: BenchReport | null,
	row: BenchRow | undefined,
	history: BenchReport[]
) {
	if (!report || !row || report.status !== 'complete') return null;
	const seen = new Set<string>([report.id]);
	const peers = history
		.filter((other) => {
			if (seen.has(other.id)) return false;
			seen.add(other.id);
			return true;
		})
		.flatMap((other) =>
			other.results
				.flatMap((r) => validRows(r.rows))
				.filter((r) => comparable(report, row, other, r))
				.slice(0, 1)
		);
	if (!peers.length) return null;
	const best = Math.max(...peers.map((r) => r.avg_ts));
	return {
		count: peers.length + 1,
		rank: 1 + peers.filter((r) => r.avg_ts > row.avg_ts).length,
		change: 100 * (row.avg_ts / best - 1)
	};
}
export function placementComparison(report: BenchReport | null) {
	if (!report || report.status !== 'complete') return null;
	const single = report.results
		.find((r) => r.label === 'One device · short prompt')
		?.rows.find((r) => r.n_gen > 0 && (r.n_depth ?? 0) === 0);
	const multi = report.results
		.find((r) => r.label === 'All visible CUDA GPUs · short prompt')
		?.rows.find((r) => r.n_gen > 0 && (r.n_depth ?? 0) === 0);
	if (!single || !multi || !finitePositive(single.avg_ts) || !finitePositive(multi.avg_ts))
		return null;
	const change = 100 * (multi.avg_ts / single.avg_ts - 1);
	const a = variation(single),
		b = variation(multi);
	return {
		change,
		inconclusive: a === null || b === null || Math.abs(change) <= Math.max(3, 2 * Math.hypot(a, b))
	};
}
