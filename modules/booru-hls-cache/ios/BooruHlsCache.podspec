Pod::Spec.new do |s|
  s.name             = 'BooruHlsCache'
  s.version          = '1.0.0'
  s.summary          = 'Loopback HLS segment cache for Booru Viewer'
  s.homepage         = 'https://github.com/kaanekr/booru-viewer'
  s.license          = { :type => 'MIT' }
  s.author           = 'Booru Viewer Contributors'
  s.source           = { :git => 'https://github.com/kaanekr/booru-viewer.git' }
  s.platform         = :ios, '16.4'
  s.swift_version    = '5.9'
  s.static_framework = true
  s.source_files     = '*.swift'
  s.frameworks       = 'Network', 'WebKit'
  s.dependency 'ExpoModulesCore'
end
