# llama.cpp Router 0.1.3 - Full Windows Installer

Download **LlamaCpp-Router-0.1.3-Windows-x64-Setup.exe** from the release assets, then run Setup. No previous Router installation is needed. For an upgrade, keep the existing installation folder; your models, settings, cache and logs are preserved.

## Included

- Windows x64 desktop app, current model browser/loading controls and engine manager.
- Pinned llama.cpp b12125 / 7d516e25e with CUDA 12.4 and llama-bench.
- App-local Microsoft VC runtime files, shortcuts and an uninstaller.
- WebView2 detection and bootstrap when the runtime is missing.
- Guided TensorRT-LLM setup, existing WSL/Docker Desktop detection, benchmark interpretation/history and movable, resizable contextual help.

This is the full installer, approximately 665 MiB, rather than the small updater. Model weights, the NVIDIA driver, and optional WSL/TensorRT/vLLM environments/images are separate downloads. TensorRT model serving remains unverified; installed prerequisites do not establish model compatibility.

## Validation

The built installer passed isolated fresh-install, per-file hash, bundled runtime-version, repeated upgrade and uninstall-preservation checks for all 151 payload files. The packaged native binaries match the final optimized Windows build. The Node wrapper suite passed 145 tests, native suites passed 26 tests (2 opt-in live tests skipped), and Svelte diagnostics reported zero errors and warnings.

Installer validation used silent /VALIDATE mode, which shares payload/config handling but skips registry, shortcuts and clean-machine WebView2 download side effects. Those external actions and clean-machine prerequisite bootstrap are not claimed tested by this release check. The installer is unsigned; use the accompanying SHA-256 file to verify the download.

Full installers are now included in the Windows packaging workflow alongside the portable ZIP. The source is published on release/router-0.1.3-full-installer and this release tag; existing development branches remain separate.

AI-assisted implementation, packaging and validation: Codex, at the repository owner's request.
