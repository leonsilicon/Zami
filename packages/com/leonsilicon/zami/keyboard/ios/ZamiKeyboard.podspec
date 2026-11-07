Pod::Spec.new do |s|
  s.name           = 'ZamiKeyboard'
  s.version        = '0.0.0'
  s.summary        = 'Hardware keyboard presses as DOM-style key events for Zami.'
  s.author         = 'Leon Si'
  s.homepage       = 'https://github.com/leonsilicon/Zami'
  s.license        = 'GPL-3.0-or-later'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
