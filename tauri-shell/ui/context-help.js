/* Global, delegated help: no wrappers or changes to application controls. */
(() => {
	if (window.RouterHelp) return;

	function install() {
		const { aliases = {}, topics = {} } = window.RouterHelpCatalog || {};
		const selector =
			'button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=combobox], [role=switch], [role=checkbox], [contenteditable=true], [data-help-key], section, [role=region]';
		const host = document.createElement('div');

		host.id = 'router-help-host';
		host.setAttribute('popover', 'manual');
		const trigger = document.createElement('button');

		trigger.id = 'router-help-trigger';
		trigger.type = 'button';
		trigger.textContent = '?';
		trigger.setAttribute('aria-haspopup', 'dialog');
		trigger.setAttribute('aria-controls', 'router-help-document');
		const preview = document.createElement('div');

		preview.id = 'router-help-preview';
		preview.setAttribute('role', 'tooltip');
		preview.hidden = true;
		host.append(trigger, preview);
		const dialog = document.createElement('dialog');

		dialog.id = 'router-help-document';
		dialog.setAttribute('aria-labelledby', 'router-help-title');
		document.body.append(host, dialog);
		let active = null,
			current = null,
			described = null,
			leaveTimer,
			previewTimer,
			returnFocus = null,
			suspended = false;

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
			const known = topics[key];
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
				details: plain(details) || summary || fallback,
				input,
				key,
				limits: input
					? ['min', 'max', 'step']
							.filter((k) => node.hasAttribute(k))
							.map((k) => k + ': ' + node.getAttribute(k))
							.join(' · ')
					: '',
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
				summary: summary || fallback,
				title: known?.title || name,
				troubleshooting:
					known?.troubleshooting ||
					(input
						? 'Restore the previous working value if results worsen. Engine launch settings require a service restart after saving; chat request settings apply to later requests.'
						: 'If the control is unavailable, check the page’s status message and prerequisites. Desktop-only controls require the Windows app.'),
				values
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
			if (!active?.isConnected || !active.getClientRects().length) {
				hide();

				return;
			}

			const h = innerHeight,
				r = active.getBoundingClientRect(),
				w = innerWidth;

			if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) {
				hide();

				return;
			}

			trigger.style.left = Math.max(4, Math.min(w - 32, r.right - 14)) + 'px';
			trigger.style.top = Math.max(4, Math.min(h - 32, r.top - 12)) + 'px';

			if (!preview.hidden) {
				const pw = Math.min(370, w - 24);

				preview.style.width = pw + 'px';
				preview.style.left = Math.max(12, Math.min(w - pw - 12, r.left)) + 'px';
				preview.style.top = '0px';
				const ph = preview.getBoundingClientRect().height;

				preview.style.top =
					Math.max(
						8,
						Math.min(h - ph - 8, r.bottom + 10 + ph < h ? r.bottom + 10 : r.top - ph - 10)
					) + 'px';
			}
		}

		function showPreview() {
			if (!active || !current || dialog.open) return;

			preview.replaceChildren(text('strong', current.title), text('p', current.summary));

			if (current.values.length) {
				const list = text('ul', '');

				for (const [value, why] of current.values.slice(0, 2))
					list.append(text('li', value + ' — ' + why));
				preview.append(list);
			}

			preview.append(text('small', 'Click ? for the full guide · F1 opens help'));
			preview.hidden = false;
			undescribe();
			described = active;
			active.setAttribute(
				'aria-describedby',
				[active.getAttribute('aria-describedby'), preview.id].filter(Boolean).join(' ')
			);
			position();
		}

		function show(node) {
			clearTimeout(leaveTimer);

			if (suspended || dialog.open || node === active) return;

			hide();
			active = node;
			current = resolve(node);
			const surface = node.closest('[role=dialog],[role=alertdialog],dialog') || document.body;

			if (host.parentNode !== surface) surface.append(host);

			host.hidden = false;
			document.body.classList.add('router-help-active');
			trigger.setAttribute('aria-label', 'Help: ' + current.title);

			if (!host.matches(':popover-open')) host.showPopover();

			position();
			previewTimer = setTimeout(showPreview, 500);
		}

		function candidate(target) {
			if (
				!(target instanceof Element) ||
				target.closest('#router-help-host,#router-help-document,[data-help-ignore]')
			)
				return null;

			const node = target.closest(selector);

			if (!node || node.matches('a[href^="#router-help-"]')) return null;

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
			const article = text('article', ''),
				layout = text('div', '', 'router-help-doc-layout'),
				nav = text('nav', '');

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
						?.scrollIntoView({ behavior: 'instant', block: 'start' });
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

			if (info.values.length) {
				const values = section(article, 'router-help-values', 'Suggested starting values');

				values.append(
					text(
						'p',
						'Choose a starting point for your task. Prefer your model author’s settings when a recipe is supplied.'
					)
				);
				const head = text('thead', ''),
					table = text('table', ''),
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
		listen(trigger, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			openHelp();
		});
		listen(host, 'pointerenter', () => clearTimeout(leaveTimer));
		listen(host, 'pointerleave', () => {
			leaveTimer = setTimeout(() => {
				if (!active?.matches(':hover') && !host.matches(':hover')) hide();
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
						if (!active?.matches(':hover') && !host.matches(':hover')) hide();
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
						if (!active?.matches(':hover') && !host.matches(':hover')) hide();
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

				if (node) {
					show(node);
					showPreview();
				} else if (!host.contains(event.target) && !dialog.open) hide();
			},
			true
		);
		listen(
			document,
			'keydown',
			(event) => {
				if (dialog.open) {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopImmediatePropagation();
						closeHelp();
					}

					return;
				}

				if (event.key === 'F1' && active) {
					event.preventDefault();
					event.stopPropagation();
					openHelp();
				} else if (event.key === 'Escape') {
					hide();
				}
			},
			true
		);
		listen(
			document,
			'pointerdown',
			(event) => {
				if (!host.contains(event.target) && !dialog.open) hide();
			},
			true
		);
		listen(document, 'scroll', hide, true);
		listen(window, 'resize', hide);
		listen(window, 'blur', hide);
		const observer = new MutationObserver(() => {
			if (active && !active.isConnected) hide();
		});

		observer.observe(document.body, { childList: true, subtree: true });
		hide();
		window.RouterHelp = {
			destroy() {
				hide();
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
