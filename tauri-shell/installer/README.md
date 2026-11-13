# llama.cpp Router Windows installer

The full installer supports a fresh Windows x64 installation or an upgrade. It includes the Router app, engine manager, pinned llama.cpp b12125 CUDA 12.4 runtime, llama-bench and app-local Microsoft VC runtime files. Microsoft WebView2 is checked and downloaded by Setup if missing.

Run the Setup EXE, choose the installation folder and open Router from the finish page or shortcut. Model weights are not bundled. Add a model folder or download a supported GGUF from the Models page.

Existing configuration, models, cache and logs are preserved during upgrade and uninstall. The installer is unsigned. An NVIDIA Windows driver compatible with the bundled CUDA runtime is required for NVIDIA GPU inference.

TensorRT-LLM and vLLM are optional WSL services. TensorRT setup in the app can reuse an existing Ubuntu/Docker Desktop environment or guide prerequisite installation. Their images, model weights and Linux environments are not bundled in the Windows installer.

## Build

Build tools/ui and the optimized tauri-shell binaries first. Stage the pinned runtime at tauri-shell/dist/Llama-WebUI/portable-data/bin. Then run node tauri-shell/installer/build-installer.cjs. The staging folder must be new; --repack accepts only an unchanged manifest and matching version. Do not include runtime payloads or the resulting EXE in Git commits; publish the EXE and SHA-256 file as GitHub release assets.

## Verify

Run node tauri-shell/installer/test-installer.cjs. This installs to an isolated folder under C:/workspace, validates all payload hashes and the engine version, repeats the upgrade and verifies uninstall data preservation. /VALIDATE mode skips external registry, shortcut and WebView2-download actions; it is not a clean-machine prerequisite test.
