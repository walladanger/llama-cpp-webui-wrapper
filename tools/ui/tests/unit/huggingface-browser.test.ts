import { describe, expect, it, vi, afterEach } from 'vitest';
import {
	ggufVariants,
	hubSearchUrl,
	matchingVariants,
	nextHubPage,
	quantization,
	sizeSummary,
	loadHubVariants,
	hubJson
} from '../../src/lib/services/huggingface-browser';

afterEach(() => vi.unstubAllGlobals());

describe('Hub GGUF metadata', () => {
	it('parses filename quants including dynamic and floating-point formats', () => {
		for (const quant of ['Q4_K_M', 'IQ2_XXS', 'UD-Q4_K_XL', 'BF16', 'F16', 'MXFP4', 'TQ1_0']) {
			expect(quantization(`folder/Qwen3.5-9B-${quant}.gguf`)).toBe(quant);
		}
		expect(quantization('Q4_K_M/model.gguf')).toBeNull();
		expect(quantization('Qwen-Q8_0-00001-of-00002.gguf')).toBe('Q8_0');
	});
	it('sums complete shards and excludes projection and non-GGUF files', () => {
		const variants = ggufVariants([
			{ rfilename: 'Qwen-Q4_K_M-00001-of-00002.gguf', size: 4e9 },
			{ rfilename: 'Qwen-Q4_K_M-00002-of-00002.gguf', lfs: { size: 3e9 } },
			{ rfilename: 'Qwen-Q8_0.gguf', size: 12e9 },
			{ rfilename: 'mmproj-F16.gguf', size: 1e9 },
			{ rfilename: 'config.json', size: 10 }
		]);
		expect(variants).toHaveLength(2);
		expect(variants[0]).toMatchObject({ quant: 'Q4_K_M', bytes: 7e9, parts: 2, complete: true });
	});
	it('does not understate missing shards or missing metadata as zero bytes', () => {
		const variants = ggufVariants([
			{ rfilename: 'model-Q4_K_M-00001-of-00003.gguf', size: 2e9 },
			{ rfilename: 'model-Q8_0.gguf' }
		]);
		expect(variants.every((variant) => variant.bytes === null)).toBe(true);
		expect(variants[0].complete).toBe(false);
		expect(sizeSummary(variants)).toBe('Size unknown');
		expect(matchingVariants({ id: 'org/model', variants }, '', '48')).toEqual([]);
	});
	it('requires quant and size to match the same file variant', () => {
		const variants = ggufVariants([
			{ rfilename: 'model-Q4_K_M.gguf', size: 4 * 1024 ** 3 },
			{ rfilename: 'model-Q8_0.gguf', size: 8 * 1024 ** 3 }
		]);
		expect(matchingVariants({ id: 'org/model', variants }, 'Q8_0', '4')).toEqual([]);
		expect(matchingVariants({ id: 'org/model', variants }, 'Q4_K_M', '4')).toHaveLength(1);
		expect(sizeSummary(variants)).toBe('4.00 GiB – 8.00 GiB');
	});
	it('distinguishes a partially known size range', () => {
		const variants = ggufVariants([
			{ rfilename: 'a-Q4_0.gguf', size: 1024 ** 3 },
			{ rfilename: 'a-F16.gguf' }
		]);
		expect(sizeSummary(variants)).toBe('1.00 GiB · some sizes unknown');
	});
});

describe('Hub discovery requests', () => {
	it('supports browsing without a query, publisher filtering and server sorting', () => {
		const url = new URL(hubSearchUrl('', ' ggml-org ', 'likes', true));
		expect(url.searchParams.has('search')).toBe(false);
		expect(url.searchParams.get('author')).toBe('ggml-org');
		expect(url.searchParams.get('sort')).toBe('likes');
		expect(url.searchParams.get('gated')).toBe('false');
		expect(url.searchParams.get('filter')).toBe('gguf');
		expect(url.searchParams.get('limit')).toBe('20');
	});
	it('accepts only Hub model-list pagination links', () => {
		expect(nextHubPage('<https://huggingface.co/api/models?cursor=abc>; rel="next"')).toContain(
			'cursor=abc'
		);
		expect(nextHubPage('<https://example.org/api/models>; rel="next"')).toBeNull();
		expect(nextHubPage(null)).toBeNull();
	});
	it('requests blob metadata for real file sizes', async () => {
		const mock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 42 }] }))
			);
		vi.stubGlobal('fetch', mock);
		const variants = await loadHubVariants('org/model', new AbortController().signal);
		expect(mock.mock.calls[0][0]).toBe('https://huggingface.co/api/models/org/model?blobs=true');
		expect(variants[0].bytes).toBe(42);
	});
	it('reports rate limits without presenting empty results as success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
		await expect(
			hubJson('https://huggingface.co/api/models', new AbortController().signal)
		).rejects.toThrow('rate limit');
	});
});
