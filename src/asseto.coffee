console.time("init")
console.time("total")

S = require 'string'
os = require 'os'
fs = require 'fs'
vm = require 'vm'
sys = require 'sys'
mkdirp = require 'mkdirp'
cluster = require 'cluster'
less = require 'less'
touch = require 'touch'
uglify = require 'uglify-js'
lastmodified = require 'lastmodified'
wrench = require 'wrench'
path = require 'path'
crypto = require 'crypto'
requirejs = require 'requirejs'
htmlmini = require 'html-minifier'
_ = require 'underscore'
coffee = require 'coffee-script'
handlebars = require 'handlebars'

class Asseto

    constructor: (args = {}) ->
        if args.length < 5
            @err("not enough parameters")

        @input = @chkpath(args[3])
        @output = @chkpath(args[4])

        @styleOut = path.join(@output, 'styles')
        @scriptOut = path.join(@output, 'scripts')
        @pwd = path.dirname(args[1])
        #@cacheDir = os.tmpDir() + 'asseto/'
        @modified = lastmodified @input, "cachedb"
        @stats =
            cached: 0
            precompiled: 0

    chkpath: (p) ->
        if(S(p).startsWith('/Users'))
            p
        else
            path.join(process.cwd(), p)

    ############################
    ##### UTIL

    log: (s) ->
        #console.log(s)

    err: (e) ->
        console.error(e)
        process.exit(1)

    write: (f, data, cb) ->
        self = @
        @log('writing ' + f)
        fn = ->
            fs.writeFile(f, data, 'utf8', (e) ->
                if(e) then self.err(e)
                if(cb) then cb()
            )
        fdir = path.dirname(f)
        if(fdir != @styleOut && fdir != @scriptOut)
            @mkdir(path.dirname(f), () -> fn())
        else
            fn()

    read: (f, cb) ->
        self = @
        #@log("read " + f)
        fs.readFile(f, 'utf-8', (e, data) ->
            if(e)
                self.err(e)
            else
                cb(data)
        )

    mkdir: (f, cb) ->
        self = @
        if(f != '.')
            @log("mkdir " + f)
            mkdirp(f, (e) ->
                if(e)  then self.err(e)
                if(cb) then cb(f)
            )
        else
            if(cb) then cb(f)

    copy: (fin, fout, cb) ->
        self = @
        @log("copy " + fin + " to " + fout)
        self.read(fin, (data) ->
            self.mkdir(path.dirname(fout), () ->
                self.write(fout, data, cb)
            )
        )


    ############################
    ##### COMPILE

    c_style: (f, cb) ->
        self = @
        @log("less " + path.relative(self.input, f))
        dir = path.dirname(f)
        fn = path.basename(f)
        @read(f, (data) ->
            new less.Parser(
                filename: fn, paths: [dir]
            ).parse(data, (e, tree) ->
                if (e)
                    less.writeError(e)
                    process.exit(1)
                else
                    try
                        css = tree.toCSS
                            "compress": true, "yui-compress": false
                        if(cb) then cb(css)
                    catch e
                        less.writeError(e)
                        process.exit(1)
            )
        )

    c_coffee: (f, cb) ->
        self = @
        @log("coffee " + path.relative(self.input, f))
        self.read(f, (data) ->
            cb(
                try
                    coffee.compile(data, {'bare': true})
                catch e
                    console.error('"' + path.basename(f) + '"')
                    throw e
            )
        )

    c_bars: (f, cb) ->
        self = @
        @read(f, (data) ->
            fname = path.basename(f)
            fdir = path.relative(self.input, path.dirname(f))
            name = (fdir + '/' + fname)
                .replace("app/", "")
                .replace("components/app", "app/")
                .replace("components/", "")
                .replace(".tmpl", "")
                .replace("view/", "")
            name_arr = name.split("/").reverse()
            if name_arr.length > 1 && name_arr[0] == name_arr[1]
                name = S(name).left(name.length - name_arr[1].length - 1).s
            name = S(name.replace(/\//g, "-")).camelize().s
            self.log("hbars " + path.relative(self.input, f))
            #mHtml = htmlmini.minify(data, {collapseWhitespace: true, removeComments: true}).replace(/\\/g, '').replace(/}{/g, '} {')
            mHtml = data
                .replace(/\s+/g, ' ')               # shrink whitespaces
                #.replace(/<!--[\s\S]*?-->/g, "")   # remove comments
                #.replace(/}{/g, '} {')

            if mHtml.indexOf("<!--") >= 0
                throw new Error "template '" + fname + "' contains HTML comments!"

            compileHandlebarsTemplate = (str) ->
                exports.emberjs ?= fs.readFileSync (__dirname + '/vendor/ember.js'), 'utf8'
                exports.hbarsjs ?= fs.readFileSync (__dirname + '/vendor/handlebars.js'), 'utf8'

                # create a context for the vm using the sandbox data
                sandbox =
                    Ember:
                        assert: ->
                    template: str

                context = vm.createContext sandbox

                # load ember and handlebars in the vm
                vm.runInContext exports.hbarsjs, context, 'handlebars.js'
                vm.runInContext exports.emberjs, context, 'ember.js'

                # compile the handlebars template inside the vm context
                try
                    vm.runInContext 'var templatejs = Ember.Handlebars.precompile(template).toString();', context
                catch err
                    throw new Error("in template '" + fname + "' - " + err.message)
                context.templatejs;

            template = 'Em.TEMPLATES["' + name + '"] = Em.Handlebars.template(' + compileHandlebarsTemplate(mHtml) + ');'
            template = 'define(["ember"], function(Em) { ' + template + '});\n'
            cb(template)
        )

    c_uglify: (f, cb) ->
        self = @
        @log("uglify " + path.relative(self.input, f))
        self.read(f, (data) ->
            # https://github.com/mishoo/UglifyJS2
            ast = uglify.parse(data)
            ast.figure_out_scope()
            compressor = uglify.Compressor()
            ast = ast.transform(compressor)
            ast.figure_out_scope()
            ast.compute_char_frequency()
            ast.mangle_names()
            out = ast.print_to_string()
            cb(out)
        )

    c_amd: (cb) ->
        self = @
        self.c_amd_optimize(JSON.parse(self.buildconf.replace(/\\.dev"/g, '.prod"')), (config) ->
            config.baseUrl = '.'
            config.dir = self.scriptOut
            config.appDir = self.scriptOut

            #console.log(config)

            requirejs.optimize(config, (report) ->
                self.log(config)
                #_.each(config.modules, (m) ->
                #    self.copy(m._buildPath, path.join(self.scriptOut, m.name + '.js'))
                #)
                if(cb) then cb(config)
            , (err) ->
                self.err(err)
            )
        )

    c_amd_loader: (cb) ->
        self = @
        config = JSON.parse(@buildconf)
        modules = config.modules
        config.modules = undefined
        init_dev =
            """var Loader =
                function load(base, fs, cb) {
                var conf = """ + JSON.stringify(config) + """;
                var modules = """ + JSON.stringify(modules) + """;
                conf.baseUrl = base;
                var load = [];
                for (var i = 0; i < modules.length; i++) {
                    var mod = modules[i];
                    var m_name = mod.name;
                    for (var j = 0; j < fs.length; j++) {
                        var f_name = fs[j].replace(".js", "");;
                        if(f_name == m_name) {
                            var m_incl = mod.include;
                            for (var k = 0; k < m_incl.length; k++) {
                                load.push(m_incl[k]);
                            }
                        }
                    }
                }

            """ + self.requirejs(
                "conf", "load",
                "if (cb) { cb(); }") +
            "};"
        self.write(path.join(self.scriptOut, "main.dev.js"), init_dev, () ->
            if(cb) then cb()
        )

    c_amd_testacular: (cb) ->
        self = @
        json = JSON.parse(@buildconf)
        if(json)
            conf = {}
            _(_(json).keys()).each((k) ->
                val = json[k]
                if(_.isObject(val) || _.isArray(val))
                    conf[k] = val
            )
            conf.baseUrl = "/base/"
            conf.modules = undefined
            #conf.urlArgs = "d=" + (new Date()).getTime()
            cb(
                self.requirejs(
                    JSON.stringify(conf),
                    "['./app/app.test']",
                    "window.__testacular__.start();"
                )
            )
        else
            cb()

    c_amd_optimize: (json, cb) ->
        if(!cb)
            cb = json
            json = JSON.parse(@buildconf)

        json.baseUrl = "."
        json.dir = "."
        json.appDir = "."

        json.optimize = "uglify2"
        #json.generateSourceMaps = true
        json.useStrict = true
        json.keepBuildDir = true
        json.skipPragmas = true
        json.cjsTranslate = false
        json.skipDirOptimize = true
        #json.removeCombined = true
        #json.normalizeDirDefines = "skip"
        json.findNestedDependencies = true
        json.preserveLicenseComments = false
        #json.fileExclusionRegExp = "/(^\\.\\.test\\.js|\\.raw\\.js|\\.min\\.js|\\.tmpl)/"
        json.modules = _(json.modules).map((m) ->
            m.create = true
            m
        )

        cb(json)

    requirejs: (conf, paths, init) ->
        """
        require.config(""" + conf + """);
        //console.log(""" + paths + """);
        require(""" + paths + """, function() {
            """ + init + """
        }, function (err) {
            console.error(err.message);
            throw err;
        });
        """

    ############################
    ##### MANAGE

    minifier: (files, cb) ->
        self = @
        fn = () -> self.minifier(_.tail(files), cb)
        if(_.isEmpty(files))
            if(cb) then cb()
        else
            f = _.head(files)
            fname = path.basename(f)
            if(fname != 'test.js' && fname != '.')
                fout = path.join(self.scriptOut, fname.replace('.js', '.min.js'))
                self.transform(f, fout, self.c_uglify, fn)
            else
                fn()

    bundler: (fpaths, cb) ->
        self = @
        fn = () -> self.bundler(_.tail(fpaths), cb)
        if(_.isEmpty(fpaths))
            if(cb) then cb()
        else
            fpath = _.head(fpaths)
            if(S(fpath).endsWith(".json"))
                @log("bundle " + fpath)
                console.time("bundle")
                self.c_amd((config) ->
                    console.timeEnd("bundle")
                    ###
                    outs = []
                    _.each(config.modules, (m) -> outs.push(m._buildPath))
                    console.time("minify")
                    self.minifier(outs, () ->
                        console.timeEnd("minify")
                        fn()
                    )
                    ###
                    fn()
                )
            else
                fn()

    precompileFile: (fpath, cb) ->
        self = @
        file = path.join(self.input, fpath)
        if(S(fpath).endsWith('build.json')) # || S(fpath).endsWith('Spec.coffee')
            @read(file, (data) ->
                self.buildconf = data
                self.c_amd_testacular((data) ->
                    fout = path.join(self.scriptOut, "main.test.js")
                    self.write(fout, data, () ->
                        self.c_amd_optimize((data) ->
                            fout = path.join(self.scriptOut, "build.opt.json")
                            self.write(fout, JSON.stringify(data), () ->
                                self.c_amd_loader(cb)
                            )
                        )
                    )
                )
            )
        else if(S(fpath).endsWith('.less') || S(fpath).endsWith('.css'))
            if(path.relative(file, self.input) == '../..' && S(fpath).startsWith('style'))
                isSub = S(fpath).contains('.sub')
                self.c_style(file, (data) ->
                    if(isSub)
                        fout = path.join(self.scriptOut, fpath.replace('.sub.less', '.js'))
                        dn = path.basename(path.join(file, '..')) + '/' + path.basename(fout).replace('.js', '')
                        "define('" + dn + "', function () {\n" +
                        "var style = module.exports = document.createElement('style');\n" +
                        "style.appendChild(document.createTextNode('" + data + "'));\n" +
                        "});"
                        self.write(fout, dn, cb)
                        # TODO: escape data?
                    else
                        fout = path.join(self.styleOut, path.basename(file).replace('.less', '.css'))
                        self.write(fout, data, cb)
                )
            else
                cb()
        else if(S(fpath).endsWith('.tmpl'))
            fout = path.join(self.scriptOut, fpath) + ".js"
            self.transform(file, fout, self.c_bars, cb)
        else if(S(fpath).endsWith('.coffee') || S(fpath).endsWith('.ctrl') || S(fpath).endsWith('.view') ||
                S(fpath).endsWith('.route') || S(fpath).endsWith('.router') || S(fpath).endsWith('.test') ||
                S(fpath).endsWith('.mdl') || S(fpath).endsWith('.model') || S(fpath).endsWith('.coll'))
            fout = path.join(self.scriptOut, fpath.replace(".coffee", "") + '.js')
            self.transform(file, fout, self.c_coffee, cb)
        else
            fout = path.join(self.scriptOut, fpath)
            self.transform(file, fout, (f, cb) ->
                self.copy(f, fout, cb)
            , cb)

    precompileFiles: (fpaths, cb) ->
        self = @
        next = () -> self.precompileFiles(_.tail(fpaths), cb)

        if(_.isEmpty(fpaths))
            cb()
        else
            fpath = _.head(fpaths)
            self.precompileFile(fpath, next)

    transform: (source, target, action, skip, chg) ->
        self = @

        exec = () ->
            self.stats.precompiled = self.stats.precompiled + 1
            action.apply(self, [source, (data) ->
                if (chg) then data = chg(data)
                if (data)
                    self.write(target, data, skip)
                else
                    skip()
            ])

        #self.log(path.relative(__dirname, source))
        @modified.sinceLastCall(path.relative(self.input, source), (err, wasModified) ->
            if err
                self.err(err)
            else
                if wasModified
                    # file modified: execute!
                    exec()
                else
                    fs.readFile(target, 'utf-8', (err, data) ->
                        if err
                            # no cache file: execute!
                            exec()
                        else
                            # cache file found!
                            self.stats.cached = self.stats.cached + 1
                            skip()
                    )
        )

    main: (cb) ->
        self = @
        @main1(null, (fpaths) ->
            self.modified.serialize()
            self.main2(cb)
        )

    main1: (filter, cb) ->
        self = @

        @resetOutputDir(@styleOut, () ->
            self.resetOutputDir(self.scriptOut, () ->

                self.log("#1 COMPILING")
                console.time("compile")

                fpaths = _.filter(wrench.readdirSyncRecursive(self.input), (f) ->
                    !S(f).endsWith('DS_Store') && S(f).contains('.') && (!filter || filter(f))
                )

                self.precompileFiles(fpaths, () ->
                    console.timeEnd("compile")
                    console.log(" -> " + self.stats.cached + " cached, " + self.stats.precompiled + " compiled")

                    touch(path.join(self.scriptOut, "touch"), () ->
                        if(cb) then cb(fpaths)
                    )
                )
            )
        )

    main2: (cb) ->
        # TODO: check first if ANY of the JS files changed
        @log("#2 BUNDLING")
        bfpaths = _.filter(fs.readdirSync(@input), (f) -> S(f).contains('build'))
        @bundler(bfpaths, () ->
            if(cb) then cb()
        )

    resetOutputDir: (dir, cb) ->
        self = @
        @mkdir(dir, () ->
            fs.stat(dir, (e, stats) ->
                if(e)
                    self.err(e)
                else
                    age = (new Date().getTime()) - (stats.ctime.getTime())
                    if(age < 1 * 3600000) # x * hours
                        cb()
                    else
                        console.log("#0 RESET: " + path.basename(dir))
                        wrench.rmdirSyncRecursive(dir)
                        self.mkdir(dir, cb)
            )
        )

exports.compile = (args, cb) ->
    a = new Asseto(args)
    #a.output = a.output
    a.main1()

exports.compilejs = (args, cb) ->
    a = new Asseto(args)
    #a.output = a.output
    a.main1(
        ((f) -> !S(f).endsWith('.less')), () -> if(cb) then cb()
    )

exports.bundle = (args) ->
    a = new Asseto(args)
    console.timeEnd("init")
    a.main(() ->
        console.timeEnd("total")
    )