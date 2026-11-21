package com.leonsilicon.zami.shell

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Serves Zam's web app (the app's `zami-web/` assets) to its WebView: see [ZamiWebApp]. */
class ZamiShellModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZamiShell")

    OnCreate {
      appContext.reactContext?.applicationContext?.let { ZamiWebApp.install(it) }
    }

    Function("webAppURL") {
      val context = appContext.reactContext?.applicationContext ?: return@Function null
      ZamiWebApp.install(context)
      if (ZamiWebApp.available()) ZamiWebApp.ORIGIN + "/" else null
    }

    Function("setStartScript") { script: String ->
      appContext.reactContext?.applicationContext?.let { ZamiWebApp.install(it) }
      ZamiWebApp.startScript = script
    }
  }
}
