Pod::Spec.new do |s|
  s.name           = 'ZamiMedia'
  s.version        = '0.0.0'
  s.summary        = "Zami's attachments off the JS thread: downloads verified, decrypted and cached, encryption file to file, and thumbnails."
  s.author         = 'Leon Si'
  s.homepage       = 'https://github.com/leonsilicon/Zami'
  s.license        = 'GPL-3.0-or-later'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'AVFoundation', 'ImageIO', 'UniformTypeIdentifiers'
  s.source_files = '**/*.swift'
end
