/** Public Hub discovery. File bytes come from the repository, never parameter estimates. */
export type HubFile = { rfilename: string; size?: number; lfs?: { size?: number } };
export type HubVariant = {
	name: string;
	quant: string | null;
	bytes: number | null;
	parts: number;
	complete: boolean;
};
export type HubModel = {
	id: string;
	downloads?: number;
	likes?: number;
	lastModified?: string;
	gated?: boolean | string;
	variants?: HubVariant[];
	detailError?: string;
};
export type HubSort = 'downloads' | 'likes' | 'lastModified';
const API = 'https://huggingface.co/api/models';

export function quantization(name: string): string | null {
	// Only inspect the filename: a parent folder may advertise a different quant.
	const stem = name
		.split('/')
		.at(-1)!
		.replace(/\.gguf$/i, '')
		.replace(/-\d{5}-of-\d{5}$/i, '');
	return (
		stem
			.match(
				/(?:^|[._-])((?:UD-)?(?:IQ\d[A-Z0-9_]*|Q\d[A-Z0-9_]*|BF16|F16|F32|FP16|FP32|MXFP4|NVFP4|TQ\d[A-Z0-9_]*))$/i
			)?.[1]
			.toUpperCase() ?? null
	);
}

export function ggufVariants(files: HubFile[]): HubVariant[] {
	const groups = new Map<string, { files: HubFile[]; total: number; indices: Set<number> }>();
	for (const file of files) {
		if (!/\.gguf$/i.test(file.rfilename) || /(?:^|[/._-])mmproj(?:[._-]|$)/i.test(file.rfilename))
			continue;
		const split = file.rfilename.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
		const name = split ? `${split[1]}.gguf` : file.rfilename;
		const group = groups.get(name) ?? {
			files: [],
			total: split ? Number(split[3]) : 1,
			indices: new Set<number>()
		};
		group.files.push(file);
		group.indices.add(split ? Number(split[2]) : 1);
		groups.set(name, group);
	}
	return [...groups]
		.map(([name, group]) => {
			const complete =
				group.files.length === group.total &&
				Array.from({ length: group.total }, (_, i) => i + 1).every((i) => group.indices.has(i));
			const sizes = group.files.map((file) => file.size ?? file.lfs?.size);
			const known =
				complete &&
				sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size >= 0);
			return {
				name,
				quant: quantization(name),
				bytes: known ? sizes.reduce<number>((sum, size) => sum + size!, 0) : null,
				parts: group.total,
				complete
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function matchingVariants(model: HubModel, quant: string, maxGiB: string): HubVariant[] {
	const limit = maxGiB ? Number(maxGiB) * 1024 ** 3 : null;
	return (model.variants ?? []).filter(
		(variant) =>
			(!quant || variant.quant === quant) &&
			(limit === null || (variant.bytes !== null && variant.bytes <= limit))
	);
}

export function sizeLabel(bytes: number | null | undefined): string {
	if (bytes == null) return 'Size unknown';
	return bytes < 1024 ** 3
		? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
		: `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function sizeSummary(variants: HubVariant[]): string {
	const sizes = variants.flatMap((variant) => (variant.bytes === null ? [] : [variant.bytes]));
	if (!sizes.length) return 'Size unknown';
	const min = Math.min(...sizes),
		max = Math.max(...sizes);
	const range = min === max ? sizeLabel(min) : `${sizeLabel(min)} – ${sizeLabel(max)}`;
	return `${range}${sizes.length < variants.length ? ' · some sizes unknown' : ''}`;
}

export function hubSearchUrl(
	query: string,
	author: string,
	sort: HubSort,
	openOnly: boolean
): string {
	const url = new URL(API);
	url.searchParams.set('filter', 'gguf');
	if (query.trim()) url.searchParams.set('search', query.trim());
	if (author.trim()) url.searchParams.set('author', author.trim());
	if (openOnly) url.searchParams.set('gated', 'false');
	url.searchParams.set('sort', sort);
	url.searchParams.set('direction', '-1');
	url.searchParams.set('limit', '20');
	for (const field of ['downloads', 'likes', 'lastModified', 'gated'])
		url.searchParams.append('expand[]', field);
	return url.href;
}

/** Follow only Hub model-list pagination links. */
export function nextHubPage(link: string | null): string | null {
	const next = link?.match(/<([^>]+)>;\s*rel="next"/i)?.[1];
	if (!next) return null;
	try {
		const url = new URL(next);
		return url.origin === 'https://huggingface.co' && url.pathname === '/api/models'
			? url.href
			: null;
	} catch {
		return null;
	}
}

export async function hubJson(url: string, signal: AbortSignal): Promise<Response> {
	const response = await fetch(url, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
	});
	if (!response.ok)
		throw new Error(
			response.status === 429
				? 'Hub rate limit reached. Wait a moment, then retry.'
				: `Hugging Face request failed (${response.status}).`
		);
	return response;
}

export async function loadHubVariants(id: string, signal: AbortSignal): Promise<HubVariant[]> {
	const path = id.split('/').map(encodeURIComponent).join('/');
	const response = await hubJson(`${API}/${path}?blobs=true`, signal);
	const data = await response.json();
	if (!Array.isArray(data.siblings)) throw new Error('File metadata is unavailable.');
	return ggufVariants(data.siblings.filter((file: HubFile) => typeof file.rfilename === 'string'));
}
