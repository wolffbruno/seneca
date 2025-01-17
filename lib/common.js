/* Copyright © 2010-2021 Richard Rodger and other contributors, MIT License. */
'use strict'

const Util = require('util')

const Stringify = require('fast-safe-stringify')
const Eraro = require('eraro')
const Jsonic = require('jsonic')
const Nid = require('nid')
const Norma = require('norma')
const DefaultsDeep = require('lodash.defaultsdeep')

const Errors = require('./errors')
const Print = require('./print')

const error =
  (exports.error =
  exports.eraro =
    Eraro({
      package: 'seneca',
      msgmap: Errors,
      override: true,
    }))

exports.promiser = function (context, callback) {
  if ('function' === typeof context && null == callback) {
    callback = context
  } else {
    callback = callback.bind(context)
  }

  return new Promise((resolve, reject) => {
    callback((err) => {
      return err ? reject(err) : resolve()
    })
  })
}

exports.stringify = function () {
  return Stringify(...arguments)
}

exports.wrap_error = function (err) {
  if (err.seneca) {
    throw err
  } else {
    throw error.call(null, ...arguments)
  }
}

exports.make_plugin_key = function (plugin, origtag) {
  if (null == plugin) {
    throw error('missing_plugin_name')
  }

  var name = null == plugin.name ? plugin : plugin.name
  var tag = null == plugin.tag ? (null == origtag ? '' : origtag) : plugin.tag

  if ('number' === typeof name) {
    name = '' + name
  }

  if ('number' === typeof tag) {
    tag = '' + tag
  }

  if ('' == name || 'string' !== typeof name) {
    throw error('bad_plugin_name', { name: name })
  }

  var m = name.match(/^([a-zA-Z@][a-zA-Z0-9.~_\-/]*)\$([a-zA-Z0-9.~_-]+)$/)
  if (m) {
    name = m[1]
    tag = m[2]
  }

  // Allow file paths, but ...
  if (!name.match(/^(\.|\/|\\|\w:)/)) {
    // ... anything else should be well-formed
    if (!name.match(/^[a-zA-Z@][a-zA-Z0-9.~_\-/]*$/) || 1024 < name.length) {
      throw error('bad_plugin_name', { name: name })
    }
  }

  if ('' != tag && (!tag.match(/^[a-zA-Z0-9.~_-]+$/) || 1024 < tag.length)) {
    throw error('bad_plugin_tag', { tag: tag })
  }

  var key = name + (tag ? '$' + tag : '')

  return key
}

exports.boolify = function (v) {
  try {
    return !!JSON.parse(v)
  } catch (e) {
    return false
  }
}

exports.tagnid = Nid({ length: 3, alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })

var parse_jsonic = (exports.parse_jsonic = function (str, code) {
  code = code || 'bad_jsonic'

  try {
    return null == str ? null : Jsonic(str)
  } catch (e) {
    var col = 1 === e.line ? e.column - 1 : e.column
    throw error(code, {
      argstr: str,
      syntax: e.message,
      line: e.line,
      col: col,
    })
  }
})

// string args override object args
// TODO: fix name
exports.parsePattern = function parse_pattern(
  instance,
  rawargs,
  normaspec,
  fixed
) {
  var args = Norma(
    '{strargs:s? objargs:o? moreobjargs:o? ' + (normaspec || '') + '}',
    rawargs
  )

  // Precedence of arguments in add,act is left-to-right
  args.pattern = Object.assign(
    {},
    args.moreobjargs ? args.moreobjargs : null,
    args.objargs ? args.objargs : null,
    parse_jsonic(args.strargs, 'add_string_pattern_syntax'),
    fixed
  )

  return args
}

exports.build_message = function build_message(
  instance,
  rawargs,
  normaspec,
  fixed
) {
  var args = Norma(
    '{strargs:s? objargs:o? moreobjargs:o? ' + (normaspec || '') + '}',
    rawargs
  )

  // Precedence of arguments in add,act is left-to-right
  args.msg = Object.assign(
    {},
    args.moreobjargs,
    args.objargs,
    parse_jsonic(args.strargs, 'msg_jsonic_syntax'),
    fixed
  )

  return args
}

// Convert pattern object into a normalized jsonic String.
var pattern = (exports.pattern = function pattern(patobj) {
  if ('string' === typeof patobj) {
    return patobj
  }

  patobj = patobj || {}
  var sb = []

  Object.keys(patobj).forEach((k) => {
    var v = patobj[k]
    if (!~k.indexOf('$') && 'function' != typeof v && 'object' != typeof v) {
      sb.push(k + ':' + v)
    }
  })

  sb.sort()

  return sb.join(',')
})

exports.pincanon = function pincanon(inpin) {
  if ('string' == typeof inpin) {
    return pattern(Jsonic(inpin))
  } else if (Array.isArray(inpin)) {
    var pin = inpin.map(pincanon)
    pin.sort()
    return pin.join(';')
  } else {
    return pattern(inpin)
  }
}

exports.noop = function noop() {}

