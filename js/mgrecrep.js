"use strict";
/**
 * instrument mongoose to record/replay queries (!! only queries so far)
 *
 * allows to run (mongoose read only) unit tests w.o. a mongoose instance
 *
 * @file
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.instrumentMongoose = exports.instrumentModelReplay = exports.instrumentModelRecord = exports.retrieveOp = exports.recordOp = exports.digestArgs = exports.instrumentModel = exports.JSONStringify = exports.JSONParse = void 0;
const debugf = require("debugf");
var debuglog = debugf('mongoose_record_replay');
const path = require('path');
const process = require("process");
const mongoose = require("mongoose");
const events = require("events");
const fs = require("fs");
const crypto = require('crypto');
/**
 * The recording path, set via argument
 * or
 */
function JSONParse(text) {
    function customDeSer(key, value) {
        if (value.toString().indexOf("__REGEXP ") == 0) {
            var m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
            return new RegExp(m[1], m[2] || "");
        }
        else
            return value;
    }
    return JSON.parse(text, customDeSer);
}
exports.JSONParse = JSONParse;
function JSONStringify(obj) {
    function customSer(key, value) {
        if (value instanceof RegExp) {
            return ("__REGEXP " + value.toString());
        }
        else
            return value;
    }
    return JSON.stringify(obj, customSer, 2);
}
exports.JSONStringify = JSONStringify;
function readFileAsJSON(filename) {
    try {
        var data = fs.readFileSync(filename, 'utf-8');
        return JSON.parse(data);
    }
    catch (e) {
        console.log("Content of file " + filename + " is no json" + e);
        throw new Error("Content of file " + filename + " is no json" + e);
    }
    return undefined;
}
function assurePath(path) {
    try {
        fs.mkdirSync(path);
    }
    catch (e) {
    }
    try {
        fs.mkdirSync(path + 'data');
    }
    catch (e) {
    }
}
var dbEmitter = new events.EventEmitter();
// unit test invoke this multiple times, avoid node js warning
dbEmitter.setMaxListeners(0);
function instrumentModel(model, recordingPath, theMode) {
    if (theMode === "RECORD") {
        instrumentModelRecord(model, recordingPath, theMode);
    }
    else if (theMode === "REPLAY") {
        // todo
        instrumentModelReplay(model, recordingPath);
    }
    return model;
}
exports.instrumentModel = instrumentModel;
function makeFileName(digest, recordingPath) {
    return (recordingPath + 'data/' + digest + '.json');
}
function digestArgs(op, name, query) {
    var md5sum = crypto.createHash('md5');
    debuglog('here the name ' + name);
    md5sum.update(op + name + JSONStringify(query));
    var digest = '' + md5sum.digest('hex');
    return digest;
}
exports.digestArgs = digestArgs;
function recordOp(op, name, query, res, recordingPath) {
    var digest = digestArgs(op, name, query);
    var resStr = JSON.stringify(res, undefined, 2);
    var len = 0;
    if (res && Array.isArray(res)) {
        len = res.length;
    }
    else {
        len = resStr.length;
    }
    var filename = makeFileName(digest, recordingPath);
    console.log('recording to file: ' + filename + ' (' + path.normalize(filename) + ')...');
    fs.writeFileSync(filename, resStr);
    var known = {};
    try {
        known = readFileAsJSON(recordingPath + 'queries.json');
    }
    catch (ex) {
    }
    known[digest] = {
        op: op,
        name: name,
        digest: digest,
        query: query,
        res: len
    };
    fs.writeFileSync(recordingPath + 'queries.json', JSONStringify(known));
}
exports.recordOp = recordOp;
function retrieveOp(op, name, query, recordingPath) {
    var digest = digestArgs(op, name, query);
    var filename = makeFileName(digest, recordingPath);
    debuglog(' reading from filename ' + filename);
    try {
        var res = readFileAsJSON(filename);
    }
    catch (e) {
        console.log(e);
        console.log(e.stack);
        console.log(`did not find query result recording (${filename}) \n for collection ${name} operation ${op} \n query arguments: ` + JSONStringify(query));
        throw e;
    }
    if (res === undefined) {
        debuglog('empty result for query ' + op + ' ' + JSON.stringify(query, undefined, 2) + '\n' + filename);
    }
    return res;
}
exports.retrieveOp = retrieveOp;
function instrumentModelRecord(modelDoc, recordingPath, theMode) {
    debuglog('mongoose_record_replay is instrumenting model ' + modelDoc.modelName + ' for recording to ' + recordingPath);
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog('someone is calling find with ' + modelDoc.modelName + JSON.stringify(arguments, undefined, 2));
        var res = oFind.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one argument in find, was ' + arguments.length);
        }
        var query = arguments[0];
        res.lean().exec().then((a) => {
            //console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("find", modelDoc.modelName, query, a, recordingPath);
        });
        return res;
    };
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function () {
        debuglog('someone is calling distinct with' + JSON.stringify(arguments, undefined, 2));
        var res = oDistinct.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one argument ' + JSON.stringify(arguments));
        }
        var query = arguments[0];
        var res2 = res.then((a) => {
            debuglog(() => "here result1 + " + JSON.stringify(a, undefined, 2));
            try {
                recordOp("distinct", modelDoc.modelName, query, a, recordingPath);
            }
            catch (ex) {
                console.log(' recording to file failed ' + ex);
                debuglog(() => " recording to file failed " + ex);
                throw ex;
            }
            return a;
        });
        return res; //res2.then((b) => { console.log(' 2nd promise then ' + b && b.length); return b; });
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog(() => 'someone is calling aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = oAggregate.apply(modelDoc, arguments);
        res.then((a) => {
            debuglog(() => "here result1 + " + JSON.stringify(a, undefined, 2));
            recordOp("aggregate", modelDoc.modelName, query, a, recordingPath);
        });
        return res;
    };
}
exports.instrumentModelRecord = instrumentModelRecord;
function instrumentModelReplay(modelDoc, recordingPath) {
    console.log('instrumenting model ' + modelDoc.modelName + ' for replay from path ' + recordingPath);
    debuglog('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog(() => 'someone is replaying find with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("find", modelDoc.modelName, query, recordingPath);
        debuglog(() => 'returning res ' + JSON.stringify(res) + ' for query find' + query);
        return {
            lean: function () {
                return {
                    exec: function () {
                        return new Promise(function (resolve, reject) {
                            setTimeout(function () {
                                resolve(res);
                            }, 0);
                        });
                    }
                };
            }
        };
    };
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function () {
        debuglog('someone is replaying distinct with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("distinct", modelDoc.modelName, query, recordingPath);
        debuglog('returning res ' + JSON.stringify(res) + ' for query find' + query);
        return new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog('someone is replaying aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = retrieveOp("aggregate", modelDoc.modelName, query, recordingPath);
        var p = new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
        p.exec = function () {
            return p;
        };
        return p;
    };
}
exports.instrumentModelReplay = instrumentModelReplay;
/**
 * funtion to instrument mongoose
 *
 *
 *
 * @param mongoose a real mongoose instance
 * @param [path] {string} optional, a path to write/read files from, defaults to "mgrecrep/"
 * @param mode {string}  undefined (environment value) or "REPLAY" or "RECORD"
 */
function instrumentMongoose(mongoose, path, mode) {
    debuglog(' instrument mongoose with  ' + path + "  " + mode);
    var theMode = mode || process.env.MONGO_RECORD_REPLAY;
    if (theMode && ["REPLAY", "RECORD"].indexOf(mode) < 0) {
        console.log('passed mode value or env MONGO_RECORD_REPLAY may only be "RECORD" or "REPLAY" , MONGO_RECORD MONGO_REPLAY');
        throw new Error('mongoose_record_replay mode should be one of "REPLAY", "RECORD"  was ' + theMode);
    }
    if (theMode === "RECORD") {
        var recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        console.log('!* mode RECORD to path ' + recordingPath + ' in ' + __dirname + " " + mode);
        assurePath(recordingPath);
        var omodel = mongoose.model;
        mongoose.model = function () {
            if (arguments.length > 1) {
                return instrumentModel(omodel.apply(mongoose, arguments), recordingPath, theMode);
            }
            return omodel.apply(mongoose, arguments);
        };
        return mongoose;
    }
    else if (theMode === "REPLAY") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        console.log('!* mode REPLAY from path ' + recordingPath + ' in ' + __dirname + " " + mode + " " + path);
        var r = makeMongooseMock(recordingPath, theMode);
        return r;
    }
    return mongoose;
}
exports.instrumentMongoose = instrumentMongoose;
var mocksPerPath = {};
function makeMongooseMock(recordingPath, theMode) {
    if (mocksPerPath[recordingPath] == undefined) {
        var res = {
            models: {},
            recordingPath: recordingPath,
            theMode: theMode,
            modelNames: function () {
                return Object.keys(this.models);
            },
            Schema: mongoose.Schema,
            model: function (a, b) {
                if (b === undefined) {
                    return this.models[a];
                }
                debuglog('creating model  ' + a + ' at mock');
                this.models[a] = instrumentModel({
                    find: function () { },
                    aggregate: function () { },
                    distinct: function () { },
                    modelName: a,
                    schema: b,
                }, this.recordingPath, this.theMode);
                return this.models[a];
            },
            disconnect: function () {
                debuglog('simulationg disconnect ');
            },
            connect: function (connStr) {
                // this.db.on.emit('on');
                debuglog('simulationg connecting to ' + connStr);
                if (!this._once) {
                    var that = this;
                    setTimeout(function () {
                        that.connection.emit('open');
                        debuglog('fired emit');
                    }, 0);
                }
            },
            connection: dbEmitter
        };
        mocksPerPath[recordingPath] = res;
    }
    return mocksPerPath[recordingPath];
}
/*export*/ /*var mongooseMock2 = {
    models: {},
    recordingPath : "",
    theMode : "",
    modelNames: function () {
        return Object.keys(this.models);
    },
    Schema: mongoose.Schema,

    model: function (a, b) {
        if (b === undefined) {
            return this.models[a];
        }
        debuglog('creating model  ' + a + ' at mock');
        this.models[a] = instrumentModel({
            find: function () { },
            aggregate: function () { },
            distinct: function () { },
            modelName: a,
            schema: b,
        } as any, this.recordingPath, this.theMode);
        return this.models[a];
    },
    disconnect: function () {
        debuglog('simulationg disconnect ');
    },
    connect: function (connStr: string) {
        // this.db.on.emit('on');
        debuglog('simulationg connecting to ' + connStr);
        if (!this._once) {
            var that = this;
            setTimeout(function () {
                that.connection.emit('open');
                debuglog('fired emit');
            }, 0);
        }
    },
    // e.g. set('useCreateIndex',true)
    set : function(a,b) {},
    connection: dbEmitter
};
*/ 

//# sourceMappingURL=data:application/json;charset=utf8;base64,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QUFFRCxVQUFVLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBeUNUIiwiZmlsZSI6Im1ncmVjcmVwLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIGluc3RydW1lbnQgbW9uZ29vc2UgdG8gcmVjb3JkL3JlcGxheSBxdWVyaWVzICghISBvbmx5IHF1ZXJpZXMgc28gZmFyKVxyXG4gKlxyXG4gKiBhbGxvd3MgdG8gcnVuIChtb25nb29zZSByZWFkIG9ubHkpIHVuaXQgdGVzdHMgdy5vLiBhIG1vbmdvb3NlIGluc3RhbmNlXHJcbiAqXHJcbiAqIEBmaWxlXHJcbiAqL1xyXG5cclxuaW1wb3J0ICogYXMgZGVidWdmIGZyb20gJ2RlYnVnZic7XHJcblxyXG52YXIgZGVidWdsb2cgPSBkZWJ1Z2YoJ21vbmdvb3NlX3JlY29yZF9yZXBsYXknKTtcclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmltcG9ydCAqIGFzIHByb2Nlc3MgZnJvbSAncHJvY2Vzcyc7XHJcbmltcG9ydCAqIGFzIG1vbmdvb3NlIGZyb20gJ21vbmdvb3NlJztcclxuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2V2ZW50cyc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuY29uc3QgY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyk7XHJcblxyXG4vKipcclxuICogVGhlIHJlY29yZGluZyBwYXRoLCBzZXQgdmlhIGFyZ3VtZW50XHJcbiAqIG9yXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gSlNPTlBhcnNlKHRleHQ6IHN0cmluZyk6IGFueSB7XHJcbiAgICBmdW5jdGlvbiBjdXN0b21EZVNlcihrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKHZhbHVlLnRvU3RyaW5nKCkuaW5kZXhPZihcIl9fUkVHRVhQIFwiKSA9PSAwKSB7XHJcbiAgICAgICAgICAgIHZhciBtID0gdmFsdWUuc3BsaXQoXCJfX1JFR0VYUCBcIilbMV0ubWF0Y2goL1xcLyguKilcXC8oLiopPy8pO1xyXG4gICAgICAgICAgICByZXR1cm4gbmV3IFJlZ0V4cChtWzFdLCBtWzJdIHx8IFwiXCIpO1xyXG4gICAgICAgIH0gZWxzZVxyXG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZSh0ZXh0LCBjdXN0b21EZVNlcik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBKU09OU3RyaW5naWZ5KG9iajogYW55KTogc3RyaW5nIHtcclxuICAgIGZ1bmN0aW9uIGN1c3RvbVNlcihrZXksIHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKXtcclxuICAgICAgICAgICAgcmV0dXJuIChcIl9fUkVHRVhQIFwiICsgdmFsdWUudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG9iaiwgY3VzdG9tU2VyLCAyKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVhZEZpbGVBc0pTT04oZmlsZW5hbWU6IHN0cmluZyk6IGFueSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHZhciBkYXRhID0gZnMucmVhZEZpbGVTeW5jKGZpbGVuYW1lLCAndXRmLTgnKTtcclxuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShkYXRhKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhcIkNvbnRlbnQgb2YgZmlsZSBcIiArIGZpbGVuYW1lICsgXCIgaXMgbm8ganNvblwiICsgZSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGVudCBvZiBmaWxlIFwiICsgZmlsZW5hbWUgKyBcIiBpcyBubyBqc29uXCIgKyBlKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBhc3N1cmVQYXRoKHBhdGg6IHN0cmluZykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBmcy5ta2RpclN5bmMocGF0aCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcblxyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgICBmcy5ta2RpclN5bmMocGF0aCArICdkYXRhJyk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcblxyXG4gICAgfVxyXG59XHJcblxyXG52YXIgZGJFbWl0dGVyID0gbmV3IGV2ZW50cy5FdmVudEVtaXR0ZXIoKTtcclxuLy8gdW5pdCB0ZXN0IGludm9rZSB0aGlzIG11bHRpcGxlIHRpbWVzLCBhdm9pZCBub2RlIGpzIHdhcm5pbmdcclxuZGJFbWl0dGVyLnNldE1heExpc3RlbmVycygwKTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVtZW50TW9kZWwobW9kZWw6IG1vbmdvb3NlLk1vZGVsPGFueT4sIHJlY29yZGluZ1BhdGggOiBzdHJpbmcsIHRoZU1vZGU6IHN0cmluZykge1xyXG4gICAgaWYgKHRoZU1vZGUgPT09IFwiUkVDT1JEXCIpIHtcclxuICAgICAgICBpbnN0cnVtZW50TW9kZWxSZWNvcmQobW9kZWwsIHJlY29yZGluZ1BhdGgsIHRoZU1vZGUpO1xyXG4gICAgfSBlbHNlIGlmICh0aGVNb2RlID09PSBcIlJFUExBWVwiKSB7XHJcbiAgICAgICAgLy8gdG9kb1xyXG4gICAgICAgIGluc3RydW1lbnRNb2RlbFJlcGxheShtb2RlbCwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbW9kZWw7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBtYWtlRmlsZU5hbWUoZGlnZXN0LCByZWNvcmRpbmdQYXRoOiBzdHJpbmcpIHtcclxuICAgIHJldHVybiAocmVjb3JkaW5nUGF0aCArICdkYXRhLycgKyBkaWdlc3QgKyAnLmpzb24nKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRpZ2VzdEFyZ3Mob3A6IHN0cmluZywgbmFtZSA6IHN0cmluZywgcXVlcnkgOiBhbnkpIHtcclxuICAgIHZhciBtZDVzdW0gPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1Jyk7XHJcbiAgICBkZWJ1Z2xvZygnaGVyZSB0aGUgbmFtZSAnICsgbmFtZSk7XHJcbiAgICBtZDVzdW0udXBkYXRlKG9wICsgbmFtZSArIEpTT05TdHJpbmdpZnkocXVlcnkpKTtcclxuICAgIHZhciBkaWdlc3QgPSAnJyArIG1kNXN1bS5kaWdlc3QoJ2hleCcpO1xyXG4gICAgcmV0dXJuIGRpZ2VzdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZE9wKG9wOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgcmVzOiBhbnksIHJlY29yZGluZ1BhdGggOiBzdHJpbmcpIHtcclxuICAgIHZhciBkaWdlc3QgPSBkaWdlc3RBcmdzKG9wLG5hbWUscXVlcnkpO1xyXG4gICAgdmFyIHJlc1N0ciA9IEpTT04uc3RyaW5naWZ5KHJlcywgdW5kZWZpbmVkLCAyKTtcclxuICAgIHZhciBsZW4gPSAwO1xyXG4gICAgaWYocmVzICYmIEFycmF5LmlzQXJyYXkocmVzKSkge1xyXG4gICAgICAgIGxlbiA9IHJlcy5sZW5ndGg7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxlbiA9IHJlc1N0ci5sZW5ndGg7XHJcbiAgICB9XHJcbiAgICB2YXIgZmlsZW5hbWUgPSBtYWtlRmlsZU5hbWUoZGlnZXN0LCByZWNvcmRpbmdQYXRoKTtcclxuICAgIGNvbnNvbGUubG9nKCAncmVjb3JkaW5nIHRvIGZpbGU6ICcgKyBmaWxlbmFtZSArICcgKCcgKyBwYXRoLm5vcm1hbGl6ZShmaWxlbmFtZSkgKyAnKS4uLicpO1xyXG4gICAgZnMud3JpdGVGaWxlU3luYyhmaWxlbmFtZSwgcmVzU3RyKTtcclxuICAgIHZhciBrbm93biA9IHt9O1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBrbm93biA9IHJlYWRGaWxlQXNKU09OKHJlY29yZGluZ1BhdGggKyAncXVlcmllcy5qc29uJyk7XHJcbiAgICB9IGNhdGNoIChleCkge1xyXG5cclxuICAgIH1cclxuICAgIGtub3duW2RpZ2VzdF0gPSB7XHJcbiAgICAgICAgb3A6IG9wLFxyXG4gICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgZGlnZXN0OiBkaWdlc3QsXHJcbiAgICAgICAgcXVlcnk6IHF1ZXJ5LFxyXG4gICAgICAgIHJlcyA6IGxlblxyXG4gICAgfTtcclxuICAgIGZzLndyaXRlRmlsZVN5bmMocmVjb3JkaW5nUGF0aCArICdxdWVyaWVzLmpzb24nLCBKU09OU3RyaW5naWZ5KGtub3duKSk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZXRyaWV2ZU9wKG9wOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgcmVjb3JkaW5nUGF0aCA6IHN0cmluZykge1xyXG4gICAgdmFyIGRpZ2VzdCA9IGRpZ2VzdEFyZ3Mob3AsbmFtZSwgcXVlcnkpO1xyXG4gICAgdmFyIGZpbGVuYW1lID0gbWFrZUZpbGVOYW1lKGRpZ2VzdCwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICBkZWJ1Z2xvZygnIHJlYWRpbmcgZnJvbSBmaWxlbmFtZSAnICsgZmlsZW5hbWUpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICB2YXIgcmVzID0gcmVhZEZpbGVBc0pTT04oZmlsZW5hbWUpO1xyXG4gICAgfSBjYXRjaChlKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coZSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coZS5zdGFjayk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYGRpZCBub3QgZmluZCBxdWVyeSByZXN1bHQgcmVjb3JkaW5nICgke2ZpbGVuYW1lfSkgXFxuIGZvciBjb2xsZWN0aW9uICR7bmFtZX0gb3BlcmF0aW9uICR7b3B9IFxcbiBxdWVyeSBhcmd1bWVudHM6IGAgKyBKU09OU3RyaW5naWZ5KHF1ZXJ5KSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgIH1cclxuICAgIGlmIChyZXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGRlYnVnbG9nKCdlbXB0eSByZXN1bHQgZm9yIHF1ZXJ5ICcgKyBvcCArICcgJyArIEpTT04uc3RyaW5naWZ5KHF1ZXJ5LCB1bmRlZmluZWQsIDIpICsgJ1xcbicgKyBmaWxlbmFtZSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaW5zdHJ1bWVudE1vZGVsUmVjb3JkKG1vZGVsRG9jOiBtb25nb29zZS5Nb2RlbDxhbnk+LCByZWNvcmRpbmdQYXRoOiBzdHJpbmcsIHRoZU1vZGU6IHN0cmluZykge1xyXG4gICAgZGVidWdsb2coJ21vbmdvb3NlX3JlY29yZF9yZXBsYXkgaXMgaW5zdHJ1bWVudGluZyBtb2RlbCAnICsgbW9kZWxEb2MubW9kZWxOYW1lICsgJyBmb3IgcmVjb3JkaW5nIHRvICcgKyByZWNvcmRpbmdQYXRoICk7XHJcbiAgICB2YXIgb0ZpbmQgPSBtb2RlbERvYy5maW5kO1xyXG4gICAgbW9kZWxEb2MuZmluZCA9IGZ1bmN0aW9uICgpOiBhbnkge1xyXG4gICAgICAgIGRlYnVnbG9nKCdzb21lb25lIGlzIGNhbGxpbmcgZmluZCB3aXRoICcgKyBtb2RlbERvYy5tb2RlbE5hbWUgKyBKU09OLnN0cmluZ2lmeShhcmd1bWVudHMsIHVuZGVmaW5lZCwgMikpO1xyXG4gICAgICAgIHZhciByZXMgPSBvRmluZC5hcHBseShtb2RlbERvYywgYXJndW1lbnRzKTtcclxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCAhPT0gMSkge1xyXG4gICAgICAgICAgICB0aHJvdyBFcnJvcignZXhwZWN0ZWQgb25lIGFyZ3VtZW50IGluIGZpbmQsIHdhcyAnICsgYXJndW1lbnRzLmxlbmd0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHZhciBxdWVyeSA9IGFyZ3VtZW50c1swXTtcclxuICAgICAgICByZXMubGVhbigpLmV4ZWMoKS50aGVuKChhKSA9PiB7XHJcbiAgICAgICAgICAgIC8vY29uc29sZS5sb2coXCJoZXJlIHJlc3VsdDEgKyBcIiArIEpTT04uc3RyaW5naWZ5KGEsIHVuZGVmaW5lZCwyKSApO1xyXG4gICAgICAgICAgICByZWNvcmRPcChcImZpbmRcIiwgbW9kZWxEb2MubW9kZWxOYW1lLCBxdWVyeSwgYSwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIHJlcztcclxuICAgIH1cclxuICAgIHZhciBvRGlzdGluY3QgPSBtb2RlbERvYy5kaXN0aW5jdDtcclxuICAgIG1vZGVsRG9jLmRpc3RpbmN0ID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coJ3NvbWVvbmUgaXMgY2FsbGluZyBkaXN0aW5jdCB3aXRoJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHJlcyA9IG9EaXN0aW5jdC5hcHBseShtb2RlbERvYywgYXJndW1lbnRzKTtcclxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCAhPT0gMSkge1xyXG4gICAgICAgICAgICB0aHJvdyBFcnJvcignZXhwZWN0ZWQgb25lIGFyZ3VtZW50ICcgKyBKU09OLnN0cmluZ2lmeShhcmd1bWVudHMpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYXJndW1lbnRzWzBdO1xyXG4gICAgICAgIHZhciByZXMyID0gcmVzLnRoZW4oKGEpID0+IHtcclxuICAgICAgICAgICAgZGVidWdsb2coICgpID0+IFwiaGVyZSByZXN1bHQxICsgXCIgKyBKU09OLnN0cmluZ2lmeShhLCB1bmRlZmluZWQsMikgKTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIHJlY29yZE9wKFwiZGlzdGluY3RcIiwgbW9kZWxEb2MubW9kZWxOYW1lLCBxdWVyeSwgYSwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2goIGV4KVxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyggJyByZWNvcmRpbmcgdG8gZmlsZSBmYWlsZWQgJyArIGV4ICk7XHJcbiAgICAgICAgICAgICAgICBkZWJ1Z2xvZyggKCkgPT4gXCIgcmVjb3JkaW5nIHRvIGZpbGUgZmFpbGVkIFwiICsgZXggKTtcclxuICAgICAgICAgICAgICAgIHRocm93IGV4O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBhO1xyXG4gICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIHJldHVybiByZXM7IC8vcmVzMi50aGVuKChiKSA9PiB7IGNvbnNvbGUubG9nKCcgMm5kIHByb21pc2UgdGhlbiAnICsgYiAmJiBiLmxlbmd0aCk7IHJldHVybiBiOyB9KTtcclxuICAgIH1cclxuICAgIHZhciBvQWdncmVnYXRlID0gbW9kZWxEb2MuYWdncmVnYXRlO1xyXG4gICAgbW9kZWxEb2MuYWdncmVnYXRlID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coKCkgPT4gJ3NvbWVvbmUgaXMgY2FsbGluZyBhZ2dyZWdhdGUgd2l0aCcgKyBKU09OLnN0cmluZ2lmeShhcmd1bWVudHMsIHVuZGVmaW5lZCwgMikpO1xyXG4gICAgICAgIHZhciBxdWVyeSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XHJcbiAgICAgICAgdmFyIHJlcyA9IG9BZ2dyZWdhdGUuYXBwbHkobW9kZWxEb2MsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgcmVzLnRoZW4oKGEpID0+IHtcclxuICAgICAgICAgICAgZGVidWdsb2coKCkgPT4gXCJoZXJlIHJlc3VsdDEgKyBcIiArIEpTT04uc3RyaW5naWZ5KGEsIHVuZGVmaW5lZCwgMikpO1xyXG4gICAgICAgICAgICByZWNvcmRPcChcImFnZ3JlZ2F0ZVwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCBhLCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICByZXR1cm4gcmVzO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaW5zdHJ1bWVudE1vZGVsUmVwbGF5KG1vZGVsRG9jOiBtb25nb29zZS5Nb2RlbDxhbnk+LCByZWNvcmRpbmdQYXRoOiBzdHJpbmcpIHtcclxuICAgIGNvbnNvbGUubG9nKCdpbnN0cnVtZW50aW5nIG1vZGVsICcgKyBtb2RlbERvYy5tb2RlbE5hbWUgKyAnIGZvciByZXBsYXkgZnJvbSBwYXRoICcgKyByZWNvcmRpbmdQYXRoICk7XHJcbiAgICBkZWJ1Z2xvZygnaW5zdHJ1bWVudGluZyBtb2RlbCAnICsgbW9kZWxEb2MubW9kZWxOYW1lKTtcclxuICAgIHZhciBvRmluZCA9IG1vZGVsRG9jLmZpbmQ7XHJcbiAgICBtb2RlbERvYy5maW5kID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coKCkgPT4gJ3NvbWVvbmUgaXMgcmVwbGF5aW5nIGZpbmQgd2l0aCcgKyBKU09OLnN0cmluZ2lmeShhcmd1bWVudHMsIHVuZGVmaW5lZCwgMikpO1xyXG4gICAgICAgIHZhciBxdWVyeSA9IGFyZ3VtZW50c1swXTtcclxuICAgICAgICB2YXIgcmVzID0gcmV0cmlldmVPcChcImZpbmRcIiwgbW9kZWxEb2MubW9kZWxOYW1lLCBxdWVyeSwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICAgICAgZGVidWdsb2coKCkgPT4gJ3JldHVybmluZyByZXMgJyArIEpTT04uc3RyaW5naWZ5KHJlcykgKyAnIGZvciBxdWVyeSBmaW5kJyArIHF1ZXJ5KTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBsZWFuOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGV4ZWM6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICB2YXIgb0Rpc3RpbmN0ID0gbW9kZWxEb2MuZGlzdGluY3Q7XHJcbiAgICBtb2RlbERvYy5kaXN0aW5jdCA9IGZ1bmN0aW9uICgpOiBhbnkge1xyXG4gICAgICAgIGRlYnVnbG9nKCdzb21lb25lIGlzIHJlcGxheWluZyBkaXN0aW5jdCB3aXRoJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYXJndW1lbnRzWzBdO1xyXG4gICAgICAgIHZhciByZXMgPSByZXRyaWV2ZU9wKFwiZGlzdGluY3RcIiwgbW9kZWxEb2MubW9kZWxOYW1lLCBxdWVyeSwgcmVjb3JkaW5nUGF0aCk7XHJcbiAgICAgICAgZGVidWdsb2coJ3JldHVybmluZyByZXMgJyArIEpTT04uc3RyaW5naWZ5KHJlcykgKyAnIGZvciBxdWVyeSBmaW5kJyArIHF1ZXJ5KTtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgcmVzb2x2ZShyZXMpOyB9LCAwKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIHZhciBvQWdncmVnYXRlID0gbW9kZWxEb2MuYWdncmVnYXRlO1xyXG4gICAgbW9kZWxEb2MuYWdncmVnYXRlID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coJ3NvbWVvbmUgaXMgcmVwbGF5aW5nIGFnZ3JlZ2F0ZSB3aXRoJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcclxuICAgICAgICB2YXIgcmVzID0gcmV0cmlldmVPcChcImFnZ3JlZ2F0ZVwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7IHJlc29sdmUocmVzKTsgfSwgMCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgKHAgYXMgYW55KS5leGVjID0gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gcDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHA7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBmdW50aW9uIHRvIGluc3RydW1lbnQgbW9uZ29vc2VcclxuICpcclxuICpcclxuICpcclxuICogQHBhcmFtIG1vbmdvb3NlIGEgcmVhbCBtb25nb29zZSBpbnN0YW5jZVxyXG4gKiBAcGFyYW0gW3BhdGhdIHtzdHJpbmd9IG9wdGlvbmFsLCBhIHBhdGggdG8gd3JpdGUvcmVhZCBmaWxlcyBmcm9tLCBkZWZhdWx0cyB0byBcIm1ncmVjcmVwL1wiXHJcbiAqIEBwYXJhbSBtb2RlIHtzdHJpbmd9ICB1bmRlZmluZWQgKGVudmlyb25tZW50IHZhbHVlKSBvciBcIlJFUExBWVwiIG9yIFwiUkVDT1JEXCJcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVtZW50TW9uZ29vc2UobW9uZ29vc2U6IG1vbmdvb3NlLk1vbmdvb3NlLCBwYXRoOiBzdHJpbmcsIG1vZGU/OiBzdHJpbmcpOiBtb25nb29zZS5Nb25nb29zZSB7XHJcbiAgICBkZWJ1Z2xvZygnIGluc3RydW1lbnQgbW9uZ29vc2Ugd2l0aCAgJyArIHBhdGggKyBcIiAgXCIgKyBtb2RlKTtcclxuICAgIHZhciB0aGVNb2RlID0gbW9kZSB8fCBwcm9jZXNzLmVudi5NT05HT19SRUNPUkRfUkVQTEFZO1xyXG4gICAgaWYgKHRoZU1vZGUgJiYgW1wiUkVQTEFZXCIsIFwiUkVDT1JEXCJdLmluZGV4T2YobW9kZSkgPCAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3Bhc3NlZCBtb2RlIHZhbHVlIG9yIGVudiBNT05HT19SRUNPUkRfUkVQTEFZIG1heSBvbmx5IGJlIFwiUkVDT1JEXCIgb3IgXCJSRVBMQVlcIiAsIE1PTkdPX1JFQ09SRCBNT05HT19SRVBMQVknKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ21vbmdvb3NlX3JlY29yZF9yZXBsYXkgbW9kZSBzaG91bGQgYmUgb25lIG9mIFwiUkVQTEFZXCIsIFwiUkVDT1JEXCIgIHdhcyAnICsgdGhlTW9kZSk7XHJcbiAgICB9XHJcbiAgICBpZiAodGhlTW9kZSA9PT0gXCJSRUNPUkRcIikge1xyXG4gICAgICAgIHZhciByZWNvcmRpbmdQYXRoID0gcGF0aCB8fCBwcm9jZXNzLmVudi5NT05HT19SRUNPUkRfUkVQTEFZX1BBVEggfHwgXCJtb25nb29zZV9yZWNvcmRfcmVwbGF5XCI7XHJcbiAgICAgICAgY29uc29sZS5sb2coICchKiBtb2RlIFJFQ09SRCB0byBwYXRoICcgKyByZWNvcmRpbmdQYXRoICArICcgaW4gJyArIF9fZGlybmFtZSArIFwiIFwiICArIG1vZGUgKTtcclxuICAgICAgICBhc3N1cmVQYXRoKHJlY29yZGluZ1BhdGgpO1xyXG4gICAgICAgIHZhciBvbW9kZWwgPSBtb25nb29zZS5tb2RlbDtcclxuICAgICAgICBtb25nb29zZS5tb2RlbCA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5zdHJ1bWVudE1vZGVsKG9tb2RlbC5hcHBseShtb25nb29zZSwgYXJndW1lbnRzKSxyZWNvcmRpbmdQYXRoLHRoZU1vZGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBvbW9kZWwuYXBwbHkobW9uZ29vc2UsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBtb25nb29zZTtcclxuICAgIH0gZWxzZSBpZiAodGhlTW9kZSA9PT0gXCJSRVBMQVlcIikge1xyXG4gICAgICAgIHJlY29yZGluZ1BhdGggPSBwYXRoIHx8IHByb2Nlc3MuZW52Lk1PTkdPX1JFQ09SRF9SRVBMQVlfUEFUSCB8fCBcIm1vbmdvb3NlX3JlY29yZF9yZXBsYXlcIjtcclxuICAgICAgICBjb25zb2xlLmxvZyggJyEqIG1vZGUgUkVQTEFZIGZyb20gcGF0aCAnICsgcmVjb3JkaW5nUGF0aCAgKyAnIGluICcgKyBfX2Rpcm5hbWUgKyBcIiBcIiAgKyBtb2RlICArIFwiIFwiICsgcGF0aCk7XHJcbiAgICAgICAgdmFyIHIgPSBtYWtlTW9uZ29vc2VNb2NrKHJlY29yZGluZ1BhdGgsdGhlTW9kZSk7XHJcbiAgICAgICAgcmV0dXJuIHI7IFxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG1vbmdvb3NlO1xyXG59XHJcblxyXG52YXIgbW9ja3NQZXJQYXRoID0ge307XHJcblxyXG5mdW5jdGlvbiBtYWtlTW9uZ29vc2VNb2NrKHJlY29yZGluZ1BhdGg6IHN0cmluZywgdGhlTW9kZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIG1vY2tzUGVyUGF0aFtyZWNvcmRpbmdQYXRoXSA9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgcmVzID0ge1xyXG4gICAgICAgICAgICBtb2RlbHM6IHt9LFxyXG4gICAgICAgICAgICByZWNvcmRpbmdQYXRoIDogcmVjb3JkaW5nUGF0aCxcclxuICAgICAgICAgICAgdGhlTW9kZSA6IHRoZU1vZGUsXHJcbiAgICAgICAgICAgIG1vZGVsTmFtZXM6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLm1vZGVscyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIFNjaGVtYTogbW9uZ29vc2UuU2NoZW1hLFxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICBtb2RlbDogZnVuY3Rpb24gKGEsIGIpIHtcclxuICAgICAgICAgICAgICAgIGlmIChiID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5tb2RlbHNbYV07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBkZWJ1Z2xvZygnY3JlYXRpbmcgbW9kZWwgICcgKyBhICsgJyBhdCBtb2NrJyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLm1vZGVsc1thXSA9IGluc3RydW1lbnRNb2RlbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZmluZDogZnVuY3Rpb24gKCkgeyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZTogZnVuY3Rpb24gKCkgeyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGRpc3RpbmN0OiBmdW5jdGlvbiAoKSB7IH0sXHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWxOYW1lOiBhLFxyXG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYTogYixcclxuICAgICAgICAgICAgICAgIH0gYXMgYW55LCB0aGlzLnJlY29yZGluZ1BhdGgsIHRoaXMudGhlTW9kZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5tb2RlbHNbYV07XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGRpc2Nvbm5lY3Q6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIGRlYnVnbG9nKCdzaW11bGF0aW9uZyBkaXNjb25uZWN0ICcpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBjb25uZWN0OiBmdW5jdGlvbiAoY29ublN0cjogc3RyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAvLyB0aGlzLmRiLm9uLmVtaXQoJ29uJyk7XHJcbiAgICAgICAgICAgICAgICBkZWJ1Z2xvZygnc2ltdWxhdGlvbmcgY29ubmVjdGluZyB0byAnICsgY29ublN0cik7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuX29uY2UpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoYXQuY29ubmVjdGlvbi5lbWl0KCdvcGVuJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlYnVnbG9nKCdmaXJlZCBlbWl0Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGNvbm5lY3Rpb246IGRiRW1pdHRlclxyXG4gICAgICAgIH07XHJcbiAgICAgICAgbW9ja3NQZXJQYXRoW3JlY29yZGluZ1BhdGhdID0gcmVzO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG1vY2tzUGVyUGF0aFtyZWNvcmRpbmdQYXRoXTtcclxufVxyXG5cclxuLypleHBvcnQqLyAvKnZhciBtb25nb29zZU1vY2syID0ge1xyXG4gICAgbW9kZWxzOiB7fSxcclxuICAgIHJlY29yZGluZ1BhdGggOiBcIlwiLFxyXG4gICAgdGhlTW9kZSA6IFwiXCIsXHJcbiAgICBtb2RlbE5hbWVzOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMubW9kZWxzKTtcclxuICAgIH0sXHJcbiAgICBTY2hlbWE6IG1vbmdvb3NlLlNjaGVtYSxcclxuXHJcbiAgICBtb2RlbDogZnVuY3Rpb24gKGEsIGIpIHtcclxuICAgICAgICBpZiAoYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm1vZGVsc1thXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZGVidWdsb2coJ2NyZWF0aW5nIG1vZGVsICAnICsgYSArICcgYXQgbW9jaycpO1xyXG4gICAgICAgIHRoaXMubW9kZWxzW2FdID0gaW5zdHJ1bWVudE1vZGVsKHtcclxuICAgICAgICAgICAgZmluZDogZnVuY3Rpb24gKCkgeyB9LFxyXG4gICAgICAgICAgICBhZ2dyZWdhdGU6IGZ1bmN0aW9uICgpIHsgfSxcclxuICAgICAgICAgICAgZGlzdGluY3Q6IGZ1bmN0aW9uICgpIHsgfSxcclxuICAgICAgICAgICAgbW9kZWxOYW1lOiBhLFxyXG4gICAgICAgICAgICBzY2hlbWE6IGIsXHJcbiAgICAgICAgfSBhcyBhbnksIHRoaXMucmVjb3JkaW5nUGF0aCwgdGhpcy50aGVNb2RlKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5tb2RlbHNbYV07XHJcbiAgICB9LFxyXG4gICAgZGlzY29ubmVjdDogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIGRlYnVnbG9nKCdzaW11bGF0aW9uZyBkaXNjb25uZWN0ICcpO1xyXG4gICAgfSxcclxuICAgIGNvbm5lY3Q6IGZ1bmN0aW9uIChjb25uU3RyOiBzdHJpbmcpIHtcclxuICAgICAgICAvLyB0aGlzLmRiLm9uLmVtaXQoJ29uJyk7XHJcbiAgICAgICAgZGVidWdsb2coJ3NpbXVsYXRpb25nIGNvbm5lY3RpbmcgdG8gJyArIGNvbm5TdHIpO1xyXG4gICAgICAgIGlmICghdGhpcy5fb25jZSkge1xyXG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5jb25uZWN0aW9uLmVtaXQoJ29wZW4nKTtcclxuICAgICAgICAgICAgICAgIGRlYnVnbG9nKCdmaXJlZCBlbWl0Jyk7XHJcbiAgICAgICAgICAgIH0sIDApO1xyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICAvLyBlLmcuIHNldCgndXNlQ3JlYXRlSW5kZXgnLHRydWUpXHJcbiAgICBzZXQgOiBmdW5jdGlvbihhLGIpIHt9LFxyXG4gICAgY29ubmVjdGlvbjogZGJFbWl0dGVyXHJcbn07XHJcbiovIl19
