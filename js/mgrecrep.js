/**
 * instrument mongoose to record/replay queries ( !! only queries so far)
 *
 * allows to run (mongoose read only) unit tests w.o. a mongoose instance
 *
 * @file
 */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debugf = require("debugf");
var debuglog = debugf('mongoose_record_replay');
//const loadlog = logger.logger('modelload', '');
const process = require("process");
const mongoose = require("mongoose");
const events = require("events");
const fs = require("fs");
const crypto = require('crypto');
/**
 * The recording path, set via argument
 * or
 */
var recordingPath = 'mongoose_record_replay/';
var serializePath = 'mgrecrep/';
var theMode = undefined;
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
    var data = fs.readFileSync(filename, 'utf-8');
    try {
        return JSON.parse(data);
    }
    catch (e) {
        console.log("Content of file " + filename + " is no json" + e);
        process.exit(-1);
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
function instrumentModel(model) {
    if (theMode === "RECORD") {
        instrumentModelRecord(model);
    }
    else if (theMode === "REPLAY") {
        // todo
        instrumentModelReplay(model);
    }
    return model;
}
exports.instrumentModel = instrumentModel;
function makeFileName(digest) {
    return (recordingPath + 'data/' + digest + '.json');
}
function recordOp(op, name, query, res) {
    var md5sum = crypto.createHash('md5');
    debuglog('here the name ' + name);
    md5sum.update(op + name + JSONStringify(query));
    var digest = md5sum.digest('hex');
    fs.writeFileSync(makeFileName(digest), JSON.stringify(res, undefined, 2));
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
        res: res
    };
    fs.writeFileSync(recordingPath + 'queries.json', JSONStringify(known));
}
exports.recordOp = recordOp;
function retrieveOp(op, name, query) {
    var md5sum = crypto.createHash('md5');
    md5sum.update(op + name + JSONStringify(query));
    var digest = md5sum.digest('hex');
    var filename = makeFileName(digest);
    debuglog(' filename ' + filename);
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
function instrumentModelRecord(modelDoc) {
    console.log('mongoose_record_replay is instrumenting model ' + modelDoc.modelName + ' for recording ');
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog('someone is calling find with ' + modelDoc.modelName + JSON.stringify(arguments, undefined, 2));
        var res = oFind.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected one arguments in find, was ' + arguments.length);
        }
        var query = arguments[0];
        res.lean().exec().then((a) => {
            //console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("find", modelDoc.modelName, query, a);
        });
        return res;
    };
    var oDistinct = modelDoc.distinct;
    modelDoc.distinct = function () {
        debuglog('someone is calling distinct with' + JSON.stringify(arguments, undefined, 2));
        var res = oDistinct.apply(modelDoc, arguments);
        if (arguments.length !== 1) {
            throw Error('expected on arguments');
        }
        var query = arguments[0];
        res.then((a) => {
            // console.log("here result1 + " + JSON.stringify(a, undefined,2) );
            recordOp("distinct", modelDoc.modelName, query, a);
        });
        return res;
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog(() => 'someone is calling aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = oAggregate.apply(modelDoc, arguments);
        res.then((a) => {
            debuglog(() => "here result1 + " + JSON.stringify(a, undefined, 2));
            recordOp("aggregate", modelDoc.modelName, query, a);
        });
        return res;
    };
}
exports.instrumentModelRecord = instrumentModelRecord;
function instrumentModelReplay(modelDoc) {
    debuglog('instrumenting model ' + modelDoc.modelName);
    var oFind = modelDoc.find;
    modelDoc.find = function () {
        debuglog(() => 'someone is replaying find with' + JSON.stringify(arguments, undefined, 2));
        var query = arguments[0];
        var res = retrieveOp("find", modelDoc.modelName, query);
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
        var res = retrieveOp("distinct", modelDoc.modelName, query);
        debuglog('returning res ' + JSON.stringify(res) + ' for query find' + query);
        return new Promise(function (resolve, reject) {
            setTimeout(function () { resolve(res); }, 0);
        });
    };
    var oAggregate = modelDoc.aggregate;
    modelDoc.aggregate = function () {
        debuglog('someone is replaying aggregate with' + JSON.stringify(arguments, undefined, 2));
        var query = Array.prototype.slice.call(arguments);
        var res = retrieveOp("aggregate", modelDoc.modelName, query);
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
    theMode = mode || process.env.MONGO_RECORD_REPLAY;
    if (mode && ["REPLAY", "RECORD"].indexOf(mode) < 0) {
        console.log('set only one of MONGO_RECORD MONGO_REPLAY');
        throw new Error('mongoose_record_replay mode should be one of "REPLAY", "RECORD"  was ' + theMode);
    }
    if (theMode === "RECORD") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        assurePath(recordingPath);
        var omodel = mongoose.model;
        mongoose.model = function () {
            if (arguments.length > 1) {
                return instrumentModel(omodel.apply(mongoose, arguments));
            }
            return omodel.apply(mongoose, arguments);
        };
        return mongoose;
    }
    else if (theMode === "REPLAY") {
        recordingPath = path || process.env.MONGO_RECORD_REPLAY_PATH || "mongoose_record_replay";
        return exports.mongooseMock;
    }
    return mongoose;
}
exports.instrumentMongoose = instrumentMongoose;
exports.mongooseMock = {
    models: {},
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
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWdyZWNyZXAuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvbWdyZWNyZXAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HOzs7QUFFSCxpQ0FBaUM7QUFFakMsSUFBSSxRQUFRLEdBQUcsTUFBTSxDQUFDLHdCQUF3QixDQUFDLENBQUM7QUFDaEQsaURBQWlEO0FBRWpELG1DQUFtQztBQUNuQyxxQ0FBcUM7QUFDckMsaUNBQWlDO0FBQ2pDLHlCQUF5QjtBQUN6QixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7QUFHakM7OztHQUdHO0FBQ0gsSUFBSSxhQUFhLEdBQUcseUJBQXlCLENBQUM7QUFDOUMsSUFBSSxhQUFhLEdBQUcsV0FBVyxDQUFDO0FBRWhDLElBQUksT0FBTyxHQUFHLFNBQVMsQ0FBQztBQUV4QixtQkFBMEIsSUFBWTtJQUNsQyxxQkFBcUIsR0FBRyxFQUFFLEtBQUs7UUFDM0IsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzdDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQzNELE1BQU0sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3hDLENBQUM7UUFBQyxJQUFJO1lBQ0YsTUFBTSxDQUFDLEtBQUssQ0FBQztJQUNyQixDQUFDO0lBQ0QsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0FBQ3pDLENBQUM7QUFURCw4QkFTQztBQUlELHVCQUE4QixHQUFRO0lBQ2xDLG1CQUFtQixH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