#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    init_x11_threads();
    openpet_lib::run();
}

#[cfg(target_os = "linux")]
#[link(name = "X11")]
unsafe extern "C" {
    fn XInitThreads() -> std::os::raw::c_int;
}

#[cfg(target_os = "linux")]
fn init_x11_threads() {
    // Tauri's Linux webview stack can touch Xlib from multiple threads under
    // WebDriver/xvfb. Xlib requires XInitThreads to run before any other Xlib
    // call, so do it at the process entrypoint before GTK/Tauri initialization.
    unsafe {
        XInitThreads();
    }
}

#[cfg(not(target_os = "linux"))]
fn init_x11_threads() {}
