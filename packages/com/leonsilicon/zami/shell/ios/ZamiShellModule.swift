import ExpoModulesCore

/// Serves Zam's web app (the app bundle's `zami-web/`) to the app's WebView at
/// zami://localhost: see ZamiWebApp.
public class ZamiShellModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZamiShell")

    OnCreate {
      ZamiWebApp.shared.install()
    }

    Function("webAppURL") { () -> String? in
      ZamiWebApp.shared.root == nil ? nil : "\(ZamiWebApp.scheme)://\(ZamiWebApp.host)/"
    }

    Function("setStartScript") { (script: String) in
      ZamiWebApp.shared.install()
      ZamiWebApp.shared.startScript = script
    }
  }
}
