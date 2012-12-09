fs     = require 'fs'
coffee = require 'coffee-script'

task 'build', 'build asseto', (options) ->
  fs.writeFileSync 'lib/asseto.js', coffee.compile(fs.readFileSync('src/asseto.coffee', 'utf8'))