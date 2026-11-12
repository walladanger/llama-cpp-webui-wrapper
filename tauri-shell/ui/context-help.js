/* Global, delegated help: no wrappers or changes to application controls. */
(() => {
	if (window.RouterHelp) return;
	function install() {
		const { topics = {}, aliases = {} } = window.RouterHelpCatalog || {};
		const selector =
			'button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=combobox], [role=switch], [role=checkbox], [contenteditable=true], [data-help-key], section, [role=region]';
		const host = document.createElement('div');
		host.id = 'router-help-host';
		host.setAttribute('popover', 'manual');
		const preview = document.createElement('div');
		preview.id = 'router-help-preview';
		preview.setAttribute('role', 'dialog');
		preview.setAttribute('aria-modal', 'false');
		preview.setAttribute('aria-label', 'Context help');
		preview.hidden = true;
		host.append(preview);
		const dialog = document.createElement('dialog');
		dialog.id = 'router-help-document';
		dialog.setAttribute('aria-labelledby', 'router-help-title');
		document.body.append(host, dialog);
		let active = null,
			current = null,
			previewTimer,
			leaveTimer,
			suspended = false,
			returnFocus = null,
			described = null;
        let pinned = false, manualPosition = false, gesture = null, tier = '', pointerFocus = false;
        let header, content, footer, pinButton, resizeHandle;
        const sizes = new Map();
        const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
        const bounds = () => ({ left: 12, top: 48, right: innerWidth - 12, bottom: innerHeight - 12 });
        function overlap(a, b) {
            return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        }
        function rect(x, y, width, height) { return { left:x, top:y, right:x+width, bottom:y+height }; }
        function pin(value = true) {
            pinned = value;
            preview.dataset.pinned = String(value);
            if (pinButton) { pinButton.textContent = value ? 'Unpin' : 'Keep open'; pinButton.setAttribute('aria-pressed', String(value)); }
            if (value) { clearTimeout(previewTimer); clearTimeout(leaveTimer); }
        }
        const listeners = [];
		function listen(node, type, fn, options) {
			node.addEventListener(type, fn, options);
			listeners.push(() => node.removeEventListener(type, fn, options));
		}
		function text(tag, copy, className) {
			const node = document.createElement(tag);
			node.textContent = copy;
			if (className) node.className = className;
			return node;
		}
		function plain(value) {
			const parser = new DOMParser();
			return parser.parseFromString(value || '', 'text/html').body.textContent.trim();
		}
		function label(node) {
			const explicit = node.getAttribute('data-help-title') || node.getAttribute('aria-label');
			if (explicit) return explicit;
			const labelled = (node.getAttribute('aria-labelledby') || '')
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent || '')
				.join(' ')
				.trim();
			if (labelled) return labelled;
			const labels =
				node.labels &&
				Array.from(node.labels)
					.map((el) =>
						Array.from(el.childNodes)
							.filter((n) => n.nodeType === Node.TEXT_NODE)
							.map((n) => n.textContent)
							.join(' ')
					)
					.join(' ')
					.trim();
			return (
				labels ||
				node.getAttribute('title') ||
				node.getAttribute('placeholder') ||
				(node.matches('section,[role=region]')
					? node.querySelector('h1,h2,h3')?.textContent
					: node.textContent) ||
				node.id ||
				'Control'
			);
		}
		function keyFor(node, name) {
			const own = node.dataset.helpKey;
			if (own && topics[own]) return own;
			if (node.matches('button,[role=button],a[href]') && aliases[name]) return aliases[name];
			const explicit = node.closest('[data-help-key]')?.dataset.helpKey;
			if (node.matches('button,[role=button]') && /reset.*default/i.test(name)) return 'reset';
			if (explicit && topics[explicit]) return explicit;
			if (topics[node.id]) return node.id;
			const engineField = node.id?.replace(/^(vllm|trtllm)-/, '');
			if (topics[engineField]) return engineField;
			if (aliases[name]) return aliases[name];
			const n = name.toLowerCase();
			if (/search|filter/.test(n)) return 'search';
			if (/regenerate|retry answer/.test(n)) return 'chat-regenerate';
			if (/stop.*(generat|response)/.test(n)) return 'chat-stop';
			if (/send.*message|^send$/.test(n)) return 'chat-send';
			if (/new.*(chat|conversation)/.test(n)) return 'new-chat';
			if (/copy/.test(n)) return 'copy';
			if (/delete/.test(n)) return 'delete';
			if (/export/.test(n)) return 'export';
			if (/import/.test(n)) return 'import';
			if (/attach|upload|add files/.test(n)) return 'attach';
			if (/refresh/.test(n)) return 'refresh';
			if (/mcp|tools/.test(n)) return 'mcp';
			if (/settings/.test(n)) return 'settings';
			if (/logs/.test(n)) return 'logs';
			if (/message|prompt/.test(n) && node.matches('textarea,[contenteditable=true]'))
				return 'chat-input';
			return explicit;
		}
		function resolve(node) {
			const context = node.closest('[data-help-key]');
			const name = plain(
				node.matches('button,[role=button]')
					? label(node)
					: context?.dataset.helpTitle || label(node)
			)
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 160);
			const key = keyFor(node, name);
			let known = topics[key];
            if (key === 'executable' && node.closest('[data-engine="trtllm"]')) {
                known = { ...known, values: [
                    ['/opt/llama-router/trtllm/bin/trtllm-serve', 'Filled in by automatic setup. Runs the verified NVIDIA container.'],
                    ['/home/you/venv/bin/trtllm-serve', 'For an existing manual TensorRT-LLM installation inside this distribution.']
                ] };
            }
			const action =
				node.matches('button,[role=button],a[href]') && !node.matches('[role=combobox]');
			const summary = plain(
				(!action || key === context?.dataset.helpKey ? context?.dataset.helpSummary : '') ||
					known?.summary
			);
			const input = node.matches(
				'input,textarea,select,[role=combobox],[role=switch],[role=checkbox],[contenteditable=true]'
			);
			const details = context?.dataset.helpDetails || known?.details;
			const values = known?.values?.length
				? known.values
				: (() => {
						if (!input) return [];
						if (node.type === 'password')
							return [
								[
									'Your configured credential',
									'Use the value supplied by your server; help never displays it.'
								]
							];
						let choices = [];
						try {
							choices = JSON.parse(context?.dataset.helpOptions || '[]');
						} catch {
							/* authored metadata is optional */
						}
						if (choices.length)
							return choices.map((o) => [
								o.label,
								'Choose this when it matches your intended ' + name.toLowerCase() + ' behavior.'
							]);
						if (node.matches('select'))
							return Array.from(node.options)
								.filter((o) => o.value)
								.slice(0, 4)
								.map((o) => [o.textContent, 'An available choice for this field.']);
						if (node.type === 'checkbox' || node.matches('[role=switch],[role=checkbox]'))
							return [
								['Off', 'Disable this behavior.'],
								['On', 'Enable this behavior.']
							];
						const def = context?.dataset.helpDefault;
						if (def !== undefined && def !== '')
							return [[def, 'The app’s starting value; compare against it before customizing.']];
						if (node.matches('input[type=number]'))
							return [
								[
									'Keep the working default',
									'There is no universal recommended number for this field. Follow the selected model or engine documentation.'
								]
							];
						return [
							['Keep the existing setting', 'Use a known working value before making changes.'],
							[
								'Use the format shown by the field',
								'Provide the value for your own model, server, or task.'
							]
						];
					})();
			const fallback = input
				? 'Enter the value for ' + name + '. Check the format and any limits shown by the field.'
				: 'Use ' + name + ' in the current page. Read any confirmation before applying changes.';
			return {
				key,
				title: known?.title || name,
				summary: summary || fallback,
				details: plain(details) || summary || fallback,
				values,
				expanded: known?.expanded || [],
				steps: known?.steps?.length
					? known.steps
					: input
						? [
								'Start with the current working or model-supplied default.',
								'Change one setting and use the page’s save control if present.',
								'Repeat the same test request and compare the behavior.'
							]
						: [
								'Check the selected item and page.',
								'Activate the control when you are ready.',
								'Review the resulting status or confirmation.'
							],
				troubleshooting:
					known?.troubleshooting ||
					(input
						? 'Restore the previous working value if results worsen. Engine launch settings require a service restart after saving; chat request settings apply to later requests.'
						: 'If the control is unavailable, check the page’s status message and prerequisites. Desktop-only controls require the Windows app.'),
				input,
				limits: input
					? ['min', 'max', 'step']
							.filter((k) => node.hasAttribute(k))
							.map((k) => k + ': ' + node.getAttribute(k))
							.join(' · ')
					: ''
			};
		}
		function undescribe() {
			if (!described) return;
			const ids = (described.getAttribute('aria-describedby') || '')
				.split(/\s+/)
				.filter((id) => id && id !== preview.id);
			if (ids.length) described.setAttribute('aria-describedby', ids.join(' '));
			else described.removeAttribute('aria-describedby');
			described = null;
		}
		function hide() {
			if (gesture) return;
			pinned = false; manualPosition = false; tier = "";
			clearTimeout(previewTimer);
			clearTimeout(leaveTimer);
			undescribe();
			preview.hidden = true;
			if (host.matches(':popover-open')) host.hidePopover();
			host.hidden = true;
			document.body.classList.remove('router-help-active');
			active = null;
			current = null;
		}
        function position() {
            if (!active?.isConnected || !active.getClientRects().length) { hide(); return; }
            if (preview.hidden) return;
            const b = bounds();
            const maxW = Math.max(180, b.right - b.left), maxH = Math.max(130, b.bottom - b.top);
            preview.style.width = Math.min(parseFloat(preview.style.width) || 336, maxW) + 'px';
            preview.style.height = Math.min(parseFloat(preview.style.height) || 224, maxH) + 'px';
            const pr = preview.getBoundingClientRect(), pw = pr.width, ph = pr.height;
            if (manualPosition || pinned) {
                preview.style.left = clamp(pr.left, b.left, b.right - pw) + 'px';
                preview.style.top = clamp(pr.top, b.top, b.bottom - ph) + 'px';
                return;
            }
            const source = active.getBoundingClientRect();
            if (source.bottom < b.top || source.top > b.bottom || source.right < 0 || source.left > innerWidth) { hide(); return; }
            const sourceBox = rect(source.left - 8, source.top - 8, source.width + 16, source.height + 16);
            const group = active.closest('label,[data-help-protect],form')?.getBoundingClientRect();
            // Protect controls, results, and text the user may be reading. Blank margins win.
            const obstacles = Array.from(document.querySelectorAll('main input, main button, main select, main textarea, main pre, main table, main p, main h1, main h2, [data-help-protect]'))
                .filter(el => !host.contains(el) && !dialog.contains(el) && el !== active)
                .map(el => el.getBoundingClientRect())
                .filter(r => r.width && r.height && r.bottom > b.top && r.top < b.bottom)
                .slice(0, 220);
            const gap = 18;
            const points = [
                [source.right + gap, source.top], [source.left - pw - gap, source.top],
                [b.right - pw, b.top], [b.left, b.top],
                [b.right - pw, b.bottom - ph], [b.left, b.bottom - ph],
                [source.left, source.bottom + gap], [source.left, source.top - ph - gap],
                [b.right - pw, source.top - ph / 2], [b.left, source.top - ph / 2],
                [(b.right + b.left - pw)/2, b.bottom - ph]
            ];
            let best = null;
            for (const [rawX, rawY] of points) {
                const x = clamp(rawX, b.left, b.right - pw), y = clamp(rawY, b.top, b.bottom - ph);
                const candidate = rect(x, y, pw, ph);
                const score = overlap(candidate, sourceBox) * 1000 + (group ? overlap(candidate, group) * 20 : 0)
                    + obstacles.reduce((sum, r) => sum + overlap(candidate, r), 0)
                    + Math.hypot(x - source.left, y - source.top) * 2;
                if (!best || score < best.score) best = { x, y, score };
            }
            preview.style.left = best.x + 'px'; preview.style.top = best.y + 'px';
        }
        function renderDepth() {
            if (preview.hidden || !current || !content) return;
            const r = preview.getBoundingClientRect();
            const area = r.width * r.height;
            const nextTier = area >= 235000 && r.height >= 400 ? 'full' : area >= 115000 && r.height >= 260 ? 'detail' : 'brief';
            if (nextTier === tier) return;
            const prior = content.scrollTop;
            tier = nextTier; preview.dataset.depth = tier;
            const nodes = [text('p', current.summary)];
            if (tier !== 'brief' && current.details !== current.summary) {
                nodes.push(text('h3', 'What this changes'), text('p', current.details));
            }
            if (current.values.length) {
                nodes.push(text('h3', tier === 'brief' ? 'Starting point' : 'Suggested values'));
                const list = text('ul', '');
                for (const [value, why] of current.values.slice(0, tier === 'brief' ? 1 : undefined)) {
                    const item = text('li', ''); item.append(text('strong', String(value)), text('span', ' — ' + why)); list.append(item);
                }
                nodes.push(list);
            }
            if (tier === 'full') {
                for (const part of current.expanded) nodes.push(text('h3', part.title), text('p', part.body));
                const list = text('ol', '');
                for (const step of current.steps) list.append(text('li', step));
                nodes.push(text('h3', 'How to use it'), list, text('h3', 'Troubleshooting'), text('p', current.troubleshooting));
                if (current.limits) nodes.push(text('p', 'Field limits: ' + current.limits));
            }
            content.replaceChildren(...nodes); content.scrollTop = prior;
            footer.textContent = (tier === 'brief' ? 'Brief' : tier === 'detail' ? 'More detail' : 'Full explanation') + ' · Drag corner for ' + (tier === 'full' ? 'less detail' : 'more detail') + ' · F1 full guide';
        }
        function showPreview() {
            if (!active || !current || dialog.open || (!preview.hidden && pinned)) return;
            tier = '';
            const size = sizes.get(current.key || current.title) || { width: 336, height: 224 };
            preview.style.width = size.width + 'px'; preview.style.height = size.height + 'px';
            preview.setAttribute('aria-label', current.title + ' help');
            header = text('header', '', 'router-help-panel-header');
            const grip = text('button', current.title, 'router-help-drag');
            grip.type = 'button'; grip.setAttribute('aria-label', 'Move help panel');
            grip.title = 'Drag to move. Arrow keys move; holding Shift moves faster.';
            const tools = text('div', '', 'router-help-panel-tools');
            pinButton = text('button', 'Keep open'); pinButton.type = 'button'; pinButton.setAttribute('aria-pressed', 'false');
            pinButton.addEventListener('click', () => { pin(!pinned); if (!pinned) manualPosition = false; });
            const guide = text('button', 'Guide'); guide.type = 'button'; guide.addEventListener('click', openHelp);
            const close = text('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close help preview'); close.addEventListener('click', hide);
            tools.append(pinButton, guide, close); header.append(grip, tools);
            content = text('div', '', 'router-help-panel-content'); content.tabIndex = 0;
            content.setAttribute('aria-label', 'Help explanation');
            footer = text('footer', '', 'router-help-panel-footer'); footer.setAttribute('aria-live', 'polite');
            resizeHandle = text('button', '◢', 'router-help-resize'); resizeHandle.type = 'button';
            resizeHandle.setAttribute('aria-label', 'Resize help to change explanation detail');
            resizeHandle.title = 'Drag to reveal more detail. Arrow keys resize; font size stays the same.';
            preview.replaceChildren(header, content, footer, resizeHandle);
            preview.hidden = false; pin(false);
            function begin(event, mode) {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation(); pin(); manualPosition = true;
                const r = preview.getBoundingClientRect();
                gesture = { id:event.pointerId, mode, x:event.clientX, y:event.clientY, left:r.left, top:r.top, width:r.width, height:r.height, target:event.currentTarget };
                event.currentTarget.setPointerCapture(event.pointerId);
            }
            grip.addEventListener('pointerdown', e => begin(e, 'move'));
            resizeHandle.addEventListener('pointerdown', e => begin(e, 'resize'));
            function keyboard(event, mode) {
                if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation(); pin(); manualPosition = true;
                const r = preview.getBoundingClientRect(), amount = event.shiftKey ? 40 : 10;
                const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
                const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
                if (mode === 'move') { preview.style.left = r.left + dx + 'px'; preview.style.top = r.top + dy + 'px'; }
                else { resize(r.width + dx, r.height + dy); }
                position(); renderDepth();
            }
            grip.addEventListener('keydown', e => keyboard(e,'move'));
            resizeHandle.addEventListener('keydown', e => keyboard(e,'resize'));
            undescribe(); described = active;
            active.setAttribute('aria-describedby', [active.getAttribute('aria-describedby'), preview.id].filter(Boolean).join(' '));
            position(); renderDepth();
        }
        function resize(width, height) {
            const b = bounds(), r = preview.getBoundingClientRect();
            preview.style.width = clamp(width, Math.min(280, b.right-b.left), b.right - r.left) + 'px';
            preview.style.height = clamp(height, Math.min(190, b.bottom-b.top), b.bottom - r.top) + 'px';
            sizes.set(current.key || current.title, { width:parseFloat(preview.style.width), height:parseFloat(preview.style.height) });
        }
		function show(node) {
			clearTimeout(leaveTimer);
			if (suspended || dialog.open || pinned || gesture || node === active) return;
			hide();
			active = node;
			current = resolve(node);
			const surface = node.closest('[role=dialog],[role=alertdialog],dialog') || document.body;
			if (host.parentNode !== surface) surface.append(host);
			host.hidden = false;
			document.body.classList.add('router-help-active');
			if (!host.matches(':popover-open')) host.showPopover();
			position();
			previewTimer = setTimeout(showPreview, 700);
		}
		function candidate(target) {
			if (
				!(target instanceof Element) ||
				target.closest('#router-help-host,#router-help-document,[data-help-ignore]')
			)
				return null;
			const node = target.closest(selector);
			if (!node || node.matches('a[href^="#router-help-"]')) return null;
            // Section metadata supplies context to controls; reading a section is not a help request.
            if (node.matches('section,[role=region]') && !node.hasAttribute('data-help-trigger')) return null;
			if (
				node.matches('section,[role=region]') &&
				!node.querySelector('h1,h2,h3') &&
				!node.dataset.helpKey
			)
				return null;
			return node;
		}
		function section(article, id, title) {
			const part = text('section', '');
			part.id = id;
			part.append(text('h2', title));
			article.append(part);
			return part;
		}
		function openHelp() {
			if (!current || !active) return;
			const info = current;
			returnFocus = active;
			suspended = true;
			const surface = active.closest('[role=dialog],[role=alertdialog],dialog') || document.body;
			if (dialog.parentNode !== surface) surface.append(dialog);
			hide();
			const header = text('header', '');
			const heading = text('div', '');
			heading.append(text('small', 'LLAMA.CPP ROUTER / HELP'));
			const h = text('h1', info.title);
			h.id = 'router-help-title';
			heading.append(h);
			const close = text('button', 'Close ×');
			close.type = 'button';
			close.className = 'router-help-close';
			close.setAttribute('aria-label', 'Close help');
			close.addEventListener('click', () => closeHelp());
			header.append(heading, close);
			const layout = text('div', '', 'router-help-doc-layout'),
				nav = text('nav', ''),
				article = text('article', '');
			nav.setAttribute('aria-label', 'On this page');
			const items = [
				['overview', 'Overview'],
				['values', 'Suggested values'],
				['use', 'How to use it'],
				['troubleshooting', 'Troubleshooting']
			];
			for (const [id, title] of items) {
				if (id === 'values' && !info.values.length) continue;
				const link = text('a', title);
				link.href = '#router-help-' + id;
				link.addEventListener('click', (e) => {
					e.preventDefault();
					dialog
						.querySelector('#router-help-' + id)
						?.scrollIntoView({ block: 'start', behavior: 'instant' });
				});
				nav.append(link);
			}
			nav.append(
				text(
					'p',
					'Help only explains this control. Suggested values are starting points for comparison and are never applied automatically.'
				)
			);
			const overview = section(article, 'router-help-overview', 'What this does');
			overview.append(text('p', info.summary), text('p', info.details));
            for (const part of info.expanded) overview.append(text('h2', part.title), text('p', part.body));
			if (info.values.length) {
				const values = section(article, 'router-help-values', 'Suggested starting values');
				values.append(
					text(
						'p',
						'Choose a starting point for your task. Prefer your model author’s settings when a recipe is supplied.'
					)
				);
				const table = text('table', ''),
					head = text('thead', ''),
					tr = text('tr', '');
				tr.append(text('th', 'Value or choice'), text('th', 'When and why'));
				head.append(tr);
				const body = text('tbody', '');
				for (const [value, why] of info.values) {
					const row = text('tr', '');
					row.append(text('td', String(value)), text('td', why));
					body.append(row);
				}
				table.append(head, body);
				values.append(table);
				if (info.limits) values.append(text('p', 'Field limits: ' + info.limits));
			}
			const use = section(article, 'router-help-use', 'How to use it');
			const steps = text('ol', '');
			for (const step of info.steps) steps.append(text('li', step));
			use.append(steps);
			const troubleshooting = section(
				article,
				'router-help-troubleshooting',
				'What to check if something goes wrong'
			);
			troubleshooting.append(text('p', info.troubleshooting));
			const related = section(article, 'router-help-related', 'Make a useful comparison');
			related.append(
				text(
					'p',
					info.input
						? 'Record the original value, use the same model and test prompt, and change one setting at a time. Compare answer quality, latency, and memory use before keeping a change.'
						: 'Check the selected model, service, or file before acting. Use status messages to verify the result and the Logs page for errors.'
				)
			);
			layout.append(nav, article);
			dialog.replaceChildren(header, layout);
			returnFocus.focus({ preventScroll: true });
			dialog.showModal();
			close.focus();
		}
		function restoreFocus() {
			suspended = false;
			const target = returnFocus;
			returnFocus = null;
			const focused = candidate(document.activeElement);
			if (focused && focused !== target) {
				show(focused);
				showPreview();
				return;
			}
			if (target?.isConnected) {
				target.focus({ preventScroll: true });
				show(target);
				showPreview();
			}
		}
		function closeHelp() {
			dialog.close();
			restoreFocus();
		}
		listen(dialog, 'close', () => {
			if (returnFocus) restoreFocus();
		});
		listen(dialog, 'cancel', (event) => {
			event.preventDefault();
			closeHelp();
		});
		listen(dialog, 'click', (event) => {
			if (event.target === dialog) {
				const r = dialog.getBoundingClientRect();
				if (
					event.clientX < r.left ||
					event.clientX > r.right ||
					event.clientY < r.top ||
					event.clientY > r.bottom
				)
					closeHelp();
			}
		});
		listen(host, 'pointerenter', () => clearTimeout(leaveTimer));
		listen(host, 'pointerleave', () => {
			leaveTimer = setTimeout(() => {
				if (!pinned && !gesture && !active?.matches(':hover') && !host.matches(':hover')) hide();
			}, 250);
		});
		listen(
			document,
			'pointerover',
			(event) => {
				const node = candidate(event.target);
				if (node) show(node);
				else if (!(event.target instanceof Element) || !event.target.closest('#router-help-host'))
					leaveTimer = setTimeout(() => {
						if (!pinned && !gesture && !active?.matches(':hover') && !host.matches(':hover')) hide();
					}, 250);
			},
			true
		);
		listen(
			document,
			'pointerout',
			(event) => {
				if (
					active?.contains(event.target) &&
					!active.contains(event.relatedTarget) &&
					!host.contains(event.relatedTarget)
				) {
					clearTimeout(leaveTimer);
					leaveTimer = setTimeout(() => {
						if (!pinned && !gesture && !active?.matches(':hover') && !host.matches(':hover')) hide();
					}, 250);
				}
			},
			true
		);
		listen(
			document,
			'focusin',
			(event) => {
				const node = candidate(event.target);
				if (node && !pointerFocus) {
					show(node);
					showPreview();
				} else if (!pinned && !host.contains(event.target) && !dialog.open) hide();
			},
			true
		);
		listen(
			document,
			'keydown',
			(event) => {
                pointerFocus = false;
				if (dialog.open) {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopImmediatePropagation();
						closeHelp();
					}
					return;
				}
				if (event.key === 'F1' && (active || candidate(document.activeElement))) {
                    const focused = candidate(document.activeElement);
                    if (!active && focused) { pin(false); show(focused); }
					event.preventDefault();
					event.stopPropagation();
					openHelp();
				} else if (event.key === 'Escape') {
					hide();
				} else if (!host.contains(event.target) && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) && !['Tab','Shift','Control','Alt','Meta'].includes(event.key)) {
                    if (!pinned) hide();
                }
                if (event.key === 'Tab') pointerFocus = false;
			},
			true
		);
		listen(
			document,
			'pointerdown',
			(event) => {
				pointerFocus = true;
                if (!pinned && !host.contains(event.target) && !dialog.open) hide();
			},
			true
		);
		listen(document, 'pointermove', event => {
            if (!gesture || gesture.id !== event.pointerId) return;
            const g=gesture, dx=event.clientX-g.x, dy=event.clientY-g.y;
            if (g.mode === 'move') { preview.style.left=g.left+dx+'px'; preview.style.top=g.top+dy+'px'; }
            else resize(g.width+dx,g.height+dy);
            position(); renderDepth();
        }, true);
        function endGesture(event) {
            if (!gesture || gesture.id !== event.pointerId) return;
            const target=gesture.target; gesture=null;
            if (!active?.isConnected) hide();
            if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
        }
        listen(document, 'pointerup', endGesture, true);
        listen(document, 'pointercancel', endGesture, true);
        listen(document, 'lostpointercapture', endGesture, true);
        listen(document, 'scroll', event => { if (host.contains(event.target) || dialog.contains(event.target)) return; if (!pinned) hide(); }, true);
        listen(window, 'resize', () => { position(); renderDepth(); });
        listen(window, 'blur', () => { gesture=null; if (!pinned) hide(); });
		const observer = new MutationObserver(() => {
			if (active && !active.isConnected) hide();
		});
		observer.observe(document.body, { childList: true, subtree: true });
		hide();
		window.RouterHelp = {
			destroy() {
				gesture=null; hide();
				observer.disconnect();
				for (const off of listeners) off();
				returnFocus = null;
				if (dialog.open) dialog.close();
				host.remove();
				dialog.remove();
				delete window.RouterHelp;
			},
			resolve
		};
	}
	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', install, { once: true });
	else install();
})();
