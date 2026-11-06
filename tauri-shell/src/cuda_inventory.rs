//! Read-only CUDA driver identity fallback. No CUDA contexts or model allocations are created.
fn format_uuid(bytes: &[u8; 16]) -> String {
    format!(
        "GPU-{}-{}-{}-{}-{}",
        hex(&bytes[..4]),
        hex(&bytes[4..6]),
        hex(&bytes[6..8]),
        hex(&bytes[8..10]),
        hex(&bytes[10..])
    )
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[cfg(not(windows))]
pub fn inventory() -> Result<serde_json::Value, String> {
    Err("CUDA driver inventory fallback is Windows-only".into())
}
#[cfg(windows)]
pub fn inventory() -> Result<serde_json::Value, String> {
    use std::ffi::{c_char, c_void, CStr};
    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
        fn FreeLibrary(module: *mut c_void) -> i32;
    }
    struct Library(*mut c_void);
    impl Drop for Library {
        fn drop(&mut self) {
            unsafe {
                FreeLibrary(self.0);
            }
        }
    }
    unsafe fn symbol(library: &Library, name: &[u8]) -> Result<*mut c_void, String> {
        let ptr = GetProcAddress(library.0, name.as_ptr());
        if ptr.is_null() {
            Err(format!(
                "CUDA driver symbol unavailable: {}",
                String::from_utf8_lossy(name)
            ))
        } else {
            Ok(ptr)
        }
    }
    let name = "nvcuda.dll\0".encode_utf16().collect::<Vec<_>>();
    // Restrict DLL loading to the Windows system directory.
    let library = Library(unsafe { LoadLibraryExW(name.as_ptr(), std::ptr::null_mut(), 0x800) });
    if library.0.is_null() {
        return Err("Windows CUDA driver is unavailable".into());
    }
    unsafe {
        let init: unsafe extern "system" fn(u32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuInit\0")?);
        let count: unsafe extern "system" fn(*mut i32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuDeviceGetCount\0")?);
        let get: unsafe extern "system" fn(*mut i32, i32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuDeviceGet\0")?);
        let get_name: unsafe extern "system" fn(*mut c_char, i32, i32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuDeviceGetName\0")?);
        let uuid: unsafe extern "system" fn(*mut u8, i32) -> i32 = std::mem::transmute(
            symbol(&library, b"cuDeviceGetUuid_v2\0")
                .or_else(|_| symbol(&library, b"cuDeviceGetUuid\0"))?,
        );
        let memory: unsafe extern "system" fn(*mut usize, i32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuDeviceTotalMem_v2\0")?);
        let bus: unsafe extern "system" fn(*mut c_char, i32, i32) -> i32 =
            std::mem::transmute(symbol(&library, b"cuDeviceGetPCIBusId\0")?);
        let check = |code: i32| {
            if code == 0 {
                Ok(())
            } else {
                Err(format!("CUDA inventory query failed ({code})"))
            }
        };
        check(init(0))?;
        let mut n = 0;
        check(count(&mut n))?;
        if !(0..=64).contains(&n) {
            return Err("Invalid CUDA device count".into());
        }
        let mut cards = Vec::new();
        for index in 0..n {
            let mut dev = 0;
            check(get(&mut dev, index))?;
            let mut label = [0i8; 256];
            let mut pci = [0i8; 64];
            let mut id = [0u8; 16];
            let mut total = 0usize;
            check(get_name(label.as_mut_ptr(), 255, dev))?;
            check(uuid(id.as_mut_ptr(), dev))?;
            check(memory(&mut total, dev))?;
            check(bus(pci.as_mut_ptr(), 63, dev))?;
            cards.push(serde_json::json!({"uuid":format_uuid(&id),"name":CStr::from_ptr(label.as_ptr()).to_string_lossy(),"total":total/(1024*1024),"free":null,"driver":"unknown (NVML unavailable)","bus":CStr::from_ptr(pci.as_ptr()).to_string_lossy(),"source":"cuda-driver"}));
        }
        Ok(serde_json::Value::Array(cards))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cuda_bytes_match_standard_gpu_uuid() {
        assert_eq!(
            format_uuid(&[
                0xd7, 0xe7, 0x40, 0xb1, 0x16, 0x60, 0x9a, 0x36, 0x63, 0xd3, 0x4c, 0x53, 0x57, 0xed,
                0x5c, 0x33
            ]),
            "GPU-d7e740b1-1660-9a36-63d3-4c5357ed5c33"
        );
    }
}
