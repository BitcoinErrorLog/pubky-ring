Pod::Spec.new do |s|
  s.name         = 'PubkyNoise'
  s.version      = '0.1.0'
  s.summary      = 'PubkyNoise Rust FFI bindings'
  s.homepage     = 'https://github.com/pubky/pubky-noise'
  s.license      = { :type => 'MIT' }
  s.author       = { 'Pubky' => 'dev@pubky.org' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }

  s.vendored_frameworks = 'PubkyNoise.xcframework'
  s.static_framework = true
  s.source_files = 'PubkyNoiseBindings/*.swift'

  # Use conditional paths based on SDK to avoid module redefinition
  s.xcconfig = {
    'SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]' => '$(PODS_ROOT)/../PubkyNoise.xcframework/ios-arm64_x86_64-simulator/Modules',
    'SWIFT_INCLUDE_PATHS[sdk=iphoneos*]' => '$(PODS_ROOT)/../PubkyNoise.xcframework/ios-arm64/Modules'
  }
end