// remove any props containing $
function clean(obj, opts) {
  if (null == obj) return obj

  var out = Array.isArray(obj) ? [] : {}

  var pn = Object.getOwnPropertyNames(obj)
  for (var i = 0; i < pn.length; i++) {
    var p = pn[i]

    if ('$' != p[p.length - 1]) {
      out[p] = obj[p]
    }
  }

  return out
}
exports.clean = clean

// rightmost wins
exports.deep = function deeep(...argsarr) {
  // Lodash uses the reverse order to apply defaults than the deep API.
  argsarr = argsarr.reverse()

  // Add an empty object to the front of the args.  Defaults will be written
  // to this empty object.
  argsarr.unshift({})

  return DefaultsDeep.apply(null, argsarr)
}

// Print action result
exports.print = Print.print

// Iterate over arrays or objects
exports.each = function each(collect, func) {
  if (null == collect || null == func) {
    return null
  }

  if (Array.isArray(collect)) {
    return collect.forEach(func)
  } else {
    Object.keys(collect).forEach((k) => func(collect[k], k))
  }
}

exports.makedie = function (instance, ctxt) {
  ctxt = Object.assign(ctxt, instance.die ? instance.die.context : {})

  var diecount = 0

  var die = function (err) {
    var so = instance.options()
    var test = so.test

    // undead is only for testing, do not use in production
    var undead = (so.debug && so.debug.undead) || (err && err.undead)
    var full =
      (so.debug && so.debug.print && 'full' === so.debug.print.fatal) || false
    var print_env = (so.debug && so.debug.print.env) || false

    if (0 < diecount) {
      if (!undead) {
        throw error(err, '[DEATH LOOP] die count: ' + diecount)
      }
      return
    } else {
      diecount++
    }

    try {
      if (!err) {
        err = new Error('unknown')
      } else if (!Util.isError(err)) {
        err = new Error('string' === typeof err ? err : Util.inspect(err))
      }

      err.fatal$ = true

      var logdesc = {
        kind: ctxt.txt || 'fatal',
        level: ctxt.level || 'fatal',
        plugin: ctxt.plugin,
        tag: ctxt.tag,
        id: ctxt.id,
        code: err.code || 'fatal',
        notice: err.message,
        err: err,
        callpoint: ctxt.callpoint && ctxt.callpoint(),
      }

      instance.log.fatal(logdesc)

      var stack = err.stack || ''
      stack = stack
        .substring(stack.indexOf('\n') + 5)
        .replace(/\n\s+/g, '\n               ')

      var procdesc =
        'pid=' +
        process.pid +
        ', arch=' +
        process.arch +
        ', platform=' +
        process.platform +
        (!full ? '' : ', path=' + process.execPath) +
        ', argv=' +
        Util.inspect(process.argv).replace(/\n/g, '') +
        (!full
          ? ''
          : !print_env
          ? ''
          : ', env=' + Util.inspect(process.env).replace(/\n/g, ''))

      var when = new Date()

      var clean_details = null

      var stderrmsg =
        '\n\n' +
        '=== SENECA FATAL ERROR ===' +
        '\nMESSAGE   :::  ' +
        err.message +
        '\nCODE      :::  ' +
        err.code +
        '\nINSTANCE  :::  ' +
        instance.toString() +
        '\nDETAILS   :::  ' +
        Util.inspect(
          full
            ? err.details
            : ((clean_details = clean(err.details) || {}),
              delete clean_details.instance,
              clean_details),
          { depth: so.debug.print.depth }
        ).replace(/\n/g, '\n               ') +
        '\nSTACK     :::  ' +
        stack +
        '\nWHEN      :::  ' +
        when.toISOString() +
        ', ' +
        when.getTime() +
        '\nLOG       :::  ' +
        Jsonic.stringify(logdesc) +
        '\nNODE      :::  ' +
        process.version +
        ', ' +
        process.title +
        (!full
          ? ''
          : ', ' +
            Util.inspect(process.versions).replace(/\s+/g, ' ') +
            ', ' +
            Util.inspect(process.features).replace(/\s+/g, ' ') +
            ', ' +
            Util.inspect(process.moduleLoadList).replace(/\s+/g, ' ')) +
        '\nPROCESS   :::  ' +
        procdesc +
        '\nFOLDER    :::  ' +
        process.env.PWD

      if (so.errhandler) {
        so.errhandler.call(instance, err)
      }

      if (instance.flags.closed) {
        return
      }

      if (!undead) {
        instance.act('role:seneca,info:fatal,closing$:true', { err: err })

        instance.close(
          // terminate process, err (if defined) is from seneca.close
          function (close_err) {
            if (!undead) {
              process.nextTick(function () {
                if (close_err) {
                  instance.log.fatal({
                    kind: 'close',
                    err: Util.inspect(close_err),
                  })
                }

                if (test) {
                  if (close_err) {
                    Print.internal_err(close_err)
                  }

                  Print.internal_err(stderrmsg)
                  Print.internal_err(
                    '\nSENECA TERMINATED at ' +
                      new Date().toISOString() +
                      '. See above for error report.\n'
                  )
                }

                so.system.exit(1)
              })
            }
          }
        )
      }

      // make sure we close down within options.death_delay seconds
      if (!undead) {
        var killtimer = setTimeout(function () {
          instance.log.fatal({ kind: 'close', timeout: true })

          if (so.test) {
            Print.internal_err(stderrmsg)
            Print.internal_err(
              '\n\nSENECA TERMINATED (on timeout) at ' +
                new Date().toISOString() +
                '.\n\n'
            )
          }

          so.system.exit(2)
        }, so.death_delay)

        if (killtimer.unref) {
          killtimer.unref()
        }
      }
    } catch (panic) {
      this.log.fatal({
        kind: 'panic',
        panic: Util.inspect(panic),
        orig: arguments[0],
      })

      if (so.test) {
        var msg =
          '\n\n' +
          'Seneca Panic\n' +
          '============\n\n' +
          panic.stack +
          '\n\nOriginal Error:\n' +
          (arguments[0] && arguments[0].stack
            ? arguments[0].stack
            : arguments[0])
        Print.internal_err(msg)
      }
    }
  }

  die.context = ctxt

  return die
}

