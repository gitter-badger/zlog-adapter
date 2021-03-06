'use strict';
module.exports = centre;

var debug = require('debug')
  , utils = require('./utils')
  , onHeaders = require('on-headers')
  , http = require('http')
  , url = require('url')
  , onFinished = require('on-finished')
  , conf = require('../../conf')
  , _ = require('type-util')
  ;

function centre(creds, options/*, request*/){
  var base = {input:creds.ibase};
  var opts = options || {};
  var immediate = opts.immediate;
  var sURL = creds.host;
  if(!sURL) throw new Error('Define server url first');
  var skip = opts.SKIP || creds.configs.SKIP || false;
  var skipCode = opts.SKIP_CODE || creds.configs.SKIP_CODE || false;
  return function logger(req, res, next){
    var pre_write = res.write,
        pre_end = res.end;
    var data = [];
    res.write = function (chunk) {
      data.push(chunk);
      pre_write.apply(res, arguments);
    };
   res.end = function (chunk) {
      if (chunk) data.push(chunk);
      res.body = getBody(res, data);
      pre_end.apply(res, arguments);
      req._startAt = undefined
      req._startTime = undefined
      req._remoteAddress = getip(req)
      // req._tags = getTags(req, options.TAGS)
      // response data
      res._startAt = undefined
      res._startTime = undefined
      // record request start
      recordStartTime.call(req)
      if(immediate) { logRequest(); }
      else {
        onFinished(res, logRequest);
        onHeaders(res, recordStartTime);
      }
      function logRequest(){
        if(skipCode){
          if(utils.compair(parseInt(res.statusCode), skipCode))
          return next();
        }
        if(skip){
          if(utils.typeof(skip) == 'function' && skip(req, res)) return next();
          var path = (req.route) ? req.route.path : req.path;
          if(skip[path]){
            var sObj = skip[path];
            if(utils.typeof(sObj) == 'bool' && sObj) return next();
            if( utils.isObject(sObj)){
              var _rslt = [], opr = (sObj.OPR||'').toUpperCase() || 'OR'; 
              if( sObj.CODE ) _rslt.push( utils.compair(parseInt(res.statusCode), sObj.CODE) );
              if( sObj.METHOD ){ _rslt.push( utils.compair(req.method, sObj.METHOD) );}          
              if(opr == 'OR' && utils.OR(_rslt, true)) return next();
              else if(utils.AND(_rslt, false)) return next();
            }
            if(_.isInt(sObj)) { if(utils.compair(parseInt(res.statusCode), sObj)) return next();  }          
          }
        }
        if(opts.debug){
          console.log('log: ', path, res.statusCode, req.params, req.query);
          return;
        }
        if(res.body != 404) _process({req:req, res:res, base: base}, creds, opts);
      }
      };

      next();
  }

}

function _process(obj, creds, options){
  var base = obj.base;
   var mbody = {};
   mbody.msg = {
     response:obj.res.statusCode != 304 ? JSON.parse(obj.res.body) : undefined,
     request:{
       body:{
         body:obj.req.body, 
         query:obj.req.query,
         params:obj.req.params
       }
       , ipxf:xforwardip(obj.req)
       , headers: obj.req.headers
       , ip:obj.req._remoteAddress
       , timestamp:new Date().toISOString()
       , tags:getTags(obj.req, options.TAGS || creds.configs.TAGS) 
       , route:(obj.req.route) ? obj.req.route : {path:obj.req.path}
       , originalUrl : obj.req.originalUrl
     }
   };
   mbody.token = creds.configs.apiKey;
   mbody.app_id = creds.configs.appId;
   mbody.code = mbody.msg.mcode = parseInt(obj.res.statusCode);
   mbody = ext(obj, mbody);
   _sendRequest()({body:mbody, url:creds.host+base.input, timeout:creds.configs.timeout, method:"POST"}, function(err,res, data){  console.log(err ? err: data ? data : 'empty');  });
}

function ext(obj, mObj){
   for(var v in obj){ if(conf.CB_CRITERIA[v] === obj[v]) mObj[v] = conf.CB_CRITERIA[v].valid(obj[v]);   }
   for(var index in conf.EXEC_CRITERIA.CONFIGURED){  mObj[conf.EXEC_CRITERIA.CONFIGURED[index]] = true; }
   return mObj;
};

/**
 * Record the start time.
 * @private
 */

function recordStartTime() {
  this._startAt = process.hrtime()
  this._startTime = new Date()
}

/**
 * Get request IP address.
 *
 * @private
 * @param {IncomingMessage} req
 * @return {string}
 */

function getip(req) {
  return req.ip
    || req._remoteAddress
    || (req.connection && req.connection.remoteAddress)
    || undefined;
}

function xforwardip(req){
    var ipAddress;
    var forwardedIpsStr = req.header('x-forwarded-for'); 
    if (forwardedIpsStr) {
      var forwardedIps = forwardedIpsStr.split(',');
      ipAddress = forwardedIps[0];
    }
    if (!ipAddress) {
      ipAddress = req.connection.remoteAddress;
    }
    return ipAddress;
}

function getTags(req, tags){
  tags = tags || {};
  return { splitter : tags.SPLITTER || '>',tags: tags[req.route.path || req.path] } || {};
}

function getBody(res, data){
  if(typeof data[0] == 'string') return data[0].split(' ')[0] != 'Cannot' ? Buffer.concat(data).toString('utf8') : 404;
  if(typeof data[0] != 'string') return Buffer.concat(data).toString('utf8');
}

function _sendRequest(){
  return function request(params, cb) {
    var http_params = { headers:{ 'Content-Type': 'application/json' } };
    var url_parts = url.parse(params.url);
    if(params.headers) for(var i in params.headers) http_params.headers[i] = params.headers[i];
    http_params.method = params.method || "GET";
    for(var i in {path:1, port:1, hostname:1, protocol:1}) if(url_parts[i] != undefined) http_params[i] = url_parts[i];
    if(['http:', 'https:'].indexOf(http_params.protocol) == -1)http_params.protocol = 'http:';
    var DATA = "";
    var req = http.request(http_params, function(res){
      res.setEncoding('utf8');
      res.on('data', function (body){ if(body) DATA+=body; });
      res.on('end', function (body){ if(body) DATA+=body; return cb(null, DATA); });
    });
    req.on('error', function(e) { return cb(e.message || e); });
    if(params.body) req.write(JSON.stringify(params.body));
    req.end();
  }
}