import { FuseVersion, FuseV1Options } from '@electron/fuses'

/**
 * Khoá fuse ngay trước bước ký số. `strictlyRequireAllFuses` biến mỗi lần Electron thêm fuse
 * thành một quyết định review bắt buộc thay vì âm thầm nhận giá trị mặc định mới.
 */
export default async function configureElectronFuses(context) {
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    // Electron khuyến nghị giữ bật trừ khi host cấm signal handler hoặc workload Wasm bị crash.
    [FuseV1Options.WasmTrapHandlers]: true,
  })
}