exports.make_standard_act_log_entry = function (
  actdef,
  msg,
  meta,
  origmsg,
  ctxt
) {
  var transport = origmsg.transport$ || {}
  var callmeta = meta || msg.meta$ || {}
  var prior = callmeta.prior || {}
  actdef = actdef || {}

  return Object.assign(
    {
      actid: callmeta.id,
      msg: msg,
      meta: meta,
      entry: prior.entry,
      prior: prior.chain,
      gate: origmsg.gate$,
      caller: origmsg.caller$,
      actdef: actdef,

      // these are transitional as need to be updated
      // to standard transport metadata
      client: actdef.client,
      listen: !!transport.origin,
      transport: transport,
    },
    ctxt
  )
}

exports.make_standard_err_log_entry = function (err, ctxt) {
  if (!err) return ctxt

  if (err.details && ctxt && ctxt.caller) {
    err.details.caller = ctxt.caller
  }

  let entry = Object.assign(
    {
      notice: err.message,
      code: err.code,
      err: err,
    },
    ctxt
  )

  return entry
}

exports.resolve_option = function (value, options) {
  return 'function' === typeof value ? value(options) : value
}

exports.autoincr = function () {
  var counter = 0
  return function () {
    return counter++
  }
}

// Callpoint resolver. Indicates location in calling code.
exports.make_callpoint = function (active) {
  return function callpoint(override) {
    if (active || override) {
      return error.callpoint(new Error(), [
        '/ordu.js',
        '/seneca/seneca.js',
        '/seneca/lib/',
        '/lodash.js',
      ])
    } else {
      return void 0
    }
  }
}

exports.make_trace_desc = function (meta) {
  return [
    meta.pattern,
    meta.id,
    meta.instance,
    meta.tag,
    meta.version,
    meta.start,
    meta.end,
    meta.sync,
    meta.action,
  ]
}

exports.TRACE_PATTERN = 0
exports.TRACE_ID = 1
exports.TRACE_INSTANCE = 2
exports.TRACE_TAG = 3
exports.TRACE_VERSION = 4
exports.TRACE_START = 5
exports.TRACE_END = 6
exports.TRACE_SYNC = 7
exports.TRACE_ACTION = 8

exports.history = function history(opts) {
  return new History(opts)
}

function History(opts) {
  var self = this
  opts = opts || {}

  this._total = 0
  this._list = []
  this._map = {}

  if (opts.prune) {
    this._prune_interval = setInterval(function () {
      self.prune(Date.now())
    }, opts.interval || 100)
    if (this._prune_interval.unref) {
      this._prune_interval.unref()
    }
  }
}

History.prototype.stats = function stats() {
  return {
    total: this._total,
  }
}

History.prototype.add = function add(obj) {
  this._map[obj.id] = obj

  var i = this._list.length - 1

  if (i < 0 || this._list[i].timelimit <= obj.timelimit) {
    this._list.push(obj)
  } else {
    i = this.place(obj.timelimit)
    this._list.splice(i, 0, obj)
  }
}

History.prototype.place = function place(timelimit) {
  var i = this._list.length
  var s = 0
  var e = i

  if (0 === this._list.length) {
    return 0
  }

  do {
    i = Math.floor((s + e) / 2)

    if (timelimit > this._list[i].timelimit) {
      s = i + 1
      i = s
    } else if (timelimit < this._list[i].timelimit) {
      e = i
    } else {
      i++
      break
    }
  } while (s < e)

  return i
}

History.prototype.prune = function prune(timelimit) {
  var i = this.place(timelimit)
  if (0 <= i && i <= this._list.length) {
    for (var j = 0; j < i; j++) {
      delete this._map[this._list[j].id]
    }
    this._list = this._list.slice(i)
  }
}

History.prototype.get = function get(id) {
  return this._map[id] || null
}

History.prototype.list = function list() {
  return this._list
}

History.prototype.close = function close() {
  if (this._prune_interval) {
    clearInterval(this._prune_interval)
  }
}

History.prototype.toString = function toString() {
  return Util.inspect({
    total: this._total,
    map: this._map,
    list: this._list,
  })
}

History.prototype[Util.inspect.custom] = History.prototype.toString
