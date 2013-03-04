(function() {
  var Asseto, S, coffee, fs, handlebars, lastmodified, less, mkdirp, os, path, requirejs, sys, touch, uglify, vm, wrench, _;

  console.time("init");

  console.time("total");

  S = require('string');

  os = require('os');

  fs = require('fs');

  vm = require('vm');

  sys = require('sys');

  mkdirp = require('mkdirp');

  less = require('less');

  touch = require('touch');

  uglify = require('uglify-js');

  lastmodified = require('lastmodified');

  wrench = require('wrench');

  path = require('path');

  requirejs = require('requirejs');

  _ = require('underscore');

  coffee = require('coffee-script');

  handlebars = require('handlebars');

  Asseto = (function() {

    function Asseto(args) {
      if (args == null) {
        args = {};
      }
      if (args.length < 5) {
        this.err("not enough parameters");
      }
      this.input = this.chkpath(args[3]);
      this.output = this.chkpath(args[4]);
      this.styleOut = path.join(this.output, 'styles');
      this.scriptOut = path.join(this.output, 'scripts');
      this.pwd = path.dirname(args[1]);
      this.modified = lastmodified(this.input, "cachedb");
      this.stats = {
        cached: 0,
        precompiled: 0
      };
    }

    Asseto.prototype.chkpath = function(p) {
      if (S(p).startsWith('/Users')) {
        return p;
      } else {
        return path.join(process.cwd(), p);
      }
    };

    Asseto.prototype.log = function(s) {};

    Asseto.prototype.err = function(e) {
      console.error(e);
      return process.exit(1);
    };

    Asseto.prototype.write = function(f, data, cb) {
      var fdir, fn, self;
      self = this;
      this.log('writing ' + f);
      fn = function() {
        return fs.writeFile(f, data, 'utf8', function(e) {
          if (e) {
            self.err(e);
          }
          if (cb) {
            return cb();
          }
        });
      };
      fdir = path.dirname(f);
      if (fdir !== this.styleOut && fdir !== this.scriptOut) {
        return this.mkdir(path.dirname(f), function() {
          return fn();
        });
      } else {
        return fn();
      }
    };

    Asseto.prototype.read = function(f, cb) {
      var self;
      self = this;
      return fs.readFile(f, 'utf-8', function(e, data) {
        if (e) {
          return self.err(e);
        } else {
          return cb(data);
        }
      });
    };

    Asseto.prototype.mkdir = function(f, cb) {
      var self;
      self = this;
      if (f !== '.') {
        this.log("mkdir " + f);
        return mkdirp(f, function(e) {
          if (e) {
            self.err(e);
          }
          if (cb) {
            return cb(f);
          }
        });
      } else {
        if (cb) {
          return cb(f);
        }
      }
    };

    Asseto.prototype.copy = function(fin, fout, cb) {
      var self;
      self = this;
      this.log("copy " + fin + " to " + fout);
      return self.read(fin, function(data) {
        return self.mkdir(path.dirname(fout), function() {
          return self.write(fout, data, cb);
        });
      });
    };

    Asseto.prototype.c_style = function(f, cb) {
      var dir, fn, self;
      self = this;
      this.log("less " + path.relative(self.input, f));
      dir = path.dirname(f);
      fn = path.basename(f);
      return this.read(f, function(data) {
        return new less.Parser({
          filename: fn,
          paths: [dir]
        }).parse(data, function(e, tree) {
          var css;
          if (e) {
            less.writeError(e);
            return process.exit(1);
          } else {
            try {
              css = tree.toCSS({
                "compress": true,
                "yui-compress": false
              });
              if (cb) {
                return cb(css);
              }
            } catch (e) {
              less.writeError(e);
              return process.exit(1);
            }
          }
        });
      });
    };

    Asseto.prototype.c_coffee = function(f, cb) {
      var self;
      self = this;
      this.log("coffee " + path.relative(self.input, f));
      return self.read(f, function(data) {
        return cb((function() {
          try {
            return coffee.compile(data, {
              'bare': true
            });
          } catch (e) {
            console.error('"' + path.basename(f) + '"');
            throw e;
          }
        })());
      });
    };

    Asseto.prototype.c_bars = function(f, cb) {
      var self;
      self = this;
      return this.read(f, function(data) {
        var compileHandlebarsTemplate, fdir, fname, mHtml, name, name_arr, template;
        fname = path.basename(f);
        fdir = path.relative(self.input, path.dirname(f));
        name = fname.indexOf(".root.") >= 0 ? fname : fdir + "/" + fname;
        name = name.replace("components/", "").replace("app/", "").replace(".root.tmpl", "").replace(".tmpl", "").replace("view/", "");
        name_arr = name.split("/").reverse();
        if (name_arr.length > 1 && name_arr[0] === name_arr[1]) {
          name = S(name).left(name.length - name_arr[1].length - 1).s;
          name_arr = name.split("/").reverse();
        }
        if (name_arr.length > 2) {
          name = name_arr[1] + "/" + name_arr[0];
        }
        name = name.replace(/\/\//g, "/");
        self.log("hbars " + path.relative(self.input, f));
        mHtml = data.replace(/\s+/g, ' ');
        if (mHtml.indexOf("<!--") >= 0) {
          throw new Error("template '" + fname + "' contains HTML comments!");
        }
        compileHandlebarsTemplate = function(str) {
          var context, sandbox, _ref, _ref1;
          if ((_ref = exports.emberjs) == null) {
            exports.emberjs = fs.readFileSync(__dirname + '/vendor/ember.js', 'utf8');
          }
          if ((_ref1 = exports.hbarsjs) == null) {
            exports.hbarsjs = fs.readFileSync(__dirname + '/vendor/handlebars.js', 'utf8');
          }
          sandbox = {
            Ember: {
              assert: function() {}
            },
            template: str
          };
          context = vm.createContext(sandbox);
          vm.runInContext(exports.hbarsjs, context, 'handlebars.js');
          vm.runInContext(exports.emberjs, context, 'ember.js');
          try {
            vm.runInContext('var templatejs = Ember.Handlebars.precompile(template).toString();', context);
          } catch (err) {
            throw new Error("in template '" + fname + "' - " + err.message);
          }
          return context.templatejs;
        };
        template = 'Em.TEMPLATES["' + name + '"] = Em.Handlebars.template(' + compileHandlebarsTemplate(mHtml) + ');';
        template = 'define(["ember"], function(Em) { ' + template + '});\n';
        return cb(template);
      });
    };

    Asseto.prototype.c_uglify = function(f, cb) {
      var self;
      self = this;
      this.log("uglify " + path.relative(self.input, f));
      return self.read(f, function(data) {
        var ast, compressor, out;
        ast = uglify.parse(data);
        ast.figure_out_scope();
        compressor = uglify.Compressor();
        ast = ast.transform(compressor);
        ast.figure_out_scope();
        ast.compute_char_frequency();
        ast.mangle_names();
        out = ast.print_to_string();
        return cb(out);
      });
    };

    Asseto.prototype.c_amd = function(cb) {
      var self;
      self = this;
      return self.c_amd_optimize(JSON.parse(self.buildconf.replace(/\\.dev"/g, '.prod"')), function(config) {
        config.baseUrl = '.';
        config.dir = self.scriptOut;
        config.appDir = self.scriptOut;
        return requirejs.optimize(config, function(report) {
          self.log(config);
          if (cb) {
            return cb(config);
          }
        }, function(err) {
          return self.err(err);
        });
      });
    };

    Asseto.prototype.c_amd_loader = function(cb) {
      var config, init_dev, modules, self;
      self = this;
      config = JSON.parse(this.buildconf);
      modules = config.modules;
      config.modules = void 0;
      init_dev = "var Loader =\nfunction load(base, fs, cb) {\nvar conf = " + JSON.stringify(config) + ";\nvar modules = " + JSON.stringify(modules) + ";\nconf.baseUrl = base;\nvar load = [];\nfor (var i = 0; i < modules.length; i++) {\n    var mod = modules[i];\n    var m_name = mod.name;\n    for (var j = 0; j < fs.length; j++) {\n        var f_name = fs[j].replace(\".js\", \"\");;\n        if(f_name == m_name) {\n            var m_incl = mod.include;\n            for (var k = 0; k < m_incl.length; k++) {\n                load.push(m_incl[k]);\n            }\n        }\n    }\n}\n" + self.requirejs("conf", "load", "if (cb) { cb(); }") + "};";
      return self.write(path.join(self.scriptOut, "main.dev.js"), init_dev, function() {
        if (cb) {
          return cb();
        }
      });
    };

    Asseto.prototype.c_amd_testacular = function(cb) {
      var conf, json, self;
      self = this;
      json = JSON.parse(this.buildconf);
      if (json) {
        conf = {};
        _(_(json).keys()).each(function(k) {
          var val;
          val = json[k];
          if (_.isObject(val) || _.isArray(val)) {
            return conf[k] = val;
          }
        });
        conf.baseUrl = "/base/";
        conf.modules = void 0;
        return cb(self.requirejs(JSON.stringify(conf), "['./app/app.test']", "window.__testacular__.start();"));
      } else {
        return cb();
      }
    };

    Asseto.prototype.c_amd_optimize = function(json, cb) {
      if (!cb) {
        cb = json;
        json = JSON.parse(this.buildconf);
      }
      json.baseUrl = ".";
      json.dir = ".";
      json.appDir = ".";
      json.optimize = "uglify2";
      json.useStrict = true;
      json.keepBuildDir = true;
      json.skipPragmas = true;
      json.cjsTranslate = false;
      json.skipDirOptimize = true;
      json.findNestedDependencies = true;
      json.preserveLicenseComments = false;
      json.modules = _(json.modules).map(function(m) {
        m.create = true;
        return m;
      });
      return cb(json);
    };

    Asseto.prototype.requirejs = function(conf, paths, init) {
      return "require.config(" + conf + ");\n//console.log(" + paths + ");\nrequire(" + paths + ", function() {" + init + "}, function (err) {\n    console.error(err.message);\n    throw err;\n});";
    };

    Asseto.prototype.minifier = function(files, cb) {
      var f, fn, fname, fout, self;
      self = this;
      fn = function() {
        return self.minifier(_.tail(files), cb);
      };
      if (_.isEmpty(files)) {
        if (cb) {
          return cb();
        }
      } else {
        f = _.head(files);
        fname = path.basename(f);
        if (fname !== 'test.js' && fname !== '.') {
          fout = path.join(self.scriptOut, fname.replace('.js', '.min.js'));
          return self.transform(f, fout, self.c_uglify, fn);
        } else {
          return fn();
        }
      }
    };

    Asseto.prototype.bundler = function(fpaths, cb) {
      var fn, fpath, self;
      self = this;
      fn = function() {
        return self.bundler(_.tail(fpaths), cb);
      };
      if (_.isEmpty(fpaths)) {
        if (cb) {
          return cb();
        }
      } else {
        fpath = _.head(fpaths);
        if (S(fpath).endsWith(".json")) {
          this.log("bundle " + fpath);
          console.time("bundle");
          return self.c_amd(function(config) {
            console.timeEnd("bundle");
            /*
                                outs = []
                                _.each(config.modules, (m) -> outs.push(m._buildPath))
                                console.time("minify")
                                self.minifier(outs, () ->
                                    console.timeEnd("minify")
                                    fn()
                                )
            */

            return fn();
          });
        } else {
          return fn();
        }
      }
    };

    Asseto.prototype.precompileFile = function(fpath, cb) {
      var file, fout, isSub, self;
      self = this;
      file = path.join(self.input, fpath);
      if (S(fpath).endsWith('build.json')) {
        return this.read(file, function(data) {
          self.buildconf = data;
          return self.c_amd_testacular(function(data) {
            var fout;
            fout = path.join(self.scriptOut, "main.test.js");
            return self.write(fout, data, function() {
              return self.c_amd_optimize(function(data) {
                fout = path.join(self.scriptOut, "build.opt.json");
                return self.write(fout, JSON.stringify(data), function() {
                  return self.c_amd_loader(cb);
                });
              });
            });
          });
        });
      } else if (S(fpath).endsWith('.less') || S(fpath).endsWith('.css')) {
        if (path.relative(file, self.input) === '../..' && S(fpath).startsWith('style')) {
          isSub = S(fpath).contains('.sub');
          return self.c_style(file, function(data) {
            var dn, fout;
            if (isSub) {
              fout = path.join(self.scriptOut, fpath.replace('.sub.less', '.js'));
              dn = path.basename(path.join(file, '..')) + '/' + path.basename(fout).replace('.js', '');
              "define('" + dn + "', function () {\n" + "var style = module.exports = document.createElement('style');\n" + "style.appendChild(document.createTextNode('" + data + "'));\n" + "});";
              return self.write(fout, dn, cb);
            } else {
              fout = path.join(self.styleOut, path.basename(file).replace('.less', '.css'));
              return self.write(fout, data, cb);
            }
          });
        } else {
          return cb();
        }
      } else if (S(fpath).endsWith('.tmpl')) {
        fout = path.join(self.scriptOut, fpath) + ".js";
        return self.transform(file, fout, self.c_bars, cb);
      } else if (S(fpath).endsWith('.coffee') || S(fpath).endsWith('.ctrl') || S(fpath).endsWith('.view') || S(fpath).endsWith('.route') || S(fpath).endsWith('.router') || S(fpath).endsWith('.test') || S(fpath).endsWith('.mdl') || S(fpath).endsWith('.model') || S(fpath).endsWith('.coll')) {
        fout = path.join(self.scriptOut, fpath.replace(".coffee", "") + '.js');
        return self.transform(file, fout, self.c_coffee, cb);
      } else {
        fout = path.join(self.scriptOut, fpath);
        return self.transform(file, fout, function(f, cb) {
          return self.copy(f, fout, cb);
        }, cb);
      }
    };

    Asseto.prototype.precompileFiles = function(fpaths, cb) {
      var fpath, next, self;
      self = this;
      next = function() {
        return self.precompileFiles(_.tail(fpaths), cb);
      };
      if (_.isEmpty(fpaths)) {
        return cb();
      } else {
        fpath = _.head(fpaths);
        return self.precompileFile(fpath, next);
      }
    };

    Asseto.prototype.transform = function(source, target, action, skip, chg) {
      var exec, self;
      self = this;
      exec = function() {
        self.stats.precompiled = self.stats.precompiled + 1;
        return action.apply(self, [
          source, function(data) {
            if (chg) {
              data = chg(data);
            }
            if (data) {
              return self.write(target, data, skip);
            } else {
              return skip();
            }
          }
        ]);
      };
      return this.modified.sinceLastCall(path.relative(self.input, source), function(err, wasModified) {
        if (err) {
          return self.err(err);
        } else {
          if (wasModified) {
            return exec();
          } else {
            return fs.readFile(target, 'utf-8', function(err, data) {
              if (err) {
                return exec();
              } else {
                self.stats.cached = self.stats.cached + 1;
                return skip();
              }
            });
          }
        }
      });
    };

    Asseto.prototype.main = function(cb) {
      var self;
      self = this;
      return this.main1(null, function(fpaths) {
        self.modified.serialize();
        return self.main2(cb);
      });
    };

    Asseto.prototype.main1 = function(filter, cb) {
      var self;
      self = this;
      return this.resetOutputDir(this.styleOut, function() {
        return self.resetOutputDir(self.scriptOut, function() {
          var fpaths;
          self.log("#1 COMPILING");
          console.time("compile");
          fpaths = _.filter(wrench.readdirSyncRecursive(self.input), function(f) {
            return !S(f).endsWith('DS_Store') && S(f).contains('.') && (!filter || filter(f));
          });
          return self.precompileFiles(fpaths, function() {
            console.timeEnd("compile");
            console.log(" -> " + self.stats.cached + " cached, " + self.stats.precompiled + " compiled");
            return touch(path.join(self.scriptOut, "touch"), function() {
              if (cb) {
                return cb(fpaths);
              }
            });
          });
        });
      });
    };

    Asseto.prototype.main2 = function(cb) {
      var bfpaths;
      this.log("#2 BUNDLING");
      bfpaths = _.filter(fs.readdirSync(this.input), function(f) {
        return S(f).contains('build');
      });
      return this.bundler(bfpaths, function() {
        if (cb) {
          return cb();
        }
      });
    };

    Asseto.prototype.resetOutputDir = function(dir, cb) {
      var self;
      self = this;
      return this.mkdir(dir, function() {
        return fs.stat(dir, function(e, stats) {
          var age;
          if (e) {
            return self.err(e);
          } else {
            age = (new Date().getTime()) - (stats.ctime.getTime());
            if (age < 3600000) {
              return cb();
            } else {
              console.log("#0 RESET: " + path.basename(dir));
              wrench.rmdirSyncRecursive(dir);
              return self.mkdir(dir, cb);
            }
          }
        });
      });
    };

    return Asseto;

  })();

  exports.compile = function(args, cb) {
    var a;
    a = new Asseto(args);
    return a.main1();
  };

  exports.compilejs = function(args, cb) {
    var a;
    a = new Asseto(args);
    return a.main1((function(f) {
      return !S(f).endsWith('.less');
    }), function() {
      if (cb) {
        return cb();
      }
    });
  };

  exports.bundle = function(args) {
    var a;
    a = new Asseto(args);
    console.timeEnd("init");
    return a.main(function() {
      return console.timeEnd("total");
    });
  };

}).call(this);
