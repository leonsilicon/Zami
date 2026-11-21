Pod::Spec.new do |s|
  s.name           = 'ZamiShell'
  s.version        = '0.0.0'
  s.summary        = "Serves Zam's web app from the Zami app's bundle to its WebView."
  s.author         = 'Leon Si'
  s.homepage       = 'https://github.com/leonsilicon/Zami'
  s.license        = 'GPL-3.0-or-later'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WebKit', 'UniformTypeIdentifiers'
  s.source_files = '**/*.swift'
end
