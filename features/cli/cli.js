'use strict';

var ALLONSY_RC_FILE = '.allonsyrc',
    ENV_FILE = '.env',
    CLI_SEARCH = '../**/*-cli.js',
    ENV_SEARCH = './features/**/*-env.json',

    utils = require('./cli-utils'),
    extend = require('extend'),
    program = require('commander'),
    fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    inquirer = require('inquirer'),
    glob = require('glob'),
    async = require('async'),
    jsonfile = require('jsonfile'),
    semver = require('semver'),
    dotenv = require('dotenv'),
    allonsyrcFile = path.resolve(utils.path, ALLONSY_RC_FILE),
    envFile = path.resolve(utils.path, ENV_FILE),
    cliFiles = path.resolve(__dirname, CLI_SEARCH),
    envJsonFiles = path.resolve(utils.path, ENV_SEARCH),
    packageFile = path.resolve(utils.path, 'package.json');

program
  .version(utils.package.name + ' ' + utils.package.version, '-v, --version')
  .usage('[options]')
  .option('-f, --force', 'Force the creation/update of the plateform')
  .option('-n, --no-npm', 'Create/update the plateform without use npm')
  .option('init', 'Create an Allons-y! plateform')
  .option('update', 'Update a Allons-y! plateform')
  .option('env', 'Configure your plateform environment')
  .parse(process.argv);

function config() {
  var config = {
    version: '0.0.0',
    package: {},
    install: {},
    env: {}
  };

  if (fs.existsSync(allonsyrcFile)) {
    config = extend(true, config, jsonfile.readFileSync(allonsyrcFile));
  }

  if (fs.existsSync(packageFile)) {
    config.package = jsonfile.readFileSync(packageFile);
  }

  if (fs.existsSync(envFile)) {
    config.env = dotenv.parse(fs.readFileSync(envFile));
    Object.keys(config.env).forEach(function(key) {
      config.env[key] = config.env[key] == 'true' ? true : config.env[key];
      config.env[key] = config.env[key] == 'false' ? false : config.env[key];
    });
  }

  return config;
}

function saveConfig(config) {
  delete config.package;
  delete config.env;
  jsonfile.writeFileSync(allonsyrcFile, config);
}

function cliPrompt(config, promptType, forcePrompt, tasksFunc) {
  var files = glob.sync(cliFiles),
      tasks = [],
      hasPrompt = false;

  async.mapSeries(files, function(file, next) {
    var task = require(file),
        item;

    tasks.push(task);

    if (promptType && task[promptType] && task[promptType].length) {
      var prompts = [];

      if (forcePrompt) {
        prompts = task[promptType];
        hasPrompt = true;
      }
      else {
        prompts = [];
        var keys = Object.keys(config[promptType]);

        task[promptType].forEach(function(prompt) {
          var exists = false;

          keys.forEach(function(key) {
            if (key == prompt.name) {
              exists = true;

              return false;
            }
          });

          if (!exists) {
            prompts.push(prompt);
          }
        });

        if (!prompts.length) {
          return next();
        }

        hasPrompt = true;
      }

      prompts.map(function(prompt) {
        if (typeof config[promptType][prompt.name] != 'undefined') {
          prompt.default = config[promptType][prompt.name];
        }
      });

      inquirer.prompt(prompts, function(values) {
        for (item in values) {
          config[promptType][item] = values[item];
        }

        next();
      });

      return;
    }

    next();

  }, function() {

    if (tasksFunc) {
      tasksFunc(tasks, hasPrompt);
    }
  });
}

if (program.init || program.update) {
  var config = config();

  if (!program.force && !semver.lt(config.version, utils.package.version)) {
    return utils.success('\nYour Allons-y! configuration (' + utils.package.version + ') is up to date!\n');
  }

  config.version = utils.package.version;

  utils.banner([
    'You are going to ' + (program.init ? 'create a' : 'update your') + ' Allons-y! plateform (' + utils.package.version + ').\n',
    'Please answer the few questions below to configure your install:\n'
  ]);

  cliPrompt(config, 'install', false, function(tasks, hasPrompt) {

    if (!hasPrompt) {
      utils.success('No new question to ask.\n');
    }

    utils.info('\nNow let\'s ' + (program.init ? 'create' : 'update') + ' the webapp!\n\n');

    async.mapSeries(tasks, function(task, next) {

      if (task.beforeInstall) {
        task.beforeInstall(config, utils, next);
      }
      else {
        next();
      }

    }, function() {

      utils.log('► ' + (program.init ? 'Create' : 'Update') + ' npm package file... ');

      jsonfile.writeFileSync(packageFile, config.package);

      utils.log('[OK]');

      var npmCommands = ['npm'];
      if (program.init) {
        npmCommands.push('install');
      }
      else {
        npmCommands = npmCommands.concat(['update', '--save']);
      }

      var installProcess = {
        on: function(name, func) {
          func();
        }
      };

      if (program.npm) {
        utils.info('\n\n' + (program.init ? 'Install' : 'Update') + ' your dependencies:\n\n');

        installProcess = spawn('env', npmCommands, {
          cwd: utils.path,
          stdio: 'inherit'
        });

        installProcess.on('error', function(err) {
          throw err;
        });
      }

      installProcess.on('close', function() {

        utils.info('\n\nConfigure installed features\n\n');

        async.mapSeries(tasks, function(task, next) {

          if (task.afterInstall) {
            task.afterInstall(config, utils, next);
          }
          else {
            next();
          }

        }, function() {

          utils.log('► Save configuration... ');

          saveConfig(config);

          utils.log('[OK]');

          utils.title('Your app "' + config.install.name + '" is ' + (program.init ? 'ready!\n\n    Now use "allons-y env" to configure you environment.' : 'up to date!'));
        });
      });
    });
  });

  return;
}

if (program.env) {
  var config = config();

  utils.banner('Configure your Allons-y! plateform (' + utils.package.version + ') environment:\n');

  cliPrompt(config, 'env', true, function() {

    var files = glob.sync(envJsonFiles);

    async.mapSeries(files, function(file, next) {

      var envConfig = require(file);

      if (envConfig.env && typeof envConfig.env == 'object' && envConfig.env.length) {

        envConfig.env.map(function(prompt) {
          if (typeof config.env[prompt.name] != 'undefined') {
            prompt.default = config.env[prompt.name];
          }
        });

        inquirer.prompt(envConfig.env, function(values) {
          for (var item in values) {
            config.env[item] = values[item];
          }

          next();
        });

        return;
      }

      next();

    }, function() {

      utils.log('\n► Save configuration... ');

      fs.writeFileSync(envFile, Object.keys(config.env).map(function(key) {
        return key + '=' + config.env[key];
      }).join('\n'));

      saveConfig(config);

      utils.log('[OK]');

      utils.title('Your app environment is ready!');
    });
  });

  return;
}

program.help();
