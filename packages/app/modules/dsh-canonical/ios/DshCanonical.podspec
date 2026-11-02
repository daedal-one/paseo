Pod::Spec.new do |s|
  s.name = 'DshCanonical'
  s.version = '0.1.0'
  s.summary = 'Credential-bound canonical DSH browser carrier'
  s.description = 'Canonical remote DSH interface hosted by WKWebView with native authenticated networking.'
  s.license = 'Apache-2.0'
  s.author = 'daedal-one'
  s.homepage = 'https://github.com/daedal-one/paseo'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.resource_bundles = { 'DshCanonical' => ['Resources/*'] }
  s.frameworks = 'WebKit', 'Security'
  s.libraries = 'sqlite3'
end
