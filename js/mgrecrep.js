"use strict";
/**
 * instrument mongoose to record/replay queries (!! only queries so far)
 *
 * allows to run (mongoose read only) unit tests w.o. a mongoose instance
 *
 * @file
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongooseMock = exports.instrumentMongoose = exports.instrumentModelReplay = exports.instrumentModelRecord = exports.retrieveOp = exports.recordOp = exports.digestArgs = exports.instrumentModel = exports.JSONStringify = exports.JSONParse = void 0;
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
    console.log('***mongoose_record_replay is instrumenting model ' + modelDoc.modelName + ' for recording to ' + recordingPath);
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
    console.log(' ********* instrument mongoose with  ' + path + "  " + mode);
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
        //    var r = mongooseMock;
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
exports.mongooseMock = {
    models: {},
    recordingPath: "",
    theMode: "",
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
    // e.g. set('useCreateIndex',true)
    set: function (a, b) { },
    connection: dbEmitter
};

//# sourceMappingURL=data:application/json;charset=utf8;base64,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Z0JBQ1AsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQzdCLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUMzQixDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7U0FDVDtJQUNMLENBQUM7SUFDRCxrQ0FBa0M7SUFDbEMsR0FBRyxFQUFHLFVBQVMsQ0FBQyxFQUFDLENBQUMsSUFBRyxDQUFDO0lBQ3RCLFVBQVUsRUFBRSxTQUFTO0NBQ3hCLENBQUMiLCJmaWxlIjoibWdyZWNyZXAuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogaW5zdHJ1bWVudCBtb25nb29zZSB0byByZWNvcmQvcmVwbGF5IHF1ZXJpZXMgKCEhIG9ubHkgcXVlcmllcyBzbyBmYXIpXHJcbiAqXHJcbiAqIGFsbG93cyB0byBydW4gKG1vbmdvb3NlIHJlYWQgb25seSkgdW5pdCB0ZXN0cyB3Lm8uIGEgbW9uZ29vc2UgaW5zdGFuY2VcclxuICpcclxuICogQGZpbGVcclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBkZWJ1Z2YgZnJvbSAnZGVidWdmJztcclxuXHJcbnZhciBkZWJ1Z2xvZyA9IGRlYnVnZignbW9uZ29vc2VfcmVjb3JkX3JlcGxheScpO1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuaW1wb3J0ICogYXMgcHJvY2VzcyBmcm9tICdwcm9jZXNzJztcclxuaW1wb3J0ICogYXMgbW9uZ29vc2UgZnJvbSAnbW9uZ29vc2UnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnZXZlbnRzJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5jb25zdCBjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTtcclxuXHJcbi8qKlxyXG4gKiBUaGUgcmVjb3JkaW5nIHBhdGgsIHNldCB2aWEgYXJndW1lbnRcclxuICogb3JcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBKU09OUGFyc2UodGV4dDogc3RyaW5nKTogYW55IHtcclxuICAgIGZ1bmN0aW9uIGN1c3RvbURlU2VyKGtleSwgdmFsdWUpIHtcclxuICAgICAgICBpZiAodmFsdWUudG9TdHJpbmcoKS5pbmRleE9mKFwiX19SRUdFWFAgXCIpID09IDApIHtcclxuICAgICAgICAgICAgdmFyIG0gPSB2YWx1ZS5zcGxpdChcIl9fUkVHRVhQIFwiKVsxXS5tYXRjaCgvXFwvKC4qKVxcLyguKik/Lyk7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVnRXhwKG1bMV0sIG1bMl0gfHwgXCJcIik7XHJcbiAgICAgICAgfSBlbHNlXHJcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcclxuICAgIH1cclxuICAgIHJldHVybiBKU09OLnBhcnNlKHRleHQsIGN1c3RvbURlU2VyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIEpTT05TdHJpbmdpZnkob2JqOiBhbnkpOiBzdHJpbmcge1xyXG4gICAgZnVuY3Rpb24gY3VzdG9tU2VyKGtleSwgdmFsdWUpIHtcclxuICAgICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBSZWdFeHApe1xyXG4gICAgICAgICAgICByZXR1cm4gKFwiX19SRUdFWFAgXCIgKyB2YWx1ZS50b1N0cmluZygpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkob2JqLCBjdXN0b21TZXIsIDIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkRmlsZUFzSlNPTihmaWxlbmFtZTogc3RyaW5nKTogYW55IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgdmFyIGRhdGEgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZW5hbWUsICd1dGYtOCcpO1xyXG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGRhdGEpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKFwiQ29udGVudCBvZiBmaWxlIFwiICsgZmlsZW5hbWUgKyBcIiBpcyBubyBqc29uXCIgKyBlKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250ZW50IG9mIGZpbGUgXCIgKyBmaWxlbmFtZSArIFwiIGlzIG5vIGpzb25cIiArIGUpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGFzc3VyZVBhdGgocGF0aDogc3RyaW5nKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGZzLm1rZGlyU3luYyhwYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuXHJcbiAgICB9XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGZzLm1rZGlyU3luYyhwYXRoICsgJ2RhdGEnKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuXHJcbiAgICB9XHJcbn1cclxuXHJcbnZhciBkYkVtaXR0ZXIgPSBuZXcgZXZlbnRzLkV2ZW50RW1pdHRlcigpO1xyXG4vLyB1bml0IHRlc3QgaW52b2tlIHRoaXMgbXVsdGlwbGUgdGltZXMsIGF2b2lkIG5vZGUganMgd2FybmluZ1xyXG5kYkVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKDApO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGluc3RydW1lbnRNb2RlbChtb2RlbDogbW9uZ29vc2UuTW9kZWw8YW55PiwgcmVjb3JkaW5nUGF0aCA6IHN0cmluZywgdGhlTW9kZTogc3RyaW5nKSB7XHJcbiAgICBpZiAodGhlTW9kZSA9PT0gXCJSRUNPUkRcIikge1xyXG4gICAgICAgIGluc3RydW1lbnRNb2RlbFJlY29yZChtb2RlbCwgcmVjb3JkaW5nUGF0aCwgdGhlTW9kZSk7XHJcbiAgICB9IGVsc2UgaWYgKHRoZU1vZGUgPT09IFwiUkVQTEFZXCIpIHtcclxuICAgICAgICAvLyB0b2RvXHJcbiAgICAgICAgaW5zdHJ1bWVudE1vZGVsUmVwbGF5KG1vZGVsLCByZWNvcmRpbmdQYXRoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBtb2RlbDtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIG1ha2VGaWxlTmFtZShkaWdlc3QsIHJlY29yZGluZ1BhdGg6IHN0cmluZykge1xyXG4gICAgcmV0dXJuIChyZWNvcmRpbmdQYXRoICsgJ2RhdGEvJyArIGRpZ2VzdCArICcuanNvbicpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGlnZXN0QXJncyhvcDogc3RyaW5nLCBuYW1lIDogc3RyaW5nLCBxdWVyeSA6IGFueSkge1xyXG4gICAgdmFyIG1kNXN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKTtcclxuICAgIGRlYnVnbG9nKCdoZXJlIHRoZSBuYW1lICcgKyBuYW1lKTtcclxuICAgIG1kNXN1bS51cGRhdGUob3AgKyBuYW1lICsgSlNPTlN0cmluZ2lmeShxdWVyeSkpO1xyXG4gICAgdmFyIGRpZ2VzdCA9ICcnICsgbWQ1c3VtLmRpZ2VzdCgnaGV4Jyk7XHJcbiAgICByZXR1cm4gZGlnZXN0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkT3Aob3A6IHN0cmluZywgbmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCByZXM6IGFueSwgcmVjb3JkaW5nUGF0aCA6IHN0cmluZykge1xyXG4gICAgdmFyIGRpZ2VzdCA9IGRpZ2VzdEFyZ3Mob3AsbmFtZSxxdWVyeSk7XHJcbiAgICB2YXIgcmVzU3RyID0gSlNPTi5zdHJpbmdpZnkocmVzLCB1bmRlZmluZWQsIDIpO1xyXG4gICAgdmFyIGxlbiA9IDA7XHJcbiAgICBpZihyZXMgJiYgQXJyYXkuaXNBcnJheShyZXMpKSB7XHJcbiAgICAgICAgbGVuID0gcmVzLmxlbmd0aDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbGVuID0gcmVzU3RyLmxlbmd0aDtcclxuICAgIH1cclxuICAgIHZhciBmaWxlbmFtZSA9IG1ha2VGaWxlTmFtZShkaWdlc3QsIHJlY29yZGluZ1BhdGgpO1xyXG4gICAgY29uc29sZS5sb2coICdyZWNvcmRpbmcgdG8gZmlsZTogJyArIGZpbGVuYW1lICsgJyAoJyArIHBhdGgubm9ybWFsaXplKGZpbGVuYW1lKSArICcpLi4uJyk7XHJcbiAgICBmcy53cml0ZUZpbGVTeW5jKGZpbGVuYW1lLCByZXNTdHIpO1xyXG4gICAgdmFyIGtub3duID0ge307XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGtub3duID0gcmVhZEZpbGVBc0pTT04ocmVjb3JkaW5nUGF0aCArICdxdWVyaWVzLmpzb24nKTtcclxuICAgIH0gY2F0Y2ggKGV4KSB7XHJcblxyXG4gICAgfVxyXG4gICAga25vd25bZGlnZXN0XSA9IHtcclxuICAgICAgICBvcDogb3AsXHJcbiAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICBkaWdlc3Q6IGRpZ2VzdCxcclxuICAgICAgICBxdWVyeTogcXVlcnksXHJcbiAgICAgICAgcmVzIDogbGVuXHJcbiAgICB9O1xyXG4gICAgZnMud3JpdGVGaWxlU3luYyhyZWNvcmRpbmdQYXRoICsgJ3F1ZXJpZXMuanNvbicsIEpTT05TdHJpbmdpZnkoa25vd24pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJldHJpZXZlT3Aob3A6IHN0cmluZywgbmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCByZWNvcmRpbmdQYXRoIDogc3RyaW5nKSB7XHJcbiAgICB2YXIgZGlnZXN0ID0gZGlnZXN0QXJncyhvcCxuYW1lLCBxdWVyeSk7XHJcbiAgICB2YXIgZmlsZW5hbWUgPSBtYWtlRmlsZU5hbWUoZGlnZXN0LCByZWNvcmRpbmdQYXRoKTtcclxuICAgIGRlYnVnbG9nKCcgcmVhZGluZyBmcm9tIGZpbGVuYW1lICcgKyBmaWxlbmFtZSk7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHZhciByZXMgPSByZWFkRmlsZUFzSlNPTihmaWxlbmFtZSk7XHJcbiAgICB9IGNhdGNoKGUpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhlKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhlLnN0YWNrKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgZGlkIG5vdCBmaW5kIHF1ZXJ5IHJlc3VsdCByZWNvcmRpbmcgKCR7ZmlsZW5hbWV9KSBcXG4gZm9yIGNvbGxlY3Rpb24gJHtuYW1lfSBvcGVyYXRpb24gJHtvcH0gXFxuIHF1ZXJ5IGFyZ3VtZW50czogYCArIEpTT05TdHJpbmdpZnkocXVlcnkpKTtcclxuICAgICAgICB0aHJvdyBlO1xyXG4gICAgfVxyXG4gICAgaWYgKHJlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZGVidWdsb2coJ2VtcHR5IHJlc3VsdCBmb3IgcXVlcnkgJyArIG9wICsgJyAnICsgSlNPTi5zdHJpbmdpZnkocXVlcnksIHVuZGVmaW5lZCwgMikgKyAnXFxuJyArIGZpbGVuYW1lKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXM7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVtZW50TW9kZWxSZWNvcmQobW9kZWxEb2M6IG1vbmdvb3NlLk1vZGVsPGFueT4sIHJlY29yZGluZ1BhdGg6IHN0cmluZywgdGhlTW9kZTogc3RyaW5nKSB7XHJcbiAgICBjb25zb2xlLmxvZygnKioqbW9uZ29vc2VfcmVjb3JkX3JlcGxheSBpcyBpbnN0cnVtZW50aW5nIG1vZGVsICcgKyBtb2RlbERvYy5tb2RlbE5hbWUgKyAnIGZvciByZWNvcmRpbmcgdG8gJyArIHJlY29yZGluZ1BhdGggKTtcclxuICAgIHZhciBvRmluZCA9IG1vZGVsRG9jLmZpbmQ7XHJcbiAgICBtb2RlbERvYy5maW5kID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coJ3NvbWVvbmUgaXMgY2FsbGluZyBmaW5kIHdpdGggJyArIG1vZGVsRG9jLm1vZGVsTmFtZSArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHJlcyA9IG9GaW5kLmFwcGx5KG1vZGVsRG9jLCBhcmd1bWVudHMpO1xyXG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSAxKSB7XHJcbiAgICAgICAgICAgIHRocm93IEVycm9yKCdleHBlY3RlZCBvbmUgYXJndW1lbnQgaW4gZmluZCwgd2FzICcgKyBhcmd1bWVudHMubGVuZ3RoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYXJndW1lbnRzWzBdO1xyXG4gICAgICAgIHJlcy5sZWFuKCkuZXhlYygpLnRoZW4oKGEpID0+IHtcclxuICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhcImhlcmUgcmVzdWx0MSArIFwiICsgSlNPTi5zdHJpbmdpZnkoYSwgdW5kZWZpbmVkLDIpICk7XHJcbiAgICAgICAgICAgIHJlY29yZE9wKFwiZmluZFwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCBhLCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICByZXR1cm4gcmVzO1xyXG4gICAgfVxyXG4gICAgdmFyIG9EaXN0aW5jdCA9IG1vZGVsRG9jLmRpc3RpbmN0O1xyXG4gICAgbW9kZWxEb2MuZGlzdGluY3QgPSBmdW5jdGlvbiAoKTogYW55IHtcclxuICAgICAgICBkZWJ1Z2xvZygnc29tZW9uZSBpcyBjYWxsaW5nIGRpc3RpbmN0IHdpdGgnICsgSlNPTi5zdHJpbmdpZnkoYXJndW1lbnRzLCB1bmRlZmluZWQsIDIpKTtcclxuICAgICAgICB2YXIgcmVzID0gb0Rpc3RpbmN0LmFwcGx5KG1vZGVsRG9jLCBhcmd1bWVudHMpO1xyXG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoICE9PSAxKSB7XHJcbiAgICAgICAgICAgIHRocm93IEVycm9yKCdleHBlY3RlZCBvbmUgYXJndW1lbnQgJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cykpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgcXVlcnkgPSBhcmd1bWVudHNbMF07XHJcbiAgICAgICAgdmFyIHJlczIgPSByZXMudGhlbigoYSkgPT4ge1xyXG4gICAgICAgICAgICBkZWJ1Z2xvZyggKCkgPT4gXCJoZXJlIHJlc3VsdDEgKyBcIiArIEpTT04uc3RyaW5naWZ5KGEsIHVuZGVmaW5lZCwyKSApO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgcmVjb3JkT3AoXCJkaXN0aW5jdFwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCBhLCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCggZXgpXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCAnIHJlY29yZGluZyB0byBmaWxlIGZhaWxlZCAnICsgZXggKTtcclxuICAgICAgICAgICAgICAgIGRlYnVnbG9nKCAoKSA9PiBcIiByZWNvcmRpbmcgdG8gZmlsZSBmYWlsZWQgXCIgKyBleCApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgZXg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIGE7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIHJlczsgLy9yZXMyLnRoZW4oKGIpID0+IHsgY29uc29sZS5sb2coJyAybmQgcHJvbWlzZSB0aGVuICcgKyBiICYmIGIubGVuZ3RoKTsgcmV0dXJuIGI7IH0pO1xyXG4gICAgfVxyXG4gICAgdmFyIG9BZ2dyZWdhdGUgPSBtb2RlbERvYy5hZ2dyZWdhdGU7XHJcbiAgICBtb2RlbERvYy5hZ2dyZWdhdGUgPSBmdW5jdGlvbiAoKTogYW55IHtcclxuICAgICAgICBkZWJ1Z2xvZygoKSA9PiAnc29tZW9uZSBpcyBjYWxsaW5nIGFnZ3JlZ2F0ZSB3aXRoJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcclxuICAgICAgICB2YXIgcmVzID0gb0FnZ3JlZ2F0ZS5hcHBseShtb2RlbERvYywgYXJndW1lbnRzKTtcclxuICAgICAgICByZXMudGhlbigoYSkgPT4ge1xyXG4gICAgICAgICAgICBkZWJ1Z2xvZygoKSA9PiBcImhlcmUgcmVzdWx0MSArIFwiICsgSlNPTi5zdHJpbmdpZnkoYSwgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgICAgIHJlY29yZE9wKFwiYWdncmVnYXRlXCIsIG1vZGVsRG9jLm1vZGVsTmFtZSwgcXVlcnksIGEsIHJlY29yZGluZ1BhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIHJldHVybiByZXM7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVtZW50TW9kZWxSZXBsYXkobW9kZWxEb2M6IG1vbmdvb3NlLk1vZGVsPGFueT4sIHJlY29yZGluZ1BhdGg6IHN0cmluZykge1xyXG4gICAgY29uc29sZS5sb2coJ2luc3RydW1lbnRpbmcgbW9kZWwgJyArIG1vZGVsRG9jLm1vZGVsTmFtZSArICcgZm9yIHJlcGxheSBmcm9tIHBhdGggJyArIHJlY29yZGluZ1BhdGggKTtcclxuICAgIGRlYnVnbG9nKCdpbnN0cnVtZW50aW5nIG1vZGVsICcgKyBtb2RlbERvYy5tb2RlbE5hbWUpO1xyXG4gICAgdmFyIG9GaW5kID0gbW9kZWxEb2MuZmluZDtcclxuICAgIG1vZGVsRG9jLmZpbmQgPSBmdW5jdGlvbiAoKTogYW55IHtcclxuICAgICAgICBkZWJ1Z2xvZygoKSA9PiAnc29tZW9uZSBpcyByZXBsYXlpbmcgZmluZCB3aXRoJyArIEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50cywgdW5kZWZpbmVkLCAyKSk7XHJcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYXJndW1lbnRzWzBdO1xyXG4gICAgICAgIHZhciByZXMgPSByZXRyaWV2ZU9wKFwiZmluZFwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICBkZWJ1Z2xvZygoKSA9PiAncmV0dXJuaW5nIHJlcyAnICsgSlNPTi5zdHJpbmdpZnkocmVzKSArICcgZm9yIHF1ZXJ5IGZpbmQnICsgcXVlcnkpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIGxlYW46IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXhlYzogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHZhciBvRGlzdGluY3QgPSBtb2RlbERvYy5kaXN0aW5jdDtcclxuICAgIG1vZGVsRG9jLmRpc3RpbmN0ID0gZnVuY3Rpb24gKCk6IGFueSB7XHJcbiAgICAgICAgZGVidWdsb2coJ3NvbWVvbmUgaXMgcmVwbGF5aW5nIGRpc3RpbmN0IHdpdGgnICsgSlNPTi5zdHJpbmdpZnkoYXJndW1lbnRzLCB1bmRlZmluZWQsIDIpKTtcclxuICAgICAgICB2YXIgcXVlcnkgPSBhcmd1bWVudHNbMF07XHJcbiAgICAgICAgdmFyIHJlcyA9IHJldHJpZXZlT3AoXCJkaXN0aW5jdFwiLCBtb2RlbERvYy5tb2RlbE5hbWUsIHF1ZXJ5LCByZWNvcmRpbmdQYXRoKTtcclxuICAgICAgICBkZWJ1Z2xvZygncmV0dXJuaW5nIHJlcyAnICsgSlNPTi5zdHJpbmdpZnkocmVzKSArICcgZm9yIHF1ZXJ5IGZpbmQnICsgcXVlcnkpO1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkgeyByZXNvbHZlKHJlcyk7IH0sIDApO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdmFyIG9BZ2dyZWdhdGUgPSBtb2RlbERvYy5hZ2dyZWdhdGU7XHJcbiAgICBtb2RlbERvYy5hZ2dyZWdhdGUgPSBmdW5jdGlvbiAoKTogYW55IHtcclxuICAgICAgICBkZWJ1Z2xvZygnc29tZW9uZSBpcyByZXBsYXlpbmcgYWdncmVnYXRlIHdpdGgnICsgSlNPTi5zdHJpbmdpZnkoYXJndW1lbnRzLCB1bmRlZmluZWQsIDIpKTtcclxuICAgICAgICB2YXIgcXVlcnkgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xyXG4gICAgICAgIHZhciByZXMgPSByZXRyaWV2ZU9wKFwiYWdncmVnYXRlXCIsIG1vZGVsRG9jLm1vZGVsTmFtZSwgcXVlcnksIHJlY29yZGluZ1BhdGgpO1xyXG4gICAgICAgIHZhciBwID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgcmVzb2x2ZShyZXMpOyB9LCAwKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICAocCBhcyBhbnkpLmV4ZWMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBwO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcDtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIGZ1bnRpb24gdG8gaW5zdHJ1bWVudCBtb25nb29zZVxyXG4gKlxyXG4gKlxyXG4gKlxyXG4gKiBAcGFyYW0gbW9uZ29vc2UgYSByZWFsIG1vbmdvb3NlIGluc3RhbmNlXHJcbiAqIEBwYXJhbSBbcGF0aF0ge3N0cmluZ30gb3B0aW9uYWwsIGEgcGF0aCB0byB3cml0ZS9yZWFkIGZpbGVzIGZyb20sIGRlZmF1bHRzIHRvIFwibWdyZWNyZXAvXCJcclxuICogQHBhcmFtIG1vZGUge3N0cmluZ30gIHVuZGVmaW5lZCAoZW52aXJvbm1lbnQgdmFsdWUpIG9yIFwiUkVQTEFZXCIgb3IgXCJSRUNPUkRcIlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGluc3RydW1lbnRNb25nb29zZShtb25nb29zZTogbW9uZ29vc2UuTW9uZ29vc2UsIHBhdGg6IHN0cmluZywgbW9kZT86IHN0cmluZyk6IG1vbmdvb3NlLk1vbmdvb3NlIHtcclxuICAgIGNvbnNvbGUubG9nKCcgKioqKioqKioqIGluc3RydW1lbnQgbW9uZ29vc2Ugd2l0aCAgJyArIHBhdGggKyBcIiAgXCIgKyBtb2RlKTtcclxuICAgIHZhciB0aGVNb2RlID0gbW9kZSB8fCBwcm9jZXNzLmVudi5NT05HT19SRUNPUkRfUkVQTEFZO1xyXG4gICAgaWYgKHRoZU1vZGUgJiYgW1wiUkVQTEFZXCIsIFwiUkVDT1JEXCJdLmluZGV4T2YobW9kZSkgPCAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3Bhc3NlZCBtb2RlIHZhbHVlIG9yIGVudiBNT05HT19SRUNPUkRfUkVQTEFZIG1heSBvbmx5IGJlIFwiUkVDT1JEXCIgb3IgXCJSRVBMQVlcIiAsIE1PTkdPX1JFQ09SRCBNT05HT19SRVBMQVknKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ21vbmdvb3NlX3JlY29yZF9yZXBsYXkgbW9kZSBzaG91bGQgYmUgb25lIG9mIFwiUkVQTEFZXCIsIFwiUkVDT1JEXCIgIHdhcyAnICsgdGhlTW9kZSk7XHJcbiAgICB9XHJcbiAgICBpZiAodGhlTW9kZSA9PT0gXCJSRUNPUkRcIikge1xyXG4gICAgICAgIHZhciByZWNvcmRpbmdQYXRoID0gcGF0aCB8fCBwcm9jZXNzLmVudi5NT05HT19SRUNPUkRfUkVQTEFZX1BBVEggfHwgXCJtb25nb29zZV9yZWNvcmRfcmVwbGF5XCI7XHJcbiAgICAgICAgY29uc29sZS5sb2coICchKiBtb2RlIFJFQ09SRCB0byBwYXRoICcgKyByZWNvcmRpbmdQYXRoICArICcgaW4gJyArIF9fZGlybmFtZSArIFwiIFwiICArIG1vZGUgKTtcclxuICAgICAgICBhc3N1cmVQYXRoKHJlY29yZGluZ1BhdGgpO1xyXG4gICAgICAgIHZhciBvbW9kZWwgPSBtb25nb29zZS5tb2RlbDtcclxuICAgICAgICBtb25nb29zZS5tb2RlbCA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5zdHJ1bWVudE1vZGVsKG9tb2RlbC5hcHBseShtb25nb29zZSwgYXJndW1lbnRzKSxyZWNvcmRpbmdQYXRoLHRoZU1vZGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBvbW9kZWwuYXBwbHkobW9uZ29vc2UsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBtb25nb29zZTtcclxuICAgIH0gZWxzZSBpZiAodGhlTW9kZSA9PT0gXCJSRVBMQVlcIikge1xyXG4gICAgICAgIHJlY29yZGluZ1BhdGggPSBwYXRoIHx8IHByb2Nlc3MuZW52Lk1PTkdPX1JFQ09SRF9SRVBMQVlfUEFUSCB8fCBcIm1vbmdvb3NlX3JlY29yZF9yZXBsYXlcIjtcclxuICAgICAgICBjb25zb2xlLmxvZyggJyEqIG1vZGUgUkVQTEFZIGZyb20gcGF0aCAnICsgcmVjb3JkaW5nUGF0aCAgKyAnIGluICcgKyBfX2Rpcm5hbWUgKyBcIiBcIiAgKyBtb2RlICArIFwiIFwiICsgcGF0aCk7XHJcbiAgICAvLyAgICB2YXIgciA9IG1vbmdvb3NlTW9jaztcclxuICAgICAgICB2YXIgciA9IG1ha2VNb25nb29zZU1vY2socmVjb3JkaW5nUGF0aCx0aGVNb2RlKTtcclxuICAgICAgICByZXR1cm4gcjsgXHJcbiAgICB9XHJcbiAgICByZXR1cm4gbW9uZ29vc2U7XHJcbn1cclxuXHJcbnZhciBtb2Nrc1BlclBhdGggPSB7fTtcclxuXHJcbmZ1bmN0aW9uIG1ha2VNb25nb29zZU1vY2socmVjb3JkaW5nUGF0aDogc3RyaW5nLCB0aGVNb2RlOiBzdHJpbmcpIHtcclxuICAgIGlmICggbW9ja3NQZXJQYXRoW3JlY29yZGluZ1BhdGhdID09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHZhciByZXMgPSB7XHJcbiAgICAgICAgICAgIG1vZGVsczoge30sXHJcbiAgICAgICAgICAgIHJlY29yZGluZ1BhdGggOiByZWNvcmRpbmdQYXRoLFxyXG4gICAgICAgICAgICB0aGVNb2RlIDogdGhlTW9kZSxcclxuICAgICAgICAgICAgbW9kZWxOYW1lczogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMubW9kZWxzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgU2NoZW1hOiBtb25nb29zZS5TY2hlbWEsXHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIG1vZGVsOiBmdW5jdGlvbiAoYSwgYikge1xyXG4gICAgICAgICAgICAgICAgaWYgKGIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLm1vZGVsc1thXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGRlYnVnbG9nKCdjcmVhdGluZyBtb2RlbCAgJyArIGEgKyAnIGF0IG1vY2snKTtcclxuICAgICAgICAgICAgICAgIHRoaXMubW9kZWxzW2FdID0gaW5zdHJ1bWVudE1vZGVsKHtcclxuICAgICAgICAgICAgICAgICAgICBmaW5kOiBmdW5jdGlvbiAoKSB7IH0sXHJcbiAgICAgICAgICAgICAgICAgICAgYWdncmVnYXRlOiBmdW5jdGlvbiAoKSB7IH0sXHJcbiAgICAgICAgICAgICAgICAgICAgZGlzdGluY3Q6IGZ1bmN0aW9uICgpIHsgfSxcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbE5hbWU6IGEsXHJcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hOiBiLFxyXG4gICAgICAgICAgICAgICAgfSBhcyBhbnksIHRoaXMucmVjb3JkaW5nUGF0aCwgdGhpcy50aGVNb2RlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLm1vZGVsc1thXTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgZGlzY29ubmVjdDogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgZGVidWdsb2coJ3NpbXVsYXRpb25nIGRpc2Nvbm5lY3QgJyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGNvbm5lY3Q6IGZ1bmN0aW9uIChjb25uU3RyOiBzdHJpbmcpIHtcclxuICAgICAgICAgICAgICAgIC8vIHRoaXMuZGIub24uZW1pdCgnb24nKTtcclxuICAgICAgICAgICAgICAgIGRlYnVnbG9nKCdzaW11bGF0aW9uZyBjb25uZWN0aW5nIHRvICcgKyBjb25uU3RyKTtcclxuICAgICAgICAgICAgICAgIGlmICghdGhpcy5fb25jZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhhdC5jb25uZWN0aW9uLmVtaXQoJ29wZW4nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVidWdsb2coJ2ZpcmVkIGVtaXQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgY29ubmVjdGlvbjogZGJFbWl0dGVyXHJcbiAgICAgICAgfTtcclxuICAgICAgICBtb2Nrc1BlclBhdGhbcmVjb3JkaW5nUGF0aF0gPSByZXM7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbW9ja3NQZXJQYXRoW3JlY29yZGluZ1BhdGhdO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIG1vbmdvb3NlTW9jayA9IHtcclxuICAgIG1vZGVsczoge30sXHJcbiAgICByZWNvcmRpbmdQYXRoIDogXCJcIixcclxuICAgIHRoZU1vZGUgOiBcIlwiLFxyXG4gICAgbW9kZWxOYW1lczogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLm1vZGVscyk7XHJcbiAgICB9LFxyXG4gICAgU2NoZW1hOiBtb25nb29zZS5TY2hlbWEsXHJcblxyXG4gICAgbW9kZWw6IGZ1bmN0aW9uIChhLCBiKSB7XHJcbiAgICAgICAgaWYgKGIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5tb2RlbHNbYV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRlYnVnbG9nKCdjcmVhdGluZyBtb2RlbCAgJyArIGEgKyAnIGF0IG1vY2snKTtcclxuICAgICAgICB0aGlzLm1vZGVsc1thXSA9IGluc3RydW1lbnRNb2RlbCh7XHJcbiAgICAgICAgICAgIGZpbmQ6IGZ1bmN0aW9uICgpIHsgfSxcclxuICAgICAgICAgICAgYWdncmVnYXRlOiBmdW5jdGlvbiAoKSB7IH0sXHJcbiAgICAgICAgICAgIGRpc3RpbmN0OiBmdW5jdGlvbiAoKSB7IH0sXHJcbiAgICAgICAgICAgIG1vZGVsTmFtZTogYSxcclxuICAgICAgICAgICAgc2NoZW1hOiBiLFxyXG4gICAgICAgIH0gYXMgYW55LCB0aGlzLnJlY29yZGluZ1BhdGgsIHRoaXMudGhlTW9kZSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kZWxzW2FdO1xyXG4gICAgfSxcclxuICAgIGRpc2Nvbm5lY3Q6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICBkZWJ1Z2xvZygnc2ltdWxhdGlvbmcgZGlzY29ubmVjdCAnKTtcclxuICAgIH0sXHJcbiAgICBjb25uZWN0OiBmdW5jdGlvbiAoY29ublN0cjogc3RyaW5nKSB7XHJcbiAgICAgICAgLy8gdGhpcy5kYi5vbi5lbWl0KCdvbicpO1xyXG4gICAgICAgIGRlYnVnbG9nKCdzaW11bGF0aW9uZyBjb25uZWN0aW5nIHRvICcgKyBjb25uU3RyKTtcclxuICAgICAgICBpZiAoIXRoaXMuX29uY2UpIHtcclxuICAgICAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIHRoYXQuY29ubmVjdGlvbi5lbWl0KCdvcGVuJyk7XHJcbiAgICAgICAgICAgICAgICBkZWJ1Z2xvZygnZmlyZWQgZW1pdCcpO1xyXG4gICAgICAgICAgICB9LCAwKTtcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8gZS5nLiBzZXQoJ3VzZUNyZWF0ZUluZGV4Jyx0cnVlKVxyXG4gICAgc2V0IDogZnVuY3Rpb24oYSxiKSB7fSxcclxuICAgIGNvbm5lY3Rpb246IGRiRW1pdHRlclxyXG59O1xyXG4iXX0=
