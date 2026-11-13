import { describe, expect, it } from 'vitest';
import {
	parseOutput,
	speedTier,
	comparable,
	personalComparison,
	placementComparison,
	variation,
	type BenchReport,
	type BenchRow
} from '../../src/lib/services/benchmark-analysis';

const table = (
	model: string,
	prompt: number,
	generation: number
) => `| model | size | params | backend | ngl | test | t/s |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| ${model} | 16.68 GiB | 27.32 B | CUDA | -1 | pp512 | ${prompt} ± 11.85 |
| ${model} | 16.68 GiB | 27.32 B | CUDA | -1 | tg128 | ${generation} ± 0.08 |
build: 7d516e25e (12125)
ggml_cuda_init: found 2 CUDA devices`;
const row: BenchRow = {
	model_type: 'qwen35 27B Q4_K - Medium',
	avg_ts: 42.05,
	stddev_ts: 0.08,
	n_prompt: 0,
	n_gen: 128,
	n_depth: 0,
	build_commit: '7d516e25e',
	build_number: 12125,
	backends: 'CUDA',
	model_size: 17910000000,
	model_n_params: 27320000000,
	n_batch: 2048,
	n_ubatch: 512,
	n_threads: 8,
	type_k: 'f16',
	type_v: 'f16',
	n_gpu_layers: -1,
	split_mode: 'none',
	main_gpu: 0,
	no_kv_offload: false,
	flash_attn: -1,
	devices: 'CUDA0',
	tensor_split: '0.00'
};
const report = (id: string): BenchReport => ({
	schemaVersion: 1,
	id,
	createdAt: 1,
	model: 'm.gguf',
	mode: 'quick',
	status: 'complete',
	error: null,
	modelFiles: [{ sha256: 'model' }],
	runtimeFiles: [{ sha256: 'runtime' }],
	environment: { fingerprint: 'same' },
	repetitions: 5,
	results: [{ label: 'One device · short prompt', rows: [{ ...row }] }]
});

describe('benchmark explanations', () => {
	it('explains both user examples without confusing prompt and generation throughput', () => {
		const large = parseOutput(table(row.model_type, 1533.64, 42.05));
		const small = parseOutput(table('qwen3 4B Q4_K - Medium', 8497.25, 211.52));
		expect(large).toHaveLength(2);
		expect(large[1].n_gen).toBe(128);
		expect(128 / large[1].avg_ts).toBeCloseTo(3.044, 2);
		expect(speedTier(large[1].avg_ts).title).toBe('Fluid output');
		expect(speedTier(small[1].avg_ts).title).toBe('Very fast output');
	});
	it('rejects invalid speeds, malformed JSON and combined tests', () => {
		expect(parseOutput(table('m', 0, 0))).toHaveLength(0);
		expect(() => parseOutput('{broken')).toThrow('invalid');
		expect(
			parseOutput(
				JSON.stringify([
					{ ...row, avg_ts: -1 },
					{ ...row, n_prompt: 512 }
				])
			)
		).toEqual([]);
		expect(variation({ ...row, stddev_ts: undefined })).toBeNull();
	});
	it('accepts JSON reports but refuses to rank incomplete metadata', () => {
		expect(parseOutput(JSON.stringify(report('a')))).toHaveLength(1);
		expect(comparable(report('a'), row, report('b'), { ...row })).toBe(true);
		const pasted = parseOutput(table('m', 100, 20))[1];
		expect(comparable(report('a'), pasted, report('b'), pasted)).toBe(false);
	});
	it('keeps different models, runtimes, contexts and failed runs out of rankings', () => {
		const a = report('a'),
			b = report('b');
		for (const change of [
			{ model_type: 'other' },
			{ n_depth: 4096 },
			{ build_commit: 'other' },
			{ type_k: 'q8_0' },
			{ devices: 'CUDA1' }
		])
			expect(comparable(a, row, b, { ...row, ...change })).toBe(false);
		expect(comparable(a, row, { ...b, status: 'failed' }, row)).toBe(false);
		expect(comparable(a, row, { ...b, modelFiles: [{ sha256: 'other' }] }, row)).toBe(false);
		expect(comparable(a, row, { ...b, environment: { fingerprint: 'changed' } }, row)).toBe(false);
	});
	it('deduplicates saved runs and uses comparable prior results only', () => {
		const a = report('a'),
			b = report('b');
		b.results[0].rows[0].avg_ts = 40;
		const comparison = personalComparison(a, row, [a, b, b]);
		expect(comparison?.count).toBe(2);
		expect(comparison?.rank).toBe(1);
		expect(comparison?.change).toBeCloseTo(5.125);
	});
	it('does not turn a small noisy GPU difference into tuning advice', () => {
		const a = report('a');
		a.results.push({
			label: 'All visible CUDA GPUs · short prompt',
			rows: [{ ...row, avg_ts: 42.2 }]
		});
		expect(placementComparison(a)?.inconclusive).toBe(true);
		a.results[1].rows[0].avg_ts = 30;
		expect(placementComparison(a)?.inconclusive).toBe(false);
		expect(placementComparison(a)?.change).toBeLessThan(0);
	});
});
